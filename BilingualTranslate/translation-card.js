// Shared translation result card used by both normal page selections and
// interactive video subtitles. store.js is loaded before this file.
(() => {
  if (self.VimiTranslationCard) return;

  const CARD_SELECTOR = ".vimi-translation-card";
  let activeCard = null;
  let activeCleanup = null;
  let activeShouldCloseOnOutside = null;
  let interactionVersion = 0;

  function close(card = activeCard, reason = "programmatic") {
    if (!card || card !== activeCard) return;
    const cleanup = activeCleanup;
    interactionVersion += 1;
    activeCard = null;
    activeCleanup = null;
    activeShouldCloseOnOutside = null;
    card.remove();
    cleanup?.(reason);
  }

  function speak(text, lang) {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      if (lang) utterance.lang = lang;
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    } catch {}
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

  function show({
    sourceText,
    sourceLanguage,
    targetLanguage,
    context = "",
    url = location.href,
    translate,
    mountRoot = document.body,
    position,
    badgeText = "",
    onSaved,
    onClose,
    shouldCloseOnOutside,
  }) {
    close(activeCard, "replace");
    const cardVersion = ++interactionVersion;

    const card = document.createElement("div");
    card.className = "vimi-translation-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Translation");
    card.setAttribute("aria-busy", "true");
    card.innerHTML = `
      <div class="vimi-translation-header">
        <div class="vimi-translation-heading">
          <div class="vimi-translation-source"></div>
          <div class="vimi-translation-meta" hidden></div>
        </div>
        <button type="button" class="vimi-close-button" title="Close" aria-label="Close translation">×</button>
      </div>
      <div class="vimi-translation-result vimi-translation-loading">Translating…</div>
      <div class="vimi-translation-actions">
        <button type="button" class="vimi-speak-button" title="Pronounce source text" aria-label="Pronounce source text">🔊</button>
        <button type="button" class="vimi-save-button" disabled>Save</button>
      </div>`;

    card.querySelector(".vimi-translation-source").textContent = sourceText;
    if (badgeText) {
      const chip = document.createElement("span");
      chip.className = "vimi-pop-chip";
      chip.textContent = badgeText;
      const meta = card.querySelector(".vimi-translation-meta");
      meta.hidden = false;
      meta.appendChild(chip);
    }
    const result = card.querySelector(".vimi-translation-result");
    const closeButton = card.querySelector(".vimi-close-button");
    const speakButton = card.querySelector(".vimi-speak-button");
    const saveButton = card.querySelector(".vimi-save-button");

    // Keep popup actions from reaching the player or page beneath the card.
    for (const eventName of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
      card.addEventListener(eventName, (event) => event.stopPropagation());
    }
    mountRoot.appendChild(card);
    activeCard = card;
    activeCleanup = (reason) => onClose?.(card, reason);
    activeShouldCloseOnOutside = shouldCloseOnOutside || null;

    const reposition = () => {
      if (card === activeCard) position?.(card);
    };
    reposition();

    closeButton.addEventListener("click", () => close(card, "close-button"));
    speakButton.addEventListener("click", () => {
      speak(sourceText, sourceLanguage);
    });

    let translatedText = "";
    let saved = false;
    const setSavedState = () => {
      saved = true;
      saveButton.disabled = true;
      saveButton.textContent = "Saved ✓";
      saveButton.classList.add("saved");
    };

    Promise.allSettled([
      Promise.resolve().then(() => translate(sourceText)),
      isAlreadySaved(sourceText, targetLanguage),
    ]).then(([translationResult, savedResult]) => {
      if (card !== activeCard || cardVersion !== interactionVersion) return;

      if (translationResult.status === "fulfilled") {
        translatedText = translationResult.value || "";
        result.textContent = translatedText || "(no translation)";
      } else {
        result.textContent = "(translation unavailable)";
      }
      result.classList.remove("vimi-translation-loading");
      card.setAttribute("aria-busy", "false");

      if (savedResult.status === "fulfilled" && savedResult.value) {
        setSavedState();
      } else {
        saveButton.disabled = false;
      }
      reposition();
    });

    saveButton.addEventListener("click", async () => {
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
      if (!activeCard?.contains(event.target)) close(activeCard, "scroll");
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
