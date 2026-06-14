// FuFu Bilingual — content script. (store.js is loaded before this and exposes
// self.FuFu.)
//
// Two independent features live here:
//   1. In-place bilingual translation (toggle per site, lazy, on-device).
//   2. Select-to-save: highlight a word/phrase → a small popup offers its
//      translation, pronunciation, and a Save-to-vocab button (with the
//      surrounding sentence captured as context).
//
// Languages come from FuFu config (fufuConfig.src / .tgt), shared with the
// popup and options pages.

(() => {
  if (window.__fufuLoaded) return; // guard against double injection
  window.__fufuLoaded = true;

  const F = self.FuFu;
  const DONE_ATTR = "data-bt-done";
  const TRANS_CLASS = "bt-translation";
  const BLOCK_SELECTOR =
    "p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, figcaption, td, div";
  const SKIP_ANCESTORS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "KBD", "SAMP",
    "TEXTAREA", "INPUT", "SELECT", "BUTTON", "SVG",
  ]);
  const MIN_LEN = 12;
  const HAS_LETTER = /\p{L}{2,}/u;

  let enabled = false;
  let started = false;
  let srcLang = "en";
  let tgtLang = "vi";
  let translatorPromise = null;
  let io = null;
  let mo = null;
  let scanScheduled = false;

  const pair = () => `${srcLang}→${tgtLang}`;

  // Notify the Vimi mascot (mascot.js) about app events.
  function vimiEvent(detail) {
    try {
      window.dispatchEvent(new CustomEvent("vimi:event", { detail }));
    } catch {}
  }
  // Let the mascot's quick menu toggle translation on this tab.
  window.__vimi = { toggle: () => toggle() };

  // Load language config early so select-to-save works before (or without)
  // turning on full-page translation.
  F.getConfig().then((cfg) => {
    srcLang = cfg.src || "en";
    tgtLang = cfg.tgt || "vi";
  });

  // ── Translator engine ─────────────────────────────────────────────────
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
    })().catch((err) => {
      translatorPromise = null; // don't cache failures — allow retry
      throw err;
    });
    return translatorPromise;
  }

  async function translateText(text) {
    const t = await getTranslator();
    return t.translate(text);
  }

  // ── Block selection (full-page translation) ────────────────────────────
  function hasSkippedAncestor(el) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (SKIP_ANCESTORS.has(n.tagName)) return true;
      if (n.isContentEditable) return true;
      if (n.id === "fufu-sel-pop" || n.id === "bt-badge") return true;
    }
    return false;
  }

  // True if a descendant block carries real text — meaning this element is a
  // container whose children should be translated instead (avoids duplicate,
  // nested translation). Empty/decorative wrapper divs are ignored, so an
  // element holding text plus a decorative child div is still translated.
  function containsTextBlock(el) {
    for (const child of el.querySelectorAll(BLOCK_SELECTOR)) {
      const t = (child.innerText || "").trim();
      if (t.length >= MIN_LEN && HAS_LETTER.test(t)) return true;
    }
    return false;
  }

  function isCandidate(el) {
    if (el.hasAttribute(DONE_ATTR)) return false;
    if (el.classList.contains(TRANS_CLASS)) return false;
    if (SKIP_ANCESTORS.has(el.tagName)) return false;
    if (containsTextBlock(el)) return false; // leaf-only (ignores empty wrappers)
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

  async function translateBlock(el) {
    const text = (el.innerText || "").trim();
    if (!text) {
      el.setAttribute(DONE_ATTR, "skip");
      return;
    }
    try {
      const out = await translateText(text);
      if (!enabled) return;
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
      started = false;
      setBadgeAction(`Click to download model & translate ${pair()}`, startTranslating);
    } else {
      fail(`Translation error (${pair()}): ${msg}`);
    }
  }

  // ── Enable / disable full-page translation ─────────────────────────────
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
        startTranslating();
      } else {
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
      await getTranslator();
      if (!enabled) return;
      setBadgeText(pair());
      vimiEvent({ pose: "think", say: "Translating this page…", ttl: 3500 });
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

  async function toggle() {
    if (enabled) {
      disable();
      await F.setHostEnabled(location.hostname, false);
    } else {
      const cfg = await F.getConfig();
      srcLang = cfg.src || "en";
      tgtLang = cfg.tgt || "vi";
      translatorPromise = null;
      await F.setHostEnabled(location.hostname, true);
      enable();
    }
  }

  async function reapply() {
    if (!enabled) return;
    const cfg = await F.getConfig();
    srcLang = cfg.src || "en";
    tgtLang = cfg.tgt || "vi";
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
  }

  async function autoStart() {
    const hosts = await F.getHosts();
    if (!hosts[location.hostname]) return;
    const cfg = await F.getConfig();
    srcLang = cfg.src || "en";
    tgtLang = cfg.tgt || "vi";
    translatorPromise = null;
    enable();
  }

  // ── Select-to-save vocabulary ──────────────────────────────────────────
  let selPop = null;

  function sentenceAround(range) {
    // Use the nearest block element's text as the context sentence.
    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    let block = node;
    while (block && block !== document.body) {
      if (/^(P|LI|BLOCKQUOTE|TD|DD|H[1-6]|FIGCAPTION|DIV|SPAN)$/.test(block.tagName)) {
        const txt = (block.innerText || "").trim();
        if (txt.length > 20) break;
      }
      block = block.parentElement;
    }
    const txt = block ? (block.innerText || "").trim() : "";
    return txt.length > 300 ? txt.slice(0, 300) + "…" : txt;
  }

  function removeSelPop() {
    if (selPop) { selPop.remove(); selPop = null; }
  }

  function speak(text, lang) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {}
  }

  async function showSelPopup(term, rect, context) {
    removeSelPop();
    const pop = document.createElement("div");
    pop.id = "fufu-sel-pop";
    pop.innerHTML = `
      <div class="fufu-sp-term"></div>
      <div class="fufu-sp-trans">…</div>
      <div class="fufu-sp-actions">
        <button class="fufu-sp-speak" title="Pronounce">🔊</button>
        <button class="fufu-sp-save">Save</button>
      </div>`;
    pop.querySelector(".fufu-sp-term").textContent = term;
    document.body.appendChild(pop);
    selPop = pop;

    // Position above the selection, clamped to the viewport.
    const top = window.scrollY + rect.top - pop.offsetHeight - 8;
    const left = Math.max(
      8,
      Math.min(
        window.scrollX + rect.left,
        window.scrollX + window.innerWidth - pop.offsetWidth - 8
      )
    );
    pop.style.top = `${top < window.scrollY ? window.scrollY + rect.bottom + 8 : top}px`;
    pop.style.left = `${left}px`;

    const transEl = pop.querySelector(".fufu-sp-trans");
    let translation = "";
    try {
      translation = await translateText(term);
      transEl.textContent = translation || "(no translation)";
    } catch {
      transEl.textContent = "(translation unavailable)";
    }

    pop.querySelector(".fufu-sp-speak").addEventListener("click", (e) => {
      e.stopPropagation();
      speak(term, srcLang);
    });
    pop.querySelector(".fufu-sp-save").addEventListener("click", async (e) => {
      e.stopPropagation();
      await F.addWord({
        term,
        translation,
        src: srcLang,
        tgt: tgtLang,
        context,
        url: location.href,
      });
      const btn = pop.querySelector(".fufu-sp-save");
      btn.textContent = "Saved ✓";
      btn.classList.add("saved");
      vimiEvent({ pose: "happy", say: "Saved! 📚", ttl: 2500 });
      setTimeout(removeSelPop, 900);
    });
  }

  document.addEventListener("mouseup", (e) => {
    if (selPop && selPop.contains(e.target)) return; // click inside popup
    setTimeout(() => {
      const sel = window.getSelection();
      const term = sel ? sel.toString().trim() : "";
      // Only react to short selections (a word or brief phrase).
      if (!term || term.length < 2 || term.length > 60 || !HAS_LETTER.test(term)) {
        removeSelPop();
        return;
      }
      const node = sel.anchorNode;
      const host = node && node.nodeType === 3 ? node.parentElement : node;
      if (host && (host.closest("#fufu-sel-pop, input, textarea, [contenteditable]"))) {
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      const context = sentenceAround(range);
      showSelPopup(term, rect, context);
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    if (selPop && !selPop.contains(e.target)) removeSelPop();
  });
  document.addEventListener("scroll", removeSelPop, { passive: true });

  // ── Tiny UI: status badge + toast ──────────────────────────────────────
  function badgeEl() {
    let b = document.getElementById("bt-badge");
    if (!b) {
      b = document.createElement("div");
      b.id = "bt-badge";
      document.documentElement.appendChild(b);
    }
    return b;
  }
  function showBadge() { setBadgeText(pair()); }
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

  // ── Messaging ───────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (!req) return;
    if (req.type === "BT_TOGGLE") toggle();
    else if (req.type === "BT_RELOAD") reapply();
    else if (req.type === "FUFU_LOOKUP") {
      // Right-click save: return translation + context for the selection.
      const sel = window.getSelection();
      let context = "";
      try {
        if (sel && sel.rangeCount) context = sentenceAround(sel.getRangeAt(0));
      } catch {}
      (async () => {
        let translation = "";
        try { translation = await translateText(req.term); } catch {}
        sendResponse({ translation, context, src: srcLang, tgt: tgtLang });
      })();
      return true; // async response
    }
  });

  autoStart();
})();
