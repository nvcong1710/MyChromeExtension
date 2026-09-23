const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function makeHarness() {
  const listeners = new Map();
  const cards = [];
  const requests = [];
  const translations = [];
  const elements = [];
  const body = { appendChild(element) { elements.push(element); element.parentElement = body; } };
  const addListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  };
  const emit = (type, event = {}) => {
    for (const listener of listeners.get(type) || []) listener(event);
  };
  const makeElement = (tagName) => {
    const handlers = new Map();
    const children = [];
    return {
      tagName: tagName.toUpperCase(),
      style: {},
      children,
      appendChild(child) { children.push(child); },
      addEventListener(type, handler) {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(handler);
      },
      setAttribute() {},
      contains(target) { return target === this || children.includes(target); },
      remove() { this.removed = true; },
      click() {
        const event = { target: this, stopPropagation() {}, preventDefault() {} };
        for (const handler of handlers.get("click") || []) handler(event);
      },
    };
  };
  const document = {
    body,
    documentElement: { style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } },
    addEventListener: addListener,
    createElement: makeElement,
    querySelectorAll() { return []; },
  };
  const host = { closest() { return null; } };
  const rangeFor = (rects) => {
    const fallback = { left: 700, right: 790, top: 550, bottom: 575, width: 90, height: 25 };
    const lines = rects || [fallback];
    const range = {
      startContainer: host, endContainer: host, startOffset: 0, endOffset: 1,
      commonAncestorContainer: { nodeType: 3, parentElement: { tagName: "P", innerText: "A selected sentence used as context.", parentElement: body } },
      getBoundingClientRect() { return lines.at(-1); },
      getClientRects() { return lines; },
      cloneRange() { return { ...this }; },
    };
    return range;
  };
  let selectedText = "";
  let selectedRange = rangeFor();
  let collapsed = false;
  const window = {
    innerWidth: 800, innerHeight: 600,
    addEventListener() {},
    getSelection() {
      return {
        isCollapsed: collapsed,
        rangeCount: collapsed ? 0 : 1,
        anchorNode: { nodeType: 3, parentElement: host },
        toString() { return selectedText; },
        getRangeAt() { return selectedRange; },
      };
    },
  };
  const chrome = {
    runtime: {
      id: "test-extension",
      getURL: (asset) => `chrome-extension://test/${asset}`,
      onMessage: { addListener() {} },
      sendMessage(message, callback) {
        requests.push(message);
        callback({ translation: "translated text" });
      },
    },
  };
  const self = {
    FuFu: {
      getConfig: async () => ({ src: "en", tgt: "vi" }),
      getHosts: async () => ({}),
    },
    VimiTranslationCard: {
      close() {},
      show(options) {
        cards.push(options);
        translations.push(Promise.resolve(options.translate(options.sourceText)));
        return { contains() { return false; }, classList: { contains() { return options.longSelection; } } };
      },
    },
  };
  const context = vm.createContext({ window, document, self, chrome, location: { hostname: "test.local" }, setTimeout, clearTimeout });
  const source = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
  vm.runInContext(source, context);
  return {
    cards, requests, translations, elements, emit,
    select(text, rects) { selectedText = text; selectedRange = rangeFor(rects); collapsed = false; },
    collapse() { collapsed = true; emit("selectionchange"); },
    trigger() { return elements.findLast((element) => element.className === "vimi-long-selection-trigger" && !element.removed); },
    async mouseup() { emit("mouseup", { target: host }); await new Promise((resolve) => setTimeout(resolve, 20)); },
  };
}

test("short selection still translates immediately without a long trigger", async () => {
  const app = makeHarness();
  app.select("a".repeat(60));
  await app.mouseup();
  assert.equal(app.trigger(), undefined);
  assert.equal(app.cards.length, 1);
  assert.equal(app.cards[0].longSelection, false);
  assert.equal(app.requests.length, 1);
});

test("long selection waits for trigger click and keeps all raw text", async () => {
  const app = makeHarness();
  const text = "a".repeat(5000);
  app.select(text);
  await app.mouseup();
  const trigger = app.trigger();
  assert.ok(trigger);
  assert.equal(trigger.children[0].src, "chrome-extension://test/icon32.png");
  assert.equal(app.cards.length, 0);
  assert.equal(app.requests.length, 0);
  assert.ok(Number.parseInt(trigger.style.left, 10) <= 762);
  assert.ok(Number.parseInt(trigger.style.top, 10) <= 562);

  trigger.click();
  assert.equal(trigger.removed, true);
  assert.equal(app.cards.length, 1);
  assert.equal(app.cards[0].longSelection, true);
  assert.equal(app.cards[0].sourceText, text);
  assert.equal(app.cards[0].sourceLanguage, "en");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].text, text);
});

