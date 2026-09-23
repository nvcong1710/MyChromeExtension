const test = require("node:test");
const assert = require("node:assert/strict");

function createMockElement(tagName, attributes = {}, parent = null) {
  const children = [];
  const classListSet = new Set(
    (attributes.class || "").split(/\s+/).filter(Boolean)
  );

  const el = {
    tagName: tagName.toUpperCase(),
    attributes: { ...attributes },
    parentElement: parent,
    style: {},
    dataset: {},
    get className() {
      return Array.from(classListSet).join(" ");
    },
    set className(val) {
      classListSet.clear();
      (val || "").split(/\s+/).filter(Boolean).forEach((c) => classListSet.add(c));
    },
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === mockDocument.body || cur === mockDocument.documentElement) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    get classList() {
      return {
        contains: (c) => classListSet.has(c),
        add: (c) => classListSet.add(c),
        remove: (c) => classListSet.delete(c),
        toggle: (c, force) => {
          if (force !== undefined) {
            if (force) classListSet.add(c);
            else classListSet.delete(c);
            return force;
          }
          if (classListSet.has(c)) {
            classListSet.delete(c);
            return false;
          }
          classListSet.add(c);
          return true;
        },
      };
    },
    getAttribute(name) {
      if (name === "class") return Array.from(classListSet).join(" ");
      return this.attributes[name] ?? null;
    },
    setAttribute(name, val) {
      this.attributes[name] = val;
      if (name === "class") {
        classListSet.clear();
        (val || "").split(/\s+/).filter(Boolean).forEach((c) => classListSet.add(c));
      }
    },
    hasAttribute(name) {
      return name in this.attributes;
    },
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === "class") classListSet.clear();
    },
    appendChild(child) {
      if (child.parentElement) {
        child.parentElement.removeChild(child);
      }
      child.parentElement = this;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentElement = null;
      }
      return child;
    },
    remove() {
      if (this.parentElement) {
        this.parentElement.removeChild(this);
      }
    },
    contains(child) {
      let cur = child;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    closest(selector) {
      let cur = this;
      const selectors = selector.split(",").map((s) => s.trim());
      while (cur) {
        for (const sel of selectors) {
          if (sel.startsWith("#") && cur.attributes.id === sel.slice(1)) return cur;
          if (sel.startsWith(".") && cur.classList.contains(sel.slice(1))) return cur;
          if (sel.startsWith("[class*=") && cur.getAttribute("class")?.includes(sel.match(/"([^"]+)"/)?.[1] || "")) return cur;
          if (sel.startsWith("[data-") && cur.hasAttribute(sel.slice(1, -1))) return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const results = [];
      const selectors = selector.split(",").map((s) => s.trim());
      function traverse(node) {
        for (const child of node.children) {
          let matches = false;
          for (const sel of selectors) {
            if (sel === "video" && child.tagName === "VIDEO") matches = true;
            else if (sel.startsWith("#") && child.attributes.id === sel.slice(1)) matches = true;
            else if (sel.startsWith(".") && child.classList.contains(sel.slice(1))) matches = true;
            else if (sel.startsWith("[class*=") && child.getAttribute("class")?.includes(sel.match(/"([^"]+)"/)?.[1] || "")) matches = true;
            else if (sel.startsWith("[data-") && child.hasAttribute(sel.slice(1, -1))) matches = true;
          }
          if (matches) results.push(child);
          traverse(child);
        }
      }
      traverse(this);
      return results;
    },
    get offsetWidth() {
      return this.width ?? 640;
    },
    get offsetHeight() {
      return this.height ?? 360;
    },
    textTracks: [],
    get children() {
      return [...children];
    },
    getBoundingClientRect() {
      return { width: this.width ?? 640, height: this.height ?? 360, top: 0, left: 0 };
    },
    addEventListener() {},
    removeEventListener() {},
  };

  return el;
}

const mockDocument = {
  documentElement: createMockElement("html"),
  body: createMockElement("body"),
  createElement: (tag) => createMockElement(tag),
  getElementById(id) {
    return this.querySelector("#" + id);
  },
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll(sel) {
    return this.body.querySelectorAll(sel);
  },
  querySelector(sel) {
    return this.body.querySelector(sel);
  },
};
mockDocument.documentElement.appendChild(mockDocument.body);

globalThis.MutationObserver = class MockMutationObserver {
  constructor(cb) {
    this.cb = cb;
  }
  observe() {}
  disconnect() {}
};

// Set up globals
globalThis.window = {
  document: mockDocument,
  MutationObserver: globalThis.MutationObserver,
  getComputedStyle: (el) => el.style,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document = mockDocument;
globalThis.self = globalThis.window;
globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    onChanged: { addListener() {} },
  },
  runtime: {
    sendMessage: async () => ({}),
    getURL: (p) => p,
  },
};

// Load subtitles.js
require("./subtitles.js");
const { isAdVideo, isEligibleVideo, pruneStaleControllers, registerVideo, activeControllers } =
  window.__vimiSubtitlesInternal;

test("isAdVideo correctly flags YouTube ad elements and keeps main video clean", () => {
  const moviePlayer = createMockElement("div", { id: "movie_player", class: "html5-video-player" });
  mockDocument.body.appendChild(moviePlayer);

  const mainVideo = createMockElement("video", { class: "video-stream html5-main-video" });
  moviePlayer.appendChild(mainVideo);

  const adModule = createMockElement("div", { class: "ytp-ad-module" });
  moviePlayer.appendChild(adModule);

  const adVideo = createMockElement("video", { class: "video-stream" });
  adModule.appendChild(adVideo);

  // Main video should NOT be an ad video
  assert.equal(isAdVideo(mainVideo), false, "html5-main-video is not an ad");

  // Video inside ad module must be an ad video
  assert.equal(isAdVideo(adVideo), true, "video in ytp-ad-module is an ad");

  // When player has ad-showing class, auxiliary video is an ad
  moviePlayer.classList.add("ad-showing");
  const tempVideo = createMockElement("video", { class: "video-stream" });
  moviePlayer.appendChild(tempVideo);
  assert.equal(isAdVideo(tempVideo), true, "secondary video during ad-showing is an ad");

  // Cleanup
  moviePlayer.remove();
});

test("isAdVideo detects generic platform ad video containers and markers", () => {
  const adContainer = createMockElement("div", { class: "video-ads" });
  mockDocument.body.appendChild(adContainer);

  const adVideo = createMockElement("video", {});
  adContainer.appendChild(adVideo);

  assert.equal(isAdVideo(adVideo), true, "video in video-ads container is an ad");

  const standAloneAd = createMockElement("video", { class: "ad-video" });
  mockDocument.body.appendChild(standAloneAd);
  assert.equal(isAdVideo(standAloneAd), true, "video with ad-video class is an ad");

  const ariaAd = createMockElement("video", { "aria-label": "Advertisement video player" });
  mockDocument.body.appendChild(ariaAd);
  assert.equal(isAdVideo(ariaAd), true, "video with advertisement aria-label is an ad");

  adContainer.remove();
  standAloneAd.remove();
  ariaAd.remove();
});

test("isEligibleVideo excludes disconnected, ad, or hidden videos", () => {
  // Disconnected video
  const detachedVideo = createMockElement("video", {});
  assert.equal(isEligibleVideo(detachedVideo), false, "detached video is ineligible");

  // Connected normal video
  const connectedVideo = createMockElement("video", {});
  mockDocument.body.appendChild(connectedVideo);
  assert.equal(isEligibleVideo(connectedVideo), true, "connected video is eligible");

  // Explicitly hidden video
  const hiddenVideo = createMockElement("video", {});
  hiddenVideo.width = 0;
  hiddenVideo.height = 0;
  hiddenVideo.style.display = "none";
  mockDocument.body.appendChild(hiddenVideo);
  assert.equal(isEligibleVideo(hiddenVideo), false, "display:none video is ineligible");

  // Ad video
  const adVideo = createMockElement("video", { class: "ad-video" });
  mockDocument.body.appendChild(adVideo);
  assert.equal(isEligibleVideo(adVideo), false, "ad video is ineligible");

  connectedVideo.remove();
  hiddenVideo.remove();
  adVideo.remove();
});

test("registerVideo deduplicates controllers for the same player container", () => {
  activeControllers.clear();

  const player = createMockElement("div", { id: "movie_player", class: "html5-video-player" });
  mockDocument.body.appendChild(player);

  const video1 = createMockElement("video", { class: "video-stream html5-main-video" });
  player.appendChild(video1);

  registerVideo(video1);
  assert.equal(activeControllers.has(video1), true, "video1 registered");
  assert.equal(activeControllers.size, 1, "exactly one controller registered");

  // Try to register another video inside the same container (e.g. ad video or duplicate tag)
  const video2 = createMockElement("video", { class: "video-stream" });
  player.appendChild(video2);

  registerVideo(video2);
  assert.equal(activeControllers.size, 1, "did not create a second controller for the same container");
  assert.equal(activeControllers.has(video2), false, "video2 was not registered");

  // Check badges in player
  const badges = player.querySelectorAll(".vimi-sub-badge");
  assert.equal(badges.length, 1, "only 1 badge exists in player");

  player.remove();
  activeControllers.clear();
});

test("mountToContainer purges any duplicate badges left in the container", () => {
  activeControllers.clear();

  const player = createMockElement("div", { id: "movie_player", class: "html5-video-player" });
  mockDocument.body.appendChild(player);

  // Simulate two stray badges already sitting in the container from earlier ad lifecycles
  const strayBadge1 = createMockElement("div", { class: "vimi-sub-badge" });
  const strayBadge2 = createMockElement("div", { class: "vimi-sub-badge" });
  player.appendChild(strayBadge1);
  player.appendChild(strayBadge2);
  assert.equal(player.querySelectorAll(".vimi-sub-badge").length, 2);

  const video = createMockElement("video", { class: "video-stream html5-main-video" });
  player.appendChild(video);

  registerVideo(video);

  // After registerVideo and mountToContainer, stray badges must be purged
  const badges = player.querySelectorAll(".vimi-sub-badge");
  assert.equal(badges.length, 1, "all stray badges were purged; exactly one badge remains");

  player.remove();
  activeControllers.clear();
});
