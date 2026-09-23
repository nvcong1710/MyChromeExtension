// Shared translation result card used by both normal page selections and
// interactive video subtitles. store.js is loaded before this file.
(() => {
  if (self.VimiTranslationCard) return;

  const CARD_SELECTOR = ".vimi-translation-card";
  let activeCard = null;
  let activeCleanup = null;
  let activeShouldCloseOnOutside = null;
  let activeSpeechOwner = null;
  let activeUtterance = null;
  let interactionVersion = 0;

  const ICONS = Object.freeze({
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    languages: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/><path d="M3 12h18M12 3c2.2 2.5 3.3 5.5 3.3 9S14.2 18.5 12 21M12 3C9.8 5.5 8.7 8.5 8.7 12S9.8 18.5 12 21"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  });

  function formatLanguageCode(language, fallback) {
    const code = String(language || "").trim();
    if (!code) return fallback;
    if (/^auto(?:[-_ ]?detect)?$/i.test(code)) return "AUTO";
    return code.replaceAll("_", "-").toUpperCase();
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Some pages deny the async Clipboard API. Fall back to the browser's
        // legacy copy command while preserving the user's page selection.
      }
    }

    const selection = document.getSelection();
    const ranges = selection
      ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
      : [];
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      textarea.remove();
      if (selection && ranges.length) {
        selection.removeAllRanges();
        ranges.forEach((range) => selection.addRange(range));
      }
    }
    if (!copied) throw new Error("Copy command was rejected");
  }

  function stopTts(card) {
    if (activeSpeechOwner !== card || !activeUtterance) return;
    activeSpeechOwner = null;
    activeUtterance = null;
    try { speechSynthesis.cancel(); } catch {}
  }

  function close(card = activeCard, reason = "programmatic") {
    if (!card || card !== activeCard) return;
    const cleanup = activeCleanup;
    interactionVersion += 1;
    stopTts(card);
    activeCard = null;
    activeCleanup = null;
    activeShouldCloseOnOutside = null;
    card.remove();
    cleanup?.(reason);
  }

  function speak(text, lang, owner = null) {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      if (lang) utterance.lang = lang;
      speechSynthesis.cancel();
      activeSpeechOwner = owner;
      activeUtterance = utterance;
      const clearFinishedSpeech = () => {
        if (activeUtterance !== utterance) return;
        activeSpeechOwner = null;
        activeUtterance = null;
      };
      utterance.onend = clearFinishedSpeech;
      utterance.onerror = clearFinishedSpeech;
      speechSynthesis.speak(utterance);
    } catch {
      activeSpeechOwner = null;
      activeUtterance = null;
    }
  }

  async function isAlreadySaved(term, targetLanguage) {
    const vocab = await self.FuFu.getVocab();
    const normalized = term.trim().toLowerCase();
    return vocab.some(
      (word) =>
        (word.term || "").trim().toLowerCase() === normalized &&
        word.tgt === targetLanguage
    );
  }

  function enableLongDialogDrag(card, closeButton) {
    const header = card.querySelector(".vimi-translation-header");
    const margin = 12;
    let gesture = null;

    const clamp = (value, size, viewport) =>
      Math.max(margin, Math.min(value, Math.max(margin, viewport - size - margin)));

    const stop = (event) => {
      if (!gesture) return;
      if (event?.pointerId != null && event.pointerId !== gesture.pointerId) return;
      const pointerId = gesture.pointerId;
      gesture = null;
      header.classList.remove("vimi-translation-dragging");
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
      window.removeEventListener("blur", stop);
      if (header.hasPointerCapture?.(pointerId)) header.releasePointerCapture(pointerId);
    };

    const move = (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) <= 4) return;
      if (!gesture.moved) {
        gesture.moved = true;
        header.classList.add("vimi-translation-dragging");
        card.style.animation = "none";
        card.style.right = "auto";
      }
      card.style.left = `${clamp(gesture.left + dx, gesture.width, window.innerWidth)}px`;
      card.style.top = `${clamp(gesture.top + dy, gesture.height, window.innerHeight)}px`;
      event.preventDefault();
    };

    const start = (event) => {
      if (gesture || event.isPrimary === false || event.button !== 0) return;
      if (closeButton.contains(event.target) || event.target?.closest?.("button")) return;
      const rect = card.getBoundingClientRect();
      gesture = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
      };
      header.setPointerCapture?.(event.pointerId);
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", stop, true);
      window.addEventListener("pointercancel", stop, true);
      window.addEventListener("blur", stop);
      event.preventDefault();
    };

    const clampAfterResize = () => {
      if (card.style.right !== "auto") return;
      const rect = card.getBoundingClientRect();
      card.style.left = `${clamp(rect.left, rect.width, window.innerWidth)}px`;
      card.style.top = `${clamp(rect.top, rect.height, window.innerHeight)}px`;
    };

    header.addEventListener("pointerdown", start);
    return {
      clampAfterResize,
      cleanup() {
        stop();
        header.removeEventListener("pointerdown", start);
      },
    };
  }

  function show({
    sourceText,
    sourceLanguage,
    targetLanguage,
    context = "",
    url = location.href,
    translate,
    mountRoot = document.body,
    position,
    longSelection = false,
    onSaved,
    onClose,
    shouldCloseOnOutside,
  }) {
    close(activeCard, "replace");
    const cardVersion = ++interactionVersion;

    const card = document.createElement("div");
    card.className = longSelection
      ? "vimi-translation-card vimi-translation-long"
      : "vimi-translation-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", longSelection ? "Long translation" : "Translation");
    card.setAttribute("aria-busy", "true");
    card.innerHTML = `
      <div class="vimi-translation-header">
        <div class="vimi-language-direction">
          <span class="vimi-source-code"></span>
          <span class="vimi-language-arrow" aria-hidden="true">→</span>
          <span class="vimi-target-code"></span>
          <button type="button" class="vimi-icon-button vimi-language-settings-button" title="Change translation languages" aria-label="Change translation languages">${ICONS.languages}</button>
        </div>
        <button type="button" class="vimi-icon-button vimi-close-button" title="Close" aria-label="${longSelection ? "Close translation" : "Close translation popup"}">${ICONS.close}</button>
      </div>
      <div class="vimi-translation-body">
        ${longSelection
          ? '<div class="vimi-translation-source-section"><div class="vimi-translation-source"></div></div>'
          : '<div class="vimi-translation-source"></div>'}
        <div class="vimi-translation-divider" aria-hidden="true"></div>
        ${longSelection
          ? '<div class="vimi-translation-result-section"><div class="vimi-translation-result vimi-translation-loading">Translating…</div></div>'
          : '<div class="vimi-translation-result vimi-translation-loading">Translating…</div>'}
      </div>
      <div class="vimi-translation-actions">
        <button type="button" class="vimi-icon-button vimi-speak-button" title="Listen" aria-label="Listen to source text">${ICONS.volume}</button>
        <button type="button" class="vimi-icon-button vimi-copy-button" title="Copy translation" aria-label="Copy translation" disabled>${ICONS.copy}</button>
        ${longSelection ? "" : '<button type="button" class="vimi-save-button" disabled>Save</button>'}
      </div>`;

    card.querySelector(".vimi-translation-source").textContent = sourceText;
    const sourceCode = card.querySelector(".vimi-source-code");
    const targetCode = card.querySelector(".vimi-target-code");
    sourceCode.textContent = formatLanguageCode(sourceLanguage, "AUTO");
    sourceCode.title = sourceLanguage || "Auto-detect source language";
    targetCode.textContent = formatLanguageCode(targetLanguage, "?");
    targetCode.title = targetLanguage || "Unknown target language";
    card.querySelector(".vimi-language-direction").setAttribute(
      "aria-label",
      `${sourceLanguage || "Unknown language"} to ${targetLanguage || "Unknown language"}`
    );
    const result = card.querySelector(".vimi-translation-result");
    const closeButton = card.querySelector(".vimi-close-button");
    const languageSettingsButton = card.querySelector(".vimi-language-settings-button");
    const speakButton = card.querySelector(".vimi-speak-button");
    const copyButton = card.querySelector(".vimi-copy-button");
    const saveButton = card.querySelector(".vimi-save-button");
    let translatedText = "";
    let copyFeedbackTimer = null;
    let copying = false;
    let saved = false;

    // Keep popup actions from reaching the player or page beneath the card.
    for (const eventName of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
      card.addEventListener(eventName, (event) => event.stopPropagation());
    }
    mountRoot.appendChild(card);
    activeCard = card;
    activeShouldCloseOnOutside = shouldCloseOnOutside || null;
    const drag = longSelection ? enableLongDialogDrag(card, closeButton) : null;

    const reposition = () => {
      if (card === activeCard) {
        position?.(card);
        drag?.clampAfterResize();
      }
    };
    window.addEventListener("resize", reposition, { passive: true });
    activeCleanup = (reason) => {
      clearTimeout(copyFeedbackTimer);
      window.removeEventListener("resize", reposition);
      drag?.cleanup();
      onClose?.(card, reason);
    };
    reposition();

    closeButton.addEventListener("click", () => close(card, "close-button"));
    languageSettingsButton.addEventListener("click", () => {
      if (card !== activeCard) return;
      try { chrome.runtime.sendMessage({ type: "VIMI_OPEN_ACTION_POPUP" }); } catch {}
    });
    speakButton.addEventListener("click", () => {
      if (card !== activeCard) return;
      speak(sourceText, sourceLanguage, card);
    });

    const setSavedState = () => {
      saved = true;
      saveButton.disabled = true;
      saveButton.textContent = "Saved ✓";
      saveButton.classList.add("saved");
    };

    Promise.allSettled([
      Promise.resolve().then(() => translate(sourceText)),
      ...(longSelection ? [] : [isAlreadySaved(sourceText, targetLanguage)]),
    ]).then(([translationResult, savedResult]) => {
      if (card !== activeCard || cardVersion !== interactionVersion) return;

      if (translationResult.status === "fulfilled") {
        translatedText = translationResult.value || "";
        result.textContent = translatedText || "(no translation)";
        copyButton.disabled = !translatedText;
      } else {
        result.textContent = "(translation unavailable)";
      }
      result.classList.remove("vimi-translation-loading");
      card.setAttribute("aria-busy", "false");

      if (saveButton) {
        if (savedResult.status === "fulfilled" && savedResult.value) {
          setSavedState();
        } else {
          saveButton.disabled = false;
        }
      }
      reposition();
    });

    copyButton.addEventListener("click", async () => {
      if (!translatedText || copyButton.disabled || copying) return;
      copying = true;
      try {
        await copyText(translatedText);
        if (card !== activeCard || cardVersion !== interactionVersion) return;
        clearTimeout(copyFeedbackTimer);
        copyButton.innerHTML = ICONS.check;
        copyButton.classList.add("copied");
        copyFeedbackTimer = setTimeout(() => {
          if (card !== activeCard || cardVersion !== interactionVersion) return;
          copyButton.innerHTML = ICONS.copy;
          copyButton.classList.remove("copied");
        }, 1200);
      } catch {
        // Clipboard access can be denied by the page or browser. Keep the
        // action available without disturbing the popup lifecycle.
      } finally {
        copying = false;
      }
    });

    saveButton?.addEventListener("click", async () => {
      if (saved || saveButton.disabled) return;
      saveButton.disabled = true;
      saveButton.textContent = "Saving…";
      try {
        await self.FuFu.addWord({
          term: sourceText,
          translation: translatedText,
          src: sourceLanguage,
          tgt: targetLanguage,
          context,
          url,
        });
        if (card !== activeCard || cardVersion !== interactionVersion) return;
        setSavedState();
        onSaved?.();
      } catch {
        if (card !== activeCard || cardVersion !== interactionVersion) return;
        saveButton.disabled = false;
        saveButton.textContent = "Try again";
      }
    });

    return card;
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!activeCard || activeCard.contains(event.target)) return;
      if (activeShouldCloseOnOutside && !activeShouldCloseOnOutside(event)) return;
      close(activeCard, "outside");
    },
    true
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close(activeCard, "escape");
  });
  document.addEventListener(
    "scroll",
    (event) => {
      if (!activeCard?.contains(event.target) && !activeCard?.classList.contains("vimi-translation-long")) {
        close(activeCard, "scroll");
      }
    },
    { capture: true, passive: true }
  );
  document.addEventListener("fullscreenchange", () => close(activeCard, "fullscreen"));
  document.addEventListener("webkitfullscreenchange", () => close(activeCard, "fullscreen"));

  self.VimiTranslationCard = {
    CARD_SELECTOR,
    close,
    show,
    speak,
    isActive: (card) => !!card && card === activeCard,
  };
})();
