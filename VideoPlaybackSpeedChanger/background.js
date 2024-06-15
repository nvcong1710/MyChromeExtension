chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: createSpeedControlBox,
  });
});

function createSpeedControlBox() {
  var container = document.createElement("div");
  container.id = "video-speed-control";
  container.style.position = "fixed";
  container.style.top = "10px";
  container.style.right = "10px";
  container.style.zIndex = "9000";
  container.style.padding = "10px";
  container.style.backgroundColor = "#fff";
  container.style.border = "1px solid #ccc";
  container.style.borderRadius = "5px";
  container.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.1)";

  var input = document.createElement("input");
  input.type = "number";
  input.value = 1;
  input.placeholder = "Enter speed";
  input.style.marginRight = "10px";
  input.style.padding = "5px";
  input.style.border = "1px solid #ccc";
  input.style.borderRadius = "3px";
  input.style.width = "100px";

  var button = document.createElement("button");
  button.innerHTML = "Set Speed";
  button.style.padding = "5px 10px";
  button.style.backgroundColor = "#007BFF";
  button.style.color = "#fff";
  button.style.border = "none";
  button.style.borderRadius = "3px";
  button.style.cursor = "pointer";

  var removeButton = document.createElement("button");
  removeButton.innerHTML = "Remove";
  removeButton.style.padding = "5px 10px";
  removeButton.style.backgroundColor = "#FF0000";
  removeButton.style.color = "#fff";
  removeButton.style.border = "none";
  removeButton.style.borderRadius = "3px";
  removeButton.style.cursor = "pointer";
  removeButton.style.marginLeft = "10px";

  button.addEventListener("click", function () {
    var speed = parseFloat(input.value);
    if (isNaN(speed) || speed <= 0) {
      alert("Please enter a valid speed.");
    } else {
      var video = document.querySelector("video");
      if (video) {
        video.playbackRate = speed;
        chrome.storage.sync.set({ videoSpeed: speed });
      }
    }
  });

  removeButton.addEventListener("click", function () {
    container.remove();
  });

  container.appendChild(input);
  container.appendChild(button);
  container.appendChild(removeButton);

  document.body.appendChild(container);

  chrome.storage.sync.get(["videoSpeed"], function (result) {
    if (result.videoSpeed) {
      var video = document.querySelector("video");
      if (video) {
        video.playbackRate = result.videoSpeed;
        input.value = result.videoSpeed;
      }
    }
  });
}
