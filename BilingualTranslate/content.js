// Bilingual Translate — content script.
//
// On toggle, walk the page for meaningful text blocks (paragraphs, headings,
// list items, ...), translate each with Chrome's built-in on-device Translator
// API, and insert the translation as a sibling right below the original so the
// page reads bilingually. Toggle again to remove everything.
//
// Design notes:
//  - Lazy: blocks are translated only when they scroll into view
//    (IntersectionObserver) so huge articles don't freeze the tab.
//  - Leaf-only: we skip a block that contains another candidate block as a
//    descendant, so nested lists / quotes aren't translated twice.
//  - Dynamic pages: a MutationObserver picks up content added later (SPA,
//    infinite scroll).
//  - The Translator runs fully on-device. The FIRST time a language pair is
//    used the model must download, and Chrome requires that download to be
//    started from a real user gesture. The toggle arrives via a message (no
//    gesture), so when a download is needed we turn the badge into a button —
//    clicking it provides the gesture and starts translation.

(() => {
  if (window.__btLoaded) return; // guard against double injection
  window.__btLoaded = true;

  const DONE_ATTR = "data-bt-done";
  const TRANS_CLASS = "bt-translation";
  const BLOCK_SELECTOR =
    "p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, figcaption, td";
  // Never look inside these — code, controls, and our own output.
  const SKIP_ANCESTORS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "KBD", "SAMP",
    "TEXTAREA", "INPUT", "SELECT", "BUTTON", "SVG",
  ]);
  const MIN_LEN = 12; // shorter than this is rarely worth translating
  const HAS_LETTER = /\p{L}{2,}/u; // at least some real words

  let enabled = false;
  let started = false; // translation actually running (model ready)
  let srcLang = "en";
  let tgtLang = "vi";
  let translatorPromise = null;
  let io = null; // IntersectionObserver
  let mo = null; // MutationObserver
  let scanScheduled = false;

  const pair = () => `${srcLang}→${tgtLang}`;

  // ---- Translator engine -------------------------------------------------

  async function getTranslator() {
    if (translatorPromise) return translatorPromise;
    translatorPromise = (async () => {
      if (typeof Translator === "undefined") throw new Error("NO_API");
      const opts = { sourceLanguage: srcLang, targetLanguage: tgtLang };
      return Translator.create({
        ...opts,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            const pct = Math.round((e.loaded || 0) * 100);
            setBadgeText(`Downloading model ${pair()} ${pct}%`);
          });
        },
      });
    })();
    return translatorPromise;
  }

  // ---- Block selection ---------------------------------------------------

  function hasSkippedAncestor(el) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (SKIP_ANCESTORS.has(n.tagName)) return true;
      if (n.isContentEditable) return true;
    }
    return false;
  }

  function isCandidate(el) {
    if (el.hasAttribute(DONE_ATTR)) return false;
    if (el.classList.contains(TRANS_CLASS)) return false;
    if (SKIP_ANCESTORS.has(el.tagName)) return false;
    // Leaf-only: skip if it contains another candidate block.
    if (el.querySelector(BLOCK_SELECTOR)) return false;
    if (hasSkippedAncestor(el)) return false;
    const text = (el.innerText || "").trim();
    if (text.length < MIN_LEN) return false;
    if (!HAS_LETTER.test(text)) return false;
    return true;
  }

  function scan() {
    scanScheduled = false;
    if (!enabled || !io) return;
    document.querySelectorAll(BLOCK_SELECTOR).forEach((el) => {
      if (isCandidate(el)) {
        el.setAttribute(DONE_ATTR, "pending");
        io.observe(el);
      }
    });
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(scan);
  }

  // ---- Translate + inject ------------------------------------------------

  async function translateBlock(el) {
    const text = (el.innerText || "").trim();
    if (!text) {
      el.setAttribute(DONE_ATTR, "skip");
      return;
    }
    try {
      const translator = await getTranslator();
      const out = await translator.translate(text);
      if (!enabled) return; // toggled off mid-flight
      if (!out || out.trim() === text.trim()) {
        el.setAttribute(DONE_ATTR, "skip");
        return;
      }
      const div = document.createElement("div");
      div.className = TRANS_CLASS;
      div.textContent = out;
      el.insertAdjacentElement("afterend", div);
      el.setAttribute(DONE_ATTR, "yes");
    } catch (err) {
      el.setAttribute(DONE_ATTR, "error");
      reportError(err);
    }
  }

  function reportError(err) {
    const msg = (err && err.message) || String(err);
    if (msg === "NO_API") {
      fail("This browser doesn't support the Translator API. Needs Chrome/Edge 138+.");
    } else if (/gesture|activation|NotAllowed/i.test(msg)) {
      // Download needs a real click — surface the badge button again.
      started = false;
      setBadgeAction(`Click to download model & translate ${pair()}`, startTranslating);
    } else {
      fail(`Translation error (${pair()}): ${msg}`);
    }
  }

  // ---- Enable / disable --------------------------------------------------

  async function prepare() {
    try {
      if (typeof Translator === "undefined") {
        fail("This browser doesn't support the Translator API. Needs Chrome/Edge 138+.");
        return;
      }
      const opts = { sourceLanguage: srcLang, targetLanguage: tgtLang };
      const availability = await Translator.availability(opts);
      if (!enabled) return;
      if (availability === "unavailable") {
        fail(`The pair ${pair()} isn't supported on this device.`);
        return;
      }
      if (availability === "available" || availability === "downloading") {
        // Already cached, or a download is already in progress — no fresh
        // gesture needed; just proceed (we'll wait out any remaining download).
        startTranslating();
      } else {
        // "downloadable": the first-ever download must be started from a user
        // gesture, so make the badge a button. This happens ONCE — afterwards
        // Chrome keeps the model on disk and availability becomes "available".
        setBadgeAction(`Click to download model & translate ${pair()}`, startTranslating);
      }
    } catch (err) {
      reportError(err);
    }
  }

  async function startTranslating() {
    if (started || !enabled) return;
    started = true;
    try {
      setBadgeText(`Preparing ${pair()}…`);
      await getTranslator(); // may download here (called from click = gesture)
      if (!enabled) return;
      setBadgeText(`🌐 ${pair()}`);
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              io.unobserve(e.target);
              translateBlock(e.target);
            }
          }
        },
        { rootMargin: "200px 0px" }
      );
      mo = new MutationObserver(() => scheduleScan());
      mo.observe(document.body, { childList: true, subtree: true });
      scan();
    } catch (err) {
      reportError(err);
    }
  }

  function enable() {
    enabled = true;
    started = false;
    showBadge();
    prepare();
  }

  function disable() {
    enabled = false;
    started = false;
    if (io) { io.disconnect(); io = null; }
    if (mo) { mo.disconnect(); mo = null; }
    document.querySelectorAll("." + TRANS_CLASS).forEach((n) => n.remove());
    document
      .querySelectorAll("[" + DONE_ATTR + "]")
      .forEach((n) => n.removeAttribute(DONE_ATTR));
    removeBadge();
  }

  function toggle() {
    if (enabled) {
      disable();
      rememberHost(false); // forget this site so it won't auto-start later
    } else {
      chrome.storage.local.get(["btSrc", "btTgt"], (cfg) => {
        srcLang = cfg.btSrc || "en";
        tgtLang = cfg.btTgt || "vi";
        translatorPromise = null; // language pair may have changed
        rememberHost(true); // remember so reloads / redirects auto-start
        enable();
      });
    }
  }

  // ---- Persistence: which hosts have translation turned on ---------------
  //
  // The content script reloads from scratch on every page load (reload,
  // redirect, link click), so the previous page's state is gone. We persist
  // the set of enabled hostnames and auto-start on load for those hosts.

  function rememberHost(on) {
    chrome.storage.local.get(["btHosts"], (cfg) => {
      const hosts = cfg.btHosts && typeof cfg.btHosts === "object"
        ? cfg.btHosts
        : {};
      if (on) hosts[location.hostname] = true;
      else delete hosts[location.hostname];
      chrome.storage.local.set({ btHosts: hosts });
    });
  }

  function autoStart() {
    chrome.storage.local.get(["btHosts", "btSrc", "btTgt"], (cfg) => {
      const hosts = cfg.btHosts || {};
      if (!hosts[location.hostname]) return; // not enabled for this site
      srcLang = cfg.btSrc || "en";
      tgtLang = cfg.btTgt || "vi";
      translatorPromise = null;
      enable();
    });
  }

  // Re-translate with the latest language pair (triggered when the popup
  // changes From/To while translation is already on). Does NOT change host
  // membership — it just clears existing output and runs again.
  function reapply() {
    if (!enabled) return;
    chrome.storage.local.get(["btSrc", "btTgt"], (cfg) => {
      srcLang = cfg.btSrc || "en";
      tgtLang = cfg.btTgt || "vi";
      translatorPromise = null;
      if (io) { io.disconnect(); io = null; }
      if (mo) { mo.disconnect(); mo = null; }
      document.querySelectorAll("." + TRANS_CLASS).forEach((n) => n.remove());
      document
        .querySelectorAll("[" + DONE_ATTR + "]")
        .forEach((n) => n.removeAttribute(DONE_ATTR));
      started = false;
      showBadge();
      prepare();
    });
  }

  // ---- Tiny UI: status badge + toast ------------------------------------

  function badgeEl() {
    let b = document.getElementById("bt-badge");
    if (!b) {
      b = document.createElement("div");
      b.id = "bt-badge";
      document.documentElement.appendChild(b);
    }
    return b;
  }
  function showBadge() {
    setBadgeText(pair());
  }
  function setBadgeText(text) {
    const b = badgeEl();
    b.textContent = text;
    b.classList.remove("bt-clickable");
    b.onclick = null;
  }
  function setBadgeAction(text, fn) {
    const b = badgeEl();
    b.textContent = text;
    b.classList.add("bt-clickable");
    b.onclick = () => {
      b.classList.remove("bt-clickable");
      b.onclick = null;
      fn();
    };
  }
  function removeBadge() {
    document.getElementById("bt-badge")?.remove();
  }
  function toast(msg) {
    let t = document.getElementById("bt-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "bt-toast";
      document.documentElement.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = "0"; }, 5000);
  }
  function fail(msg) {
    toast(msg);
    setBadgeText("Error");
  }

  // ---- Messaging ---------------------------------------------------------

  chrome.runtime.onMessage.addListener((req) => {
    if (!req) return;
    if (req.type === "BT_TOGGLE") toggle();
    else if (req.type === "BT_RELOAD") reapply();
  });

  // Re-enable automatically if this site was left on in a previous session.
  autoStart();
})();
