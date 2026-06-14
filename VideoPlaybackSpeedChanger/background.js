chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: createSpeedControlBox,
  });
});

function createSpeedControlBox() {
  const STYLE_ID = "nvc_styles";
  const BOX_ID = "nvc_video-speed-control";
  const MIN_SPEED = 0.0625;
  const MAX_SPEED = 16;

  const existing = document.getElementById(BOX_ID);
  if (existing) {
    const inp = existing.querySelector("input");
    if (inp) inp.focus();
    return;
  }

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BOX_ID} {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 2147483646;
        padding: 10px;
        background-color: #fff;
        border: 1px solid #ccc;
        border-radius: 5px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        font-family: system-ui, -apple-system, sans-serif;
      }
      #${BOX_ID} input {
        margin-right: 10px;
        padding: 5px;
        border: 1px solid #ccc;
        border-radius: 3px;
        width: 60px;
      }
      #${BOX_ID} button {
        padding: 5px 10px;
        border: none;
        border-radius: 3px;
        cursor: pointer;
      }
      #${BOX_ID} button:first-of-type {
        background-color: #007BFF;
        color: #fff;
      }
      #${BOX_ID} button:last-child {
        background-color: #FF0000;
        color: #fff;
        margin-left: 10px;
      }
    `;
    document.head.appendChild(style);
  }

  const container = document.createElement("div");
  container.id = BOX_ID;

  const input = document.createElement("input");
  input.type = "number";
  input.value = 1;
  input.placeholder = "Speed";
  input.step = "0.25";
  input.max = String(MAX_SPEED);

  const setButton = document.createElement("button");
  setButton.textContent = "Set";

  const closeButton = document.createElement("button");
  closeButton.textContent = "X";

  // Per-tab guard state — lives only inside this box's closure.
  // Other tabs are unaffected; closing the box (X) tears everything down.
  let targetSpeed = null;
  let observer = null;
  const tracked = new Map();

  function clamp(s) {
    return Math.max(MIN_SPEED, Math.min(MAX_SPEED, s));
  }

  function applyTo(video) {
    if (targetSpeed == null) return;
    try {
      video.playbackRate = targetSpeed;
    } catch {
      // Some sites lock playbackRate; ignore.
    }
  }

  function trackVideo(video) {
    if (tracked.has(video)) return;
    const onMeta = () => applyTo(video);
    video.addEventListener("loadedmetadata", onMeta);
    tracked.set(video, { onMeta });
    applyTo(video);
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

  function applyToAll() {
    document.querySelectorAll("video").forEach((v) => {
      trackVideo(v);
      applyTo(v);
    });
  }

  function startGuard(speed) {
    targetSpeed = speed;
    if (!observer) {
      observer = new MutationObserver((mutations) => {
        for (const m of mutations) m.addedNodes.forEach(scan);
      });
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    }
    applyToAll();
  }

  function stopGuard() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    for (const [video, { onMeta }] of tracked) {
      video.removeEventListener("loadedmetadata", onMeta);
    }
    tracked.clear();
    targetSpeed = null;
  }

  setButton.addEventListener("click", function () {
    const raw = parseFloat(input.value);
    if (isNaN(raw) || raw <= 0) return;
    const speed = clamp(raw);
    if (speed !== raw) input.value = speed;

    startGuard(speed);
    chrome.storage.local.set({ videoSpeed: speed });
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") setButton.click();
  });

  closeButton.addEventListener("click", function () {
    stopGuard();
    container.remove();
  });

  container.appendChild(input);
  container.appendChild(setButton);
  container.appendChild(closeButton);
  document.body.appendChild(container);

  chrome.storage.local.get(["videoSpeed"], function (result) {
    const saved = Number(result.videoSpeed);
    if (!isNaN(saved) && saved > 0) {
      const s = clamp(saved);
      input.value = s;
      startGuard(s);
    } else {
      input.value = 1;
    }
    input.focus();
    input.select();
  });
}
