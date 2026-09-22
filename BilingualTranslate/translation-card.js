// Shared translation card used by both normal text selections and video
// subtitle word lookups. store.js is loaded first and exposes self.FuFu.
(() => {
  if (window.VimiTranslationCard) return;

  const F = self.FuFu;
  let active = null;

  function speak(text, lang) {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      if (lang) utterance.lang = lang;
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    } catch (error) {
      console.error("[Vimi] Failed to pronounce source text:", error);
    }
  }

  function stopEvent(event) {
    event.stopPropagation();
  }

  function close(expectedElement, reason = "programmatic", sourceEvent = null) {
    if (!active) return;
    if (expectedElement && active.element !== expectedElement) return;
    const current = active;
    active = null;
    current.cleanup.forEach((cleanup) => cleanup());
    current.element.remove();
    try { current.onClose?.(reason, sourceEvent); } catch {}
  }

  function contains(target) {
    return !!(active && active.element.contains(target));
  }

  function setSaved(button) {
    button.disabled = true;
    button.textContent = "Saved ✓";
    button.classList.remove("is-loading");
    button.classList.add("is-saved");
  }

  async function markExistingWord(sourceText, targetLanguage, button, instance, ensureContext) {
    try {
      if (ensureContext && !ensureContext()) return;
      const vocab = await F.getVocab();
      if (ensureContext && !ensureContext()) return;
      if (active !== instance) return;
      const saved = vocab.some(
        (word) =>
          (word.term || "").trim().toLowerCase() === sourceText.toLowerCase() &&
          (!targetLanguage || word.tgt === targetLanguage)
      );
      if (saved) setSaved(button);
    } catch {}
  }

  function positionCard(card, anchorRect, align) {
    const margin = 8;
    const gap = 8;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const anchorLeft = align === "center"
      ? anchorRect.left + anchorRect.width / 2 - width / 2
      : anchorRect.left;
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, anchorLeft));
    const above = anchorRect.top - height - gap;
    const below = anchorRect.bottom + gap;
    const top = above >= margin
      ? above
      : Math.max(margin, Math.min(window.innerHeight - height - margin, below));

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function show({
    sourceText,
    translatedText,
    translate,
    sourceLanguage,
    targetLanguage,
    badgeText = "",
    context = "",
    url = location.href,
    anchorRect,
    align = "start",
    mountRoot,
    onSaved,
    onClose,
    closeAfterSave = true,
    shouldIgnoreOutsidePointer,
    ensureContext,
  }) {
    close(null, "replace");

    const root = mountRoot || document.body;
    const card = document.createElement("div");
    card.className = "vimi-translation-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Translation");
    card.innerHTML = `
      <button type="button" class="vimi-close-button" title="Close" aria-label="Close translation">×</button>
      <div class="vimi-translation-source-row">
        <div class="vimi-translation-source"></div>
      </div>
      <div class="vimi-translation-result is-loading" aria-live="polite">Translating…</div>
      <div class="vimi-translation-actions">
        <button type="button" class="vimi-speak-button" title="Pronounce source text" aria-label="Pronounce source text">🔊</button>
        <button type="button" class="vimi-save-button">Save</button>
      </div>`;
    card.querySelector(".vimi-translation-source").textContent = sourceText;
    if (badgeText) {
      const chip = document.createElement("span");
      chip.className = "vimi-pop-chip";
      chip.textContent = badgeText;
      card.querySelector(".vimi-translation-source-row").appendChild(chip);
    }
    root.appendChild(card);

    const instance = { element: card, cleanup: [], onClose };
    active = instance;
    positionCard(card, anchorRect, align);

    // Keep all card interaction from reaching the page or video underneath.
    ["pointerdown", "mousedown", "mouseup", "click", "dblclick"].forEach((type) => {
      card.addEventListener(type, stopEvent);
    });
    card.addEventListener("pointerdown", () => {
      if (ensureContext) ensureContext();
    });

    const outsidePointer = (event) => {
      if (card.contains(event.target)) return;
      try {
        if (shouldIgnoreOutsidePointer?.(event)) return;
      } catch {}
      close(card, "outside", event);
    };
    const escapeKey = (event) => {
      if (event.key === "Escape") close(card, "escape", event);
    };
    const closeOnScroll = (event) => {
      if (event.target instanceof Node && card.contains(event.target)) return;
      close(card, "scroll", event);
    };
    const closeOnResize = (event) => close(card, "resize", event);
    const closeOnFullscreenChange = (event) => close(card, "fullscreen", event);
    document.addEventListener("pointerdown", outsidePointer, true);
    document.addEventListener("keydown", escapeKey, true);
    document.addEventListener("fullscreenchange", closeOnFullscreenChange);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnResize);
    instance.cleanup.push(
      () => document.removeEventListener("pointerdown", outsidePointer, true),
      () => document.removeEventListener("keydown", escapeKey, true),
      () => document.removeEventListener("fullscreenchange", closeOnFullscreenChange),
      () => window.removeEventListener("scroll", closeOnScroll, true),
      () => window.removeEventListener("resize", closeOnResize)
    );

    const result = card.querySelector(".vimi-translation-result");
    const saveButton = card.querySelector(".vimi-save-button");
    saveButton.disabled = true;
    let translation = translatedText || "";

    const renderTranslation = (text, fallback) => {
      if (active !== instance) return;
      translation = text || "";
      result.textContent = translation || fallback;
      result.classList.remove("is-loading");
      if (!saveButton.classList.contains("is-saved")) saveButton.disabled = false;
      positionCard(card, anchorRect, align);
    };

    if (translatedText != null) {
      renderTranslation(translatedText, "(no translation)");
    } else if (typeof translate === "function") {
      Promise.resolve()
        .then(() => translate(sourceText))
        .then((text) => renderTranslation(text, "(no translation)"))
        .catch(() => renderTranslation("", "Translation unavailable"));
    } else {
      renderTranslation("", "Translation unavailable");
    }

    card.querySelector(".vimi-speak-button").addEventListener("click", () => {
      if (ensureContext && !ensureContext()) return;
      speak(sourceText, sourceLanguage);
    });
    card.querySelector(".vimi-close-button").addEventListener("click", (event) => {
      close(card, "close-button", event);
    });

    saveButton.addEventListener("click", async () => {
      if (saveButton.disabled) return;
      if (ensureContext && !ensureContext()) return;
      saveButton.disabled = true;
      saveButton.classList.add("is-loading");
      saveButton.textContent = "Saving…";
      try {
        const word = await F.addWord({
          term: sourceText,
          translation,
          src: sourceLanguage,
          tgt: targetLanguage,
          context,
          url,
        });
        if (ensureContext && !ensureContext()) return;
        if (active !== instance) return;
        setSaved(saveButton);
        try { onSaved?.(word); } catch {}
        if (closeAfterSave) {
          window.setTimeout(() => {
            if (active === instance) close(card, "save");
          }, 900);
        }
      } catch (error) {
        if (ensureContext && !ensureContext()) return;
        if (active !== instance) return;
        console.error("[Vimi] Failed to save vocabulary:", error);
        saveButton.disabled = false;
        saveButton.classList.remove("is-loading");
        saveButton.textContent = "Save";
      }
    });

    markExistingWord(sourceText, targetLanguage, saveButton, instance, ensureContext);
    return card;
  }

  window.VimiTranslationCard = { show, close, contains, speak };
})();
