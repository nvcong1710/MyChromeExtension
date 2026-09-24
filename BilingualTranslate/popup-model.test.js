const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function makeElement(id = "") {
  const handlers = new Map();
  const classes = new Set();
  return {
    id,
    value: "",
    checked: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    dataset: {},
    children: [],
    classList: {
      add(name) { classes.add(name); },
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); },
    },
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(handler);
    },
    appendChild(child) { this.children.push(child); return child; },
    querySelector() { return null; },
    remove() {},
    setAttribute(name, value) { this[name] = String(value); },
    emit(type, event = {}) {
      return (handlers.get(type) || []).map((handler) => handler(event));
    },
  };
}

function makeHarness({ initialAvailability = "available", availability } = {}) {
  const ids = [
    "power", "src", "tgt", "modelStatus", "modelStatusIcon", "modelStatusText",
    "modelAction", "modelActionIcon", "modelActionText", "host", "mascot", "videoSub",
    "dueNum", "goalNum", "totalNum", "streakNum", "review", "test", "testNote", "swap",
    "opts", "openDoc2Notion", "translateTab", "progressTab", "translatePanel", "progressPanel",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
  elements.translateTab.dataset.popupTab = "translate";
  elements.progressTab.dataset.popupTab = "progress";
  const messages = [];
  const savedConfigs = [];
  const creates = [];
  let runtimeConfig = { src: "en", tgt: "vi" };
  const document = {
    body: makeElement("body"),
    getElementById(id) { return elements[id]; },
    createElement() { return makeElement(); },
  };
  const config = { src: "en", tgt: "vi", dailyGoal: 10, mascotEnabled: true, videoSubEnabled: true };
  const FuFu = {
    POPULAR_LANGUAGES: [["en", "English"], ["vi", "Vietnamese"]],
    LANGUAGES: [["en", "English"], ["vi", "Vietnamese"], ["ja", "Japanese"], ["ko", "Korean"], ["zh-TW", "Chinese (Traditional)"]],
    toOnDevicePair(pair) {
      return {
        sourceLanguage: pair.sourceLanguage === "zh-TW" ? "zh-Hant" : pair.sourceLanguage,
        targetLanguage: pair.targetLanguage === "zh-TW" ? "zh-Hant" : pair.targetLanguage,
      };
    },
    async getConfig() { return { ...config }; },
    async setConfig(patch) { Object.assign(config, patch); savedConfigs.push({ ...patch }); },
    async getHosts() { return {}; },
    async getVocab() { return []; },
    async dueCount() { return 0; },
    async getStreak() { return 0; },
    async getPendingTest() { return null; },
  };
  const Translator = {
    availability: availability || (async () => initialAvailability),
    create(options) {
      creates.push(options);
      return Promise.resolve({ destroy() {} });
    },
  };
  const chrome = {
    tabs: {
      async query() { return [{ id: 7, url: "https://example.com/article" }]; },
      async sendMessage(_id, message) {
        messages.push(message);
        if (message.type === "BT_GET_CONFIG") {
          return {
            ok: true,
            sourceLanguage: runtimeConfig.src,
            targetLanguage: runtimeConfig.tgt,
          };
        }
        if (message.type === "BT_RELOAD") {
          runtimeConfig = { src: config.src, tgt: config.tgt };
          return {
            ok: true,
            sourceLanguage: runtimeConfig.src,
            targetLanguage: runtimeConfig.tgt,
          };
        }
      },
      create() {},
    },
    runtime: { openOptionsPage() {}, getURL(value) { return value; } },
  };
  const context = vm.createContext({
    self: { FuFu }, document, chrome, Translator, URL, console, setTimeout, clearTimeout,
    window: { close() {} },
  });
  const source = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
  vm.runInContext(source, context);
  return { elements, messages, savedConfigs, creates, Translator, context };
}

test("popup checks the saved language pair on open and renders available state", async () => {
  const calls = [];
  const app = makeHarness({
    availability: async (pair) => { calls.push({ ...pair }); return "available"; },
  });
  await flush();
  assert.deepEqual(calls, [{ sourceLanguage: "en", targetLanguage: "vi" }]);
  assert.equal(app.elements.modelStatusText.textContent, "Model ready");
  assert.equal(app.elements.modelActionText.textContent, "Refresh");
});

test("switching popup tabs keeps translation controls unchanged", async () => {
  const app = makeHarness();
  await flush();
  app.elements.src.value = "ja";
  app.elements.power.checked = true;

  app.elements.progressTab.emit("click");
  assert.equal(app.elements.progressPanel.hidden, false);
  assert.equal(app.elements.translatePanel.hidden, true);
  assert.equal(app.elements.src.value, "ja");
  assert.equal(app.elements.power.checked, true);

  app.elements.translateTab.emit("click");
  assert.equal(app.elements.translatePanel.hidden, false);
  assert.equal(app.elements.progressPanel.hidden, true);
  assert.equal(app.elements.src.value, "ja");
  assert.equal(app.elements.power.checked, true);
});

test("popup keeps translation, progress and shared footer content in separate regions", () => {
  const html = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
  const translatePanel = html.indexOf('id="translatePanel"');
  const progressPanel = html.indexOf('id="progressPanel"');
  const sharedTip = html.indexOf("Tip: highlight any word");
  const localFiles = html.indexOf('id="openDoc2Notion"');
  const shortcut = html.indexOf("to toggle translation");

  assert.ok(translatePanel < html.indexOf('id="power"'));
  assert.ok(html.indexOf('id="videoSub"') < progressPanel);
  assert.ok(progressPanel < html.indexOf('id="streakNum"'));
  assert.ok(html.indexOf('id="testNote"') < sharedTip);
  assert.ok(sharedTip < shortcut);
  assert.ok(shortcut < localFiles);
});

test("downloadable model downloads once and becomes ready", async () => {
  const download = deferred();
  const app = makeHarness({ initialAvailability: "downloadable" });
  app.Translator.create = (options) => { app.creates.push(options); return download.promise; };
  await flush();

  app.elements.modelAction.emit("click");
  assert.equal(app.elements.modelStatusText.textContent, "Downloading model…");
  assert.equal(app.elements.modelAction.disabled, true);
  assert.equal(app.creates.length, 1);

  download.resolve({ destroy() {} });
  await flush();
  assert.equal(app.elements.modelStatusText.textContent, "Model ready");
  assert.equal(app.elements.modelActionText.textContent, "Refresh");
});

test("refresh persists the pair and uses BT_RELOAD without enabling translation", async () => {
  const app = makeHarness();
  await flush();
  assert.equal(app.elements.power.checked, false);

  app.elements.modelAction.emit("click");
  await flush();
  assert.deepEqual(app.savedConfigs.at(-1), { src: "en", tgt: "vi" });
  assert.equal(app.messages.at(-1).type, "BT_RELOAD");
  assert.equal(app.elements.power.checked, false);
  assert.equal(app.creates.length, 0);
});

test("changing languages waits for Refresh even when page translation is on", async () => {
  const app = makeHarness();
  await flush();
  app.elements.power.checked = true;
  app.elements.src.value = "ja";

  await Promise.all(app.elements.src.emit("change"));
  await flush();
  assert.equal(app.messages.some((message) => message.type === "BT_RELOAD"), false);
  assert.equal(app.elements.modelStatusText.textContent, "Changes not applied");
  assert.equal(app.elements.modelActionText.textContent, "Apply & refresh");

  await Promise.all(app.elements.modelAction.emit("click"));
  await flush();
  assert.equal(app.messages.filter((message) => message.type === "BT_RELOAD").length, 1);
  assert.equal(app.elements.modelStatusText.textContent, "Model ready");
  assert.equal(app.elements.modelActionText.textContent, "Refresh");
});

test("a stale availability response cannot overwrite the current pair", async () => {
  const japanese = deferred();
  const korean = deferred();
  const app = makeHarness({
    availability(pair) {
      if (pair.sourceLanguage === "ja") return japanese.promise;
      if (pair.targetLanguage === "ko") return korean.promise;
      return Promise.resolve("available");
    },
  });
  await flush();

  app.elements.src.value = "ja";
  app.elements.src.emit("change");
  await flush();
  app.elements.src.value = "en";
  app.elements.tgt.value = "ko";
  app.elements.tgt.emit("change");
  await flush();

  korean.resolve("downloadable");
  await flush();
  assert.equal(app.elements.modelStatusText.textContent, "Model required");

  japanese.resolve("available");
  await flush();
  assert.equal(app.elements.modelStatusText.textContent, "Model required");
  assert.equal(app.elements.modelActionText.textContent, "Download model");
});

test("unsupported pairs keep cloud translation available", async () => {
  const app = makeHarness({ initialAvailability: "unavailable" });
  await flush();
  assert.equal(app.elements.modelStatusText.textContent, "Using cloud model");
  assert.equal(app.elements.modelActionText.textContent, "Refresh");
  assert.equal(app.creates.length, 0);
});

test("a newly selected unsupported pair offers cloud translation", async () => {
  const app = makeHarness();
  await flush();
  app.Translator.availability = async () => "unavailable";
  app.elements.src.value = "ja";

  await Promise.all(app.elements.src.emit("change"));
  await flush();
  assert.equal(app.elements.modelStatusText.textContent, "Cloud translation required");
  assert.equal(app.elements.modelActionText.textContent, "Use cloud");
});

test("a failed model download still allows applying with cloud", async () => {
  const app = makeHarness({ initialAvailability: "downloadable" });
  app.Translator.create = (options) => {
    app.creates.push(options);
    return Promise.reject(new DOMException(
      "Unable to create translator for the given source and target language.",
      "NotSupportedError"
    ));
  };
  await flush();
  app.elements.src.value = "ja";
  await Promise.all(app.elements.src.emit("change"));
  await flush();

  app.elements.modelAction.emit("click");
  await flush();
  assert.equal(app.elements.modelStatusText.textContent, "Model download failed");
  assert.equal(app.elements.modelActionText.textContent, "Use cloud");

  await Promise.all(app.elements.modelAction.emit("click"));
  await flush();
  const reload = app.messages.find((message) => message.type === "BT_RELOAD");
  assert.equal(reload.preferCloud, true);
  assert.equal(reload.localModelReady, false);
  assert.equal(app.elements.modelStatusText.textContent, "Using cloud model");
  assert.equal(app.elements.modelActionText.textContent, "Refresh");

  app.elements.src.value = "en";
  await Promise.all(app.elements.src.emit("change"));
  await flush();
  app.elements.src.value = "ja";
  await Promise.all(app.elements.src.emit("change"));
  await flush();
  assert.equal(app.elements.modelActionText.textContent, "Download model");
  app.elements.modelAction.emit("click");
  await flush();
  assert.equal(app.creates.length, 2);
});

test("traditional Chinese uses the canonical local model language code", async () => {
  const calls = [];
  const app = makeHarness({
    availability: async (pair) => { calls.push({ ...pair }); return "available"; },
  });
  await flush();
  app.elements.src.value = "zh-TW";
  await Promise.all(app.elements.src.emit("change"));
  await flush();
  assert.deepEqual(calls.at(-1), { sourceLanguage: "zh-Hant", targetLanguage: "vi" });
});
