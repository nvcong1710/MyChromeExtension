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

  // If the box is already on the page, focus its input instead of duplicating.
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
      #${BOX_ID} .nvc-msg {
        margin-top: 6px;
        font-size: 12px;
        color: #555;
        min-height: 14px;
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
  input.min = String(MIN_SPEED);
  input.max = String(MAX_SPEED);

  const setButton = document.createElement("button");
  setButton.textContent = "Set";

  const closeButton = document.createElement("button");
  closeButton.textContent = "X";

  const msg = document.createElement("div");
  msg.className = "nvc-msg";

  function clamp(s) {
    return Math.max(MIN_SPEED, Math.min(MAX_SPEED, s));
  }

  setButton.addEventListener("click", function () {
    const raw = parseFloat(input.value);
    if (isNaN(raw) || raw <= 0) {
      msg.textContent = "Enter a positive number.";
      return;
    }
    const speed = clamp(raw);
    if (speed !== raw) input.value = speed;

    const videos = document.querySelectorAll("video");
    if (videos.length === 0) {
      msg.textContent = "No <video> elements found on this page.";
      // Still persist — content.js will apply when a video appears.
      chrome.storage.sync.set({ videoSpeed: speed });
      return;
    }
    for (const video of videos) {
      video.playbackRate = speed;
    }
    chrome.storage.sync.set({ videoSpeed: speed });
    msg.textContent = `Applied ${speed}× to ${videos.length} video(s).`;
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") setButton.click();
  });

  closeButton.addEventListener("click", function () {
    container.remove();
  });

  container.appendChild(input);
  container.appendChild(setButton);
  container.appendChild(closeButton);
  container.appendChild(msg);
  document.body.appendChild(container);

  chrome.storage.sync.get(["videoSpeed"], function (result) {
    input.value = result.videoSpeed !== undefined ? result.videoSpeed : 1;
    input.focus();
    input.select();
  });
}