test("long translation preserves explicit source lines and blank paragraphs", async () => {
  const app = makeHarness();
  const raw = "First selected sentence is intentionally long enough.\nSecond selected line.\n\nThird paragraph.";
  app.select(raw);
  await app.mouseup();
  app.trigger().click();
  assert.equal(await app.translations[0], "translated text\ntranslated text\n\ntranslated text");
  assert.deepEqual(app.requests.map((request) => request.text), [
    "First selected sentence is intentionally long enough.",
    "Second selected line.",
    "Third paragraph.",
  ]);
  assert.equal(app.cards[0].sourceText, raw);
});

test("changing or collapsing selection invalidates the old trigger", async () => {
  const app = makeHarness();
  app.select("a".repeat(61));
  await app.mouseup();
  const first = app.trigger();

  app.select("b".repeat(90));
  app.emit("selectionchange");
  assert.equal(first.removed, true);
  first.click();
  assert.equal(app.cards.length, 0);

  await app.mouseup();
  const second = app.trigger();
  assert.ok(second);
  app.collapse();
  assert.equal(second.removed, true);
  assert.equal(app.requests.length, 0);
});

test("trigger follows the last selected line in viewport coordinates", async () => {
  const app = makeHarness();
  app.select("a".repeat(61), [
    { left: 20, right: 400, top: 100, bottom: 125, width: 380, height: 25 },
    { left: 20, right: 160, top: 130, bottom: 155, width: 140, height: 25 },
  ]);
  await app.mouseup();
  assert.equal(app.trigger().style.left, "164px");
  assert.equal(app.trigger().style.top, "159px");
});

function makeCardHarness() {
  const listeners = new Map();
  const windowListeners = new Map();
  const spoken = [];
  const speech = { cancelCount: 0, speaking: false };
  const copied = [];
  const saved = [];
  const makeElement = (className = "") => {
    const handlers = new Map();
    const element = {
      className,
      textContent: "",
      innerHTML: "",
      disabled: false,
      style: {},
      attributes: {},
      classList: {
        add(name) { element.className += ` ${name}`; },
        remove(name) { element.className = element.className.split(" ").filter((item) => item !== name).join(" "); },
        contains(name) { return element.className.split(" ").includes(name); },
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, handler) {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(handler);
      },
      removeEventListener(type, handler) {
        handlers.set(type, (handlers.get(type) || []).filter((item) => item !== handler));
      },
      dispatch(type, event = {}) {
        for (const handler of handlers.get(type) || []) handler({
          target: this, pointerId: 1, pointerType: "mouse", button: 0,
          clientX: 600, clientY: 20, preventDefault() {}, stopPropagation() {},
          ...event,
        });
      },
      contains(target) { return target === this; },
      setPointerCapture(pointerId) { this.capturedPointer = pointerId; },
      hasPointerCapture(pointerId) { return this.capturedPointer === pointerId; },
      releasePointerCapture() { this.capturedPointer = null; },
      click() { this.dispatch("click"); },
      remove() { this.removed = true; },
    };
    return element;
  };
  const body = { appendChild(card) { this.card = card; } };
  const document = {
    body,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    createElement() {
      const card = makeElement();
      Object.defineProperty(card, "innerHTML", {
        set(markup) {
          this.markup = markup;
          this.parts = new Map([
            [".vimi-translation-header", makeElement()],
            [".vimi-translation-source", makeElement()],
            [".vimi-source-code", makeElement()],
            [".vimi-target-code", makeElement()],
            [".vimi-language-direction", makeElement()],
            [".vimi-translation-result", makeElement("vimi-translation-loading")],
            [".vimi-close-button", makeElement()],
            [".vimi-speak-button", makeElement()],
            [".vimi-copy-button", makeElement()],
          ]);
          if (markup.includes('class="vimi-save-button"')) {
            this.parts.set(".vimi-save-button", makeElement());
            this.parts.get(".vimi-save-button").disabled = true;
          }
          this.parts.get(".vimi-translation-result").textContent = "Translating…";
          this.parts.get(".vimi-copy-button").disabled = true;
        },
      });
      card.querySelector = (selector) => card.parts.get(selector);
      card.contains = (target) => target === card || [...card.parts.values()].includes(target);
      card.getBoundingClientRect = () => {
        const width = Math.min(390, window.innerWidth - 24);
        const height = Math.min(470, window.innerHeight - 24);
        const left = card.style.left ? Number.parseFloat(card.style.left) : window.innerWidth - width - 12;
        const top = card.style.top ? Number.parseFloat(card.style.top) : 12;
        return { left, top, width, height, right: left + width, bottom: top + height };
      };
      return card;
    },
  };
  const self = {
    FuFu: {
      getVocab: async () => [],
      addWord: async (word) => { saved.push(word); },
    },
  };
  const window = {
    innerWidth: 800, innerHeight: 600,
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      windowListeners.set(type, (windowListeners.get(type) || []).filter((item) => item !== handler));
    },
    emit(type, event = {}) {
      for (const handler of windowListeners.get(type) || []) handler(event);
    },
  };
  const context = vm.createContext({
    document, self, window,
    location: { href: "https://test.local/" },
    navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: {
      cancel() { speech.cancelCount += 1; speech.speaking = false; },
      speak(utterance) { spoken.push(utterance); speech.speaking = true; },
    },
    setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "translation-card.js"), "utf8"), context);
  return {
    api: self.VimiTranslationCard, body, spoken, speech, copied, saved, window,
    emit(type, target) { for (const handler of listeners.get(type) || []) handler({ target }); },
  };
}

