chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: createSpeedControlBox,
  });
});

function createSpeedControlBox() {
  // Thêm thẻ <style> vào <head>
  if (!document.getElementById("nvc_styles")) {
    const style = document.createElement("style");
    style.id = "nvc_styles";
    style.innerHTML = `
      #nvc_video-speed-control {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 9000;
        padding: 10px;
        background-color: #fff;
        border: 1px solid #ccc;
        border-radius: 5px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      }
      #nvc_video-speed-control input {
        margin-right: 10px;
        padding: 5px;
        border: 1px solid #ccc;
        border-radius: 3px;
        width: 50px;
      }
      #nvc_video-speed-control button {
        padding: 5px 10px;
        border: none;
        border-radius: 3px;
        cursor: pointer;
      }
      #nvc_video-speed-control button:first-child {
        background-color: #007BFF;
        color: #fff;
      }
      #nvc_video-speed-control button:last-child {
        background-color: #FF0000;
        color: #fff;
        margin-left: 10px;
      }
    `;
    document.head.appendChild(style);
  }

  // Tạo container
  const container = document.createElement("div");
  container.id = "nvc_video-speed-control";

  // Tạo input
  const input = document.createElement("input");
  input.type = "number";
  input.value = 1; // Giá trị mặc định
  input.placeholder = "Enter speed";
  input.step = "0.2";

  // Tạo nút "Set"
  const button = document.createElement("button");
  button.innerHTML = "Set";

  // Tạo nút "Remove"
  const removeButton = document.createElement("button");
  removeButton.innerHTML = "X";

  // Gắn sự kiện
  button.addEventListener("click", function () {
    const speed = parseFloat(input.value);
    if (isNaN(speed) || speed <= 0) {
      alert("Please enter a valid speed.");
    } else {
      const videos = document.querySelectorAll("video");
      if (videos.length === 0) {
        alert("No video elements found on the page.");
        return;
      }
      for (const video of videos) {
        video.playbackRate = speed;
      }
      chrome.storage.sync.set({ videoSpeed: speed });
    }
  });

  removeButton.addEventListener("click", function () {
    container.remove();
  });

  // Thêm các phần tử vào container
  container.appendChild(input);
  container.appendChild(button);
  container.appendChild(removeButton);

  // Thêm container vào body
  document.body.appendChild(container);

  // Lấy giá trị từ storage
  chrome.storage.sync.get(["videoSpeed"], function (result) {
    input.value = result.videoSpeed !== undefined ? result.videoSpeed : 1;
  });
}
