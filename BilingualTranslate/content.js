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
  // Interactive descendants whose labels shouldn't be merged into a block of
  // translatable prose (button bars, nav/link clusters, cookie banners…).
  const INTERACTIVE_SEL =
    'a[href], button, [role="button"], [role="tab"], [role="menuitem"], input, select, textarea, label';
  // Icon-font glyphs (private-use area), emoji/pictographs, and the joiners /
  // variation selectors that compose them. These carry no meaning for the
  // translator and, fed in, produce stray characters in the output — strip
  // them before sending text to the model.
  const ICON_RE =
    /[-]|\p{Extended_Pictographic}|[︀-️‍⃣]/gu;

  // Drop icons/emoji and collapse whitespace so the translator sees clean prose.
  function cleanText(s) {
    return (s || "").replace(ICON_RE, " ").replace(/\s+/g, " ").trim();
  }

  let enabled = false;
  let started = false;
  let srcLang = "en";
  let tgtLang = "vi";
  let transColor = "";
  let translatorPromise = null;
  let io = null;
  let mo = null;
  let scanScheduled = false;

  // Reading-aid prefs (in-page vocab features; all opt-in, default off).
  let highlightSaved = false;
  let inlineLearn = false;
  let revealMode = false;

  const pair = () => `${srcLang}→${tgtLang}`;

  // Notify the Vimi mascot (mascot.js) about app events.
  function vimiEvent(detail) {
    try {
      window.dispatchEvent(new CustomEvent("vimi:event", { detail }));
    } catch {}
  }
  // Let the mascot's quick menu toggle translation on this tab and read the
  // current state so it can label the item ("Translate" vs "Show original").
  window.__vimi = { toggle: () => toggle(), isOn: () => enabled };

  // Apply the user's custom translation color (or clear it to use the CSS
  // default) via a CSS variable, so existing and future blocks update at once.
  function applyTransColor() {
    const root = document.documentElement;
    if (transColor) root.style.setProperty("--bt-trans-color", transColor);
    else root.style.removeProperty("--bt-trans-color");
  }

  // Load language config early so select-to-save works before (or without)
  // turning on full-page translation.
  F.getConfig().then((cfg) => {
    srcLang = cfg.src || "en";
    tgtLang = cfg.tgt || "vi";
    transColor = cfg.transColor || "";
    highlightSaved = !!cfg.highlightSaved;
    inlineLearn = !!cfg.inlineLearn;
    revealMode = !!cfg.revealMode;
    applyTransColor();
    applyReadingPrefs();
    refreshVocabFeatures();
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
            setBadgeProgress(`Downloading model ${pair()} ${pct}%`);
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
    if (!text || !text.trim()) return "";
    // 1. Try on-device Chrome Translator API if available
    try {
      const t = await getTranslator();
      const out = await t.translate(text);
      if (out && out.trim()) return out;
    } catch {
      // On-device unavailable, downloading, or unsupported — use background fallback
    }

    // 2. High-speed resilient background service worker fallback
    try {
      if (!chrome?.runtime?.id) return "";
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "FUFU_TRANSLATE",
            text,
            src: srcLang || "auto",
            tgt: tgtLang || "vi",
          },
          (r) => resolve(r || {})
        );
      });
      if (res && res.translation) return res.translation;
    } catch (err) {
      if (!String(err?.message || "").includes("Extension context invalidated")) {
        console.warn("[Vimi] Translation fallback error:", err);
      }
    }
    return "";
  }

  // ── Block selection (full-page translation) ────────────────────────────
  function hasSkippedAncestor(el) {
    if (el.closest?.('[data-bt-translatable="true"]')) return false;
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (SKIP_ANCESTORS.has(n.tagName)) return true;
      if (n.isContentEditable) return true;
      if (n.matches?.(".vimi-translation-card") || n.id === "bt-badge") return true;
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

  // True if the element is essentially a cluster of controls (button bar, nav
  // links, cookie banner): once the labels of its interactive descendants are
  // removed, almost no prose remains. Translating these concatenates unrelated
  // labels into one garbled string, so they're skipped. A single link wrapping
  // a heading/title is fine (one control), and prose with inline links keeps
  // plenty of surrounding text, so neither is treated as a cluster.
  function looksLikeControlCluster(el) {
    const controls = el.querySelectorAll(INTERACTIVE_SEL);
    if (controls.length < 2) return false;
    let controlLen = 0;
    controls.forEach((c) => {
      controlLen += cleanText(c.innerText || "").length;
    });
    const total = cleanText(el.innerText || "").length;
    return total - controlLen < MIN_LEN;
  }

  // Skip elements that aren't actually visible — hover tooltips, collapsed
  // dropdowns and off-state menus are often laid out (so the observer sees
  // them) yet hidden via display/visibility/opacity. Translating them inserts
  // text that pops into view on hover and breaks the layout.
  function isHidden(el) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility !== "visible") return true; // visibility inherits
    if (parseFloat(cs.opacity) === 0) return true;
    if (el.getClientRects().length === 0) return true;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const ps = getComputedStyle(n);
      if (ps.display === "none" || parseFloat(ps.opacity) === 0) return true;
    }
    return false;
  }

  function isCandidate(el) {
    if (el.hasAttribute(DONE_ATTR)) return false;
    if (el.classList.contains(TRANS_CLASS)) return false;
    if (SKIP_ANCESTORS.has(el.tagName)) return false;
    if (containsTextBlock(el)) return false; // leaf-only (ignores empty wrappers)
    if (hasSkippedAncestor(el)) return false;
    if (looksLikeControlCluster(el)) return false;
    if (isHidden(el)) return false;
    const text = cleanText(el.innerText || "");
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

  // Place the translation so it doesn't break layout. Inside table cells and
  // list items the original is appended-to (a sibling <div> would become a
  // stray cell/list-item and shove the real cells sideways); everywhere else it
  // goes right after the block.
  function insertTranslation(el, div) {
    const tag = el.tagName;
    if (tag === "TD" || tag === "TH" || tag === "LI") el.appendChild(div);
    else el.insertAdjacentElement("afterend", div);
  }

  async function translateBlock(el) {
    const text = cleanText(el.innerText || "");
    if (text.length < MIN_LEN || !HAS_LETTER.test(text)) {
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
      insertTranslation(el, div);
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
    applyTransColor();
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
      transColor = cfg.transColor || "";
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
    transColor = cfg.transColor || "";
    translatorPromise = null;
    if (io) { io.disconnect(); io = null; }
    if (mo) { mo.disconnect(); mo = null; }
    document.querySelectorAll("." + TRANS_CLASS).forEach((n) => n.remove());
    document
      .querySelectorAll("[" + DONE_ATTR + "]")
      .forEach((n) => n.removeAttribute(DONE_ATTR));
    started = false;
    applyTransColor();
    showBadge();
    prepare();
  }

  async function autoStart() {
    const hosts = await F.getHosts();
    if (!hosts[location.hostname]) return;
    const cfg = await F.getConfig();
    srcLang = cfg.src || "en";
    tgtLang = cfg.tgt || "vi";
    transColor = cfg.transColor || "";
    translatorPromise = null;
    enable();
  }

  // ── Select-to-save vocabulary ──────────────────────────────────────────
  let selPop = null;
  let selectionOpenTimer = null;
  let selectionRequestVersion = 0;
  let dismissedSelectionText = "";

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

  function removeSelPop(reason = "programmatic") {
    selectionRequestVersion += 1;
    clearTimeout(selectionOpenTimer);
    selectionOpenTimer = null;
    if (selPop) self.VimiTranslationCard.close(selPop, reason);
  }

  function positionSelectionCard(card, rect) {
    const gap = 8;
    const left = Math.max(gap, Math.min(rect.left, window.innerWidth - card.offsetWidth - gap));
    const above = rect.top - card.offsetHeight - gap;
    const top = above >= gap
      ? above
      : Math.min(window.innerHeight - card.offsetHeight - gap, rect.bottom + gap);
    card.style.left = `${left}px`;
    card.style.top = `${Math.max(gap, top)}px`;
  }

  async function showSelPopup(term, rect, context) {
    if (selPop) self.VimiTranslationCard.close(selPop, "replace");
    selPop = self.VimiTranslationCard.show({
      sourceText: term,
      sourceLanguage: srcLang,
      targetLanguage: tgtLang,
      context,
      translate: translateText,
      position: (card) => positionSelectionCard(card, rect),
      onSaved: () => vimiEvent({ pose: "happy", say: "Saved! 📚", ttl: 2500 }),
      onClose: (card, reason) => {
        if (selPop === card) selPop = null;
        if (reason === "outside") {
          dismissedSelectionText = window.getSelection()?.toString().trim() || "";
        }
      },
    });
  }

  document.addEventListener("mouseup", (e) => {
    if (selPop && selPop.contains(e.target)) return; // click inside popup
    clearTimeout(selectionOpenTimer);
    const requestVersion = ++selectionRequestVersion;
    selectionOpenTimer = setTimeout(() => {
      selectionOpenTimer = null;
      if (requestVersion !== selectionRequestVersion) return;
      const sel = window.getSelection();
      const term = sel ? sel.toString().trim() : "";
      if (dismissedSelectionText && term === dismissedSelectionText) {
        dismissedSelectionText = "";
        return;
      }
      dismissedSelectionText = "";
      // Only react to short selections (a word or brief phrase).
      if (!term || term.length < 2 || term.length > 60 || !HAS_LETTER.test(term)) {
        removeSelPop();
        return;
      }
      const node = sel.anchorNode;
      const host = node && node.nodeType === 3 ? node.parentElement : node;
      if (host) {
        if (host.closest(".vimi-translation-card, .vimi-sub-overlay, input, textarea")) return;
        if (host.closest("[contenteditable]") && !host.closest('[data-bt-translatable="true"]')) return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      const context = sentenceAround(range);
      showSelPopup(term, rect, context);
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    if (selPop && !selPop.contains(e.target)) {
      dismissedSelectionText = window.getSelection()?.toString().trim() || "";
      removeSelPop("outside");
    }
  });
  document.addEventListener("scroll", () => removeSelPop("scroll"), { passive: true });

  // ── Reading aids: highlight saved words + inline "sprinkle" learning ────
  // Both walk the page's text for words you've already saved. Highlight mode
  // underlines them (hover for the meaning); inline mode swaps a few of them
  // for their translation (click to flip back). Pure DOM, no translator calls.
  const MAX_SPRINKLE = 12; // cap inline swaps per page so reading stays readable
  const VOCAB_SKIP_SEL =
    ".vimi-translation-card, #bt-badge, #bt-toast, .bt-translation, .vimi-vocab, input, textarea, [contenteditable]";
  let vocabIndex = null; // { regex, map: lowercased term -> word }
  let sprinkledIds = new Set();
  let sprinkledCount = 0;
  let vocabMO = null;
  let vocabScanScheduled = false;

  function applyReadingPrefs() {
    document.documentElement.classList.toggle("vimi-reveal", !!revealMode);
  }

  async function buildVocabIndex() {
    vocabIndex = null;
    if (!highlightSaved && !inlineLearn) return;
    const vocab = await F.getVocab();
    const map = new Map();
    const terms = [];
    for (const w of vocab) {
      const t = (w.term || "").trim();
      if (t.length < 2 || t.length > 40 || !w.translation) continue;
      // Only words in the language you're reading (matches the page text).
      if (w.src && srcLang && w.src !== srcLang) continue;
      const key = t.toLowerCase();
      if (map.has(key)) continue;
      map.set(key, w);
      terms.push(t);
      if (terms.length >= 400) break; // keep the regex bounded
    }
    if (!terms.length) return;
    terms.sort((a, b) => b.length - a.length); // prefer longer phrases
    const alt = terms.map(F.escapeRegExp).join("|");
    try {
      const regex = new RegExp(`(?<![\\p{L}\\p{N}])(${alt})(?![\\p{L}\\p{N}])`, "giu");
      vocabIndex = { regex, map };
    } catch {
      vocabIndex = null; // malformed term — skip silently
    }
  }

  function skipVocabParent(el) {
    if (!el || !el.closest) return true;
    if (el.closest(VOCAB_SKIP_SEL)) return true;
    for (let n = el; n; n = n.parentElement) {
      if (SKIP_ANCESTORS.has(n.tagName)) return true;
    }
    return false;
  }

  // Split a text node, wrapping each saved-word match in a <span>. Idempotent
  // across re-scans: matches become .vimi-vocab spans, which are skipped next
  // time, and unmatched text never matches — so re-running can't double-wrap.
  function wrapMatches(node, mode) {
    const text = node.nodeValue;
    const re = vocabIndex.regex;
    re.lastIndex = 0;
    let m, last = 0, count = 0;
    const frag = document.createDocumentFragment();
    while ((m = re.exec(text))) {
      const matched = m[1];
      const word = vocabIndex.map.get(matched.toLowerCase());
      if (!word) continue;
      if (mode === "replace") {
        if (sprinkledCount >= MAX_SPRINKLE) break;
        if (sprinkledIds.has(word.id)) continue; // each word swapped once/page
      }
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement("span");
      span.dataset.id = word.id;
      if (mode === "replace") {
        span.className = "vimi-vocab vimi-replace";
        span.dataset.orig = matched;
        span.dataset.trans = word.translation;
        span.dataset.showing = "trans";
        span.textContent = word.translation;
        span.title = `${matched} ⇄ ${word.translation} (click to flip)`;
        sprinkledIds.add(word.id);
        sprinkledCount++;
      } else {
        span.className = "vimi-vocab vimi-hl";
        span.textContent = matched;
        span.title = word.translation + (word.context ? `\n“${word.context}”` : "");
      }
      frag.appendChild(span);
      last = m.index + matched.length;
      count++;
    }
    if (!count) return 0;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
    return count;
  }

  function scanVocab(root, mode) {
    if (!vocabIndex || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const v = node.nodeValue;
        if (!v || v.length < 2 || !/\S/.test(v)) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (skipVocabParent(p)) return NodeFilter.FILTER_REJECT;
        vocabIndex.regex.lastIndex = 0;
        return vocabIndex.regex.test(v) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (mode === "replace" && sprinkledCount >= MAX_SPRINKLE) break;
      wrapMatches(node, mode);
    }
  }

  function runVocabScan() {
    vocabScanScheduled = false;
    if (!vocabIndex) return;
    if (vocabMO) vocabMO.disconnect(); // our own edits shouldn't re-trigger us
    if (inlineLearn) scanVocab(document.body, "replace");
    if (highlightSaved) scanVocab(document.body, "highlight");
    if (vocabMO) vocabMO.observe(document.body, { childList: true, subtree: true });
  }
  function scheduleVocabScan() {
    if (vocabScanScheduled) return;
    vocabScanScheduled = true;
    requestAnimationFrame(runVocabScan);
  }

  function clearVocabMarks() {
    document.querySelectorAll(".vimi-vocab").forEach((s) => {
      const txt = s.classList.contains("vimi-replace") ? (s.dataset.orig || s.textContent) : s.textContent;
      const parent = s.parentNode;
      s.replaceWith(document.createTextNode(txt));
      parent && parent.normalize(); // merge the split text nodes back together
    });
  }

  async function refreshVocabFeatures() {
    clearVocabMarks();
    sprinkledIds = new Set();
    sprinkledCount = 0;
    if (vocabMO) { vocabMO.disconnect(); vocabMO = null; }
    if (!document.body) return;
    if (!highlightSaved && !inlineLearn) { vocabIndex = null; return; }
    await buildVocabIndex();
    if (!vocabIndex) return;
    vocabMO = new MutationObserver(() => scheduleVocabScan());
    runVocabScan();
  }

  // Flip an inline-swapped word between its translation and the original.
  document.addEventListener("click", (e) => {
    const r = e.target.closest && e.target.closest(".vimi-replace");
    if (!r) return;
    e.preventDefault();
    if (r.dataset.showing === "trans") {
      r.textContent = r.dataset.orig;
      r.dataset.showing = "orig";
    } else {
      r.textContent = r.dataset.trans;
      r.dataset.showing = "trans";
    }
  });

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
  let badgeHideTimer = null;
  function showBadge() { setBadgeText(pair()); }
  // A discrete status (language pair, "Preparing…", errors): show the badge,
  // then fade it after a few seconds so it never sits on top of the page's
  // controls. Each call restarts the timer.
  function setBadgeText(text) {
    const b = badgeEl();
    b.textContent = text;
    b.classList.remove("bt-clickable", "bt-hidden");
    b.onclick = null;
    clearTimeout(badgeHideTimer);
    badgeHideTimer = setTimeout(() => b.classList.add("bt-hidden"), 3000);
  }
  // A live progress tick (model download %). Updates the text in place only
  // while the badge is still showing — it does NOT restart the hide timer, so
  // the badge fades out after its few seconds even though the (possibly long)
  // download keeps running in the background. Once faded, further ticks are
  // ignored; the final setBadgeText(pair()) re-shows it briefly when ready.
  function setBadgeProgress(text) {
    const b = document.getElementById("bt-badge");
    if (!b || b.classList.contains("bt-hidden")) return;
    b.textContent = text;
  }
  function setBadgeAction(text, fn) {
    const b = badgeEl();
    b.textContent = text;
    // Stays put — this badge is the click target Chrome needs to start the
    // first-run model download, so it must not auto-hide.
    clearTimeout(badgeHideTimer);
    b.classList.remove("bt-hidden");
    b.classList.add("bt-clickable");
    b.onclick = () => {
      b.classList.remove("bt-clickable");
      b.onclick = null;
      fn();
    };
  }
  function removeBadge() {
    clearTimeout(badgeHideTimer);
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
    else if (req.type === "BT_OFF") { if (enabled) disable(); } // site removed in Settings
    else if (req.type === "BT_STYLE") {
      // Live appearance / reading-aid change — no re-translation of the page.
      F.getConfig().then((cfg) => {
        transColor = cfg.transColor || "";
        const reveal = !!cfg.revealMode;
        const hl = !!cfg.highlightSaved;
        const inl = !!cfg.inlineLearn;
        const vocabChanged = hl !== highlightSaved || inl !== inlineLearn;
        revealMode = reveal;
        highlightSaved = hl;
        inlineLearn = inl;
        applyTransColor();
        applyReadingPrefs();
        if (vocabChanged) refreshVocabFeatures();
      });
    } else if (req.type === "FUFU_LOOKUP") {
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