test("long dialog has clipped scroll sections, TTS and Copy but no Save", async () => {
  const app = makeCardHarness();
  const raw = "Long source paragraph. ".repeat(100);
  let finishTranslation;
  const translation = new Promise((resolve) => { finishTranslation = resolve; });
  const card = app.api.show({
    sourceText: raw, sourceLanguage: "en", targetLanguage: "vi",
    longSelection: true, translate: () => translation,
  });
  const part = (selector) => card.querySelector(selector);
  assert.equal(part(".vimi-translation-source").textContent, raw);
  assert.equal(part(".vimi-translation-result").textContent, "Translating…");
  assert.equal(card.classList.contains("vimi-translation-long"), true);
  assert.ok(card.markup.includes('class="vimi-translation-source-section"'));
  assert.ok(card.markup.includes('class="vimi-translation-result-section"'));
  assert.equal(part(".vimi-save-button"), undefined);

  part(".vimi-speak-button").click();
  assert.equal(app.spoken[0].text, raw);
  assert.equal(app.spoken[0].lang, "en");
  assert.equal(card.removed, undefined);

  finishTranslation("Full translated paragraph.");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(part(".vimi-translation-result").textContent, "Full translated paragraph.");
  part(".vimi-copy-button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(app.copied, ["Full translated paragraph."]);
  assert.equal(part(".vimi-copy-button").classList.contains("copied"), true);
  assert.equal(app.saved.length, 0);
  assert.equal(card.removed, undefined);

  let finishLateTranslation;
  const lateTranslation = new Promise((resolve) => { finishLateTranslation = resolve; });
  const lateCard = app.api.show({
    sourceText: "Another long selection", sourceLanguage: "ja", targetLanguage: "vi",
    longSelection: true, translate: () => lateTranslation,
  });
  app.api.close(lateCard, "close-button");
  finishLateTranslation("Late result");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lateCard.removed, true);
  assert.equal(lateCard.querySelector(".vimi-translation-result").textContent, "Translating…");
});

