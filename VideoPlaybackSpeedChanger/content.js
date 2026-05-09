(function () {
  const MIN_SPEED = 0.0625;
  const MAX_SPEED = 16;
  let currentSpeed = 1;
  const tracked = new WeakSet();

  function clamp(s) {
    if (typeof s !== "number" || isNaN(s)) return 1;
    return Math.max(MIN_SPEED, Math.min(MAX_SPEED, s));
  }

  function applyTo(video) {
    if (!video) return;
    try {
      video.playbackRate = currentSpeed;
    } catch {
      // Some sites lock playbackRate; ignore.
    }
  }

  function applyToAll() {
    document.querySelectorAll("video").forEach(applyTo);
  }

  function trackVideo(video) {
    if (tracked.has(video)) return;
    tracked.add(video);
    applyTo(video);
    // Sites like YouTube reset playbackRate on source change / quality change.
    video.addEventListener("loadedmetadata", () => applyTo(video));
    video.addEventListener("ratechange", () => {
      if (Math.abs(video.playbackRate - currentSpeed) > 0.001) {
        applyTo(video);
      }
    });
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.tagName === "VIDEO") {
      trackVideo(root);
      return;
    }
    if (root.querySelectorAll) {
      root.querySelectorAll("video").forEach(trackVideo);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => scan(n));
    }
  });

  function start() {
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
    scan(document.documentElement);
  }

  chrome.storage.sync.get(["videoSpeed"], (result) => {
    currentSpeed = clamp(Number(result.videoSpeed) || 1);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.videoSpeed) {
      currentSpeed = clamp(Number(changes.videoSpeed.newValue) || 1);
      applyToAll();
    }
  });
})();
