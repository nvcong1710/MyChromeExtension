const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("mascot ignores app events that arrive before its DOM is built", () => {
  const windowListeners = new Map();
  const storageListeners = [];
  const window = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };
  window.top = window;

  const neverFinishes = new Promise(() => {});
  const context = vm.createContext({
    window,
    self: {
      FuFu: {
        getConfig() { return neverFinishes; },
      },
    },
    chrome: {
      runtime: { id: "test-extension", getURL: (asset) => asset },
      storage: {
        onChanged: { addListener(listener) { storageListeners.push(listener); } },
      },
    },
    document: {},
    setTimeout,
    clearTimeout,
  });

  const source = fs.readFileSync(path.join(__dirname, "mascot.js"), "utf8");
  vm.runInContext(source, context);

  assert.doesNotThrow(() => {
    windowListeners.get("vimi:event")({ detail: { pose: "think", say: "Translating…" } });
  });
  assert.doesNotThrow(() => {
    storageListeners[0]({ fufuCelebrate: { newValue: Date.now() } }, "local");
  });
});