test("short popup keeps Save and the original flat text structure", async () => {
  const app = makeCardHarness();
  const card = app.api.show({
    sourceText: "brief term", sourceLanguage: "en", targetLanguage: "vi",
    translate: () => "từ ngắn",
  });
  assert.ok(!card.markup.includes('class="vimi-translation-source-section"'));
  assert.ok(!card.markup.includes('class="vimi-translation-result-section"'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  card.querySelector(".vimi-save-button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(app.saved[0].term, "brief term");
  assert.equal(app.saved[0].translation, "từ ngắn");
});

for (const longSelection of [false, true]) {
  for (const closeMode of ["close button", "outside pointer"]) {
    test(`${longSelection ? "long dialog" : "short popup"} stops owned TTS on ${closeMode}`, async () => {
      const app = makeCardHarness();
      const card = app.api.show({
        sourceText: "Source text", sourceLanguage: "en", targetLanguage: "vi",
        longSelection, translate: () => "Bản dịch",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      card.querySelector(".vimi-speak-button").click();
      assert.equal(app.speech.speaking, true);
      const cancelsAfterStart = app.speech.cancelCount;

      app.emit("pointerdown", card.querySelector(".vimi-translation-result"));
      card.querySelector(".vimi-copy-button").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(app.speech.cancelCount, cancelsAfterStart);
      assert.equal(card.removed, undefined);

      if (closeMode === "close button") card.querySelector(".vimi-close-button").click();
      else app.emit("pointerdown", {});
      assert.equal(card.removed, true);
      assert.equal(app.speech.speaking, false);
      assert.equal(app.speech.cancelCount, cancelsAfterStart + 1);
      app.api.close(card);
      assert.equal(app.speech.cancelCount, cancelsAfterStart + 1);
    });
  }
}

test("TTS cleanup is safe without speech and a reopened popup speaks afresh", () => {
  const app = makeCardHarness();
  const idle = app.api.show({ sourceText: "idle", translate: () => "idle" });
  app.api.close(idle);
  assert.equal(app.speech.cancelCount, 0);

  const first = app.api.show({ sourceText: "first", translate: () => "first" });
  first.querySelector(".vimi-speak-button").click();
  const firstUtterance = app.spoken[0];
  app.api.close(first);
  assert.equal(app.speech.speaking, false);

  const second = app.api.show({ sourceText: "second", translate: () => "second" });
  second.querySelector(".vimi-speak-button").click();
  firstUtterance.onend();
  assert.equal(app.speech.speaking, true);
  assert.equal(app.spoken.at(-1).text, "second");
  const cancelsBeforeClose = app.speech.cancelCount;
  app.api.close(second);
  assert.equal(app.speech.cancelCount, cancelsBeforeClose + 1);
});

test("replacing an active card cancels its speech before opening the next card", () => {
  const app = makeCardHarness();
  const first = app.api.show({ sourceText: "first", translate: () => "first" });
  first.querySelector(".vimi-speak-button").click();
  const cancelsAfterStart = app.speech.cancelCount;
  const next = app.api.show({ sourceText: "next", longSelection: true, translate: () => "next" });
  assert.equal(first.removed, true);
  assert.equal(app.speech.cancelCount, cancelsAfterStart + 1);
  assert.equal(app.speech.speaking, false);
  assert.equal(app.api.isActive(next), true);
  first.querySelector(".vimi-speak-button").click();
  assert.equal(app.spoken.length, 1);
});

test("long dialog stays open for inside pointer events and closes outside", () => {
  const app = makeCardHarness();
  const card = app.api.show({
    sourceText: "Selected paragraph", sourceLanguage: "ko", targetLanguage: "en",
    longSelection: true, translate: () => "model",
  });
  app.emit("pointerdown", card.querySelector(".vimi-translation-result"));
  assert.equal(card.removed, undefined);
  app.emit("pointerdown", {});
  assert.equal(card.removed, true);
  assert.equal(app.api.isActive(card), false);
});

test("only long dialog header drags after threshold and stays in viewport", async () => {
  const app = makeCardHarness();
  const card = app.api.show({
    sourceText: "A long source", sourceLanguage: "en", targetLanguage: "vi",
    longSelection: true, translate: () => "Bản dịch",
  });
  const header = card.querySelector(".vimi-translation-header");
  const close = card.querySelector(".vimi-close-button");
  assert.equal(card.style.right, undefined);
  header.dispatch("pointerdown");
  app.window.emit("pointermove", { pointerId: 1, clientX: 602, clientY: 22, preventDefault() {} });
  assert.equal(card.style.left, undefined);
  app.window.emit("pointermove", { pointerId: 1, clientX: 550, clientY: 70, preventDefault() {} });
  assert.equal(card.style.left, "348px");
  assert.equal(card.style.top, "62px");
  assert.equal(header.classList.contains("vimi-translation-dragging"), true);
  app.window.emit("pointerup", { pointerId: 1 });
  assert.equal(header.classList.contains("vimi-translation-dragging"), false);

  header.dispatch("pointerdown", { clientX: 550, clientY: 70 });
  app.window.emit("pointermove", { pointerId: 1, clientX: -500, clientY: -500, preventDefault() {} });
  assert.equal(card.style.left, "12px");
  assert.equal(card.style.top, "12px");
  app.window.emit("pointermove", { pointerId: 1, clientX: 2000, clientY: 2000, preventDefault() {} });
  assert.equal(card.style.left, "398px");
  assert.equal(card.style.top, "118px");
  app.window.emit("pointerup", { pointerId: 1 });

  app.window.innerWidth = 420;
  app.window.innerHeight = 350;
  app.window.emit("resize");
  assert.equal(card.style.left, "18px");
  assert.equal(card.style.top, "12px");

  await new Promise((resolve) => setTimeout(resolve, 0));
  card.querySelector(".vimi-speak-button").click();
  card.querySelector(".vimi-copy-button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(app.spoken[0].text, "A long source");
  assert.deepEqual(app.copied, ["Bản dịch"]);
  assert.equal(app.saved.length, 0);

  header.dispatch("pointerdown", { target: close });
  app.window.emit("pointermove", { pointerId: 1, clientX: 700, clientY: 200, preventDefault() {} });
  assert.equal(card.style.left, "18px");
  close.click();
  assert.equal(card.removed, true);
});
