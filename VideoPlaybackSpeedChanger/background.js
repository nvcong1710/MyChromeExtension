chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: createSpeedControlBox,
  });
});

function createSpeedControlBox() {
  var container = document.createElement("div");
  container.id = "video-speed-control !important";
  container.style.position = "fixed !important";
  container.style.top = "10px !important";
  container.style.right = "10px !important";
  container.style.zIndex = "9000 !important";
  container.style.padding = "10px !important";
  container.style.backgroundColor = "#fff !important";
  container.style.border = "1px solid #ccc !important";
  container.style.borderRadius = "5px !important";
  container.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.1) !important";

  var input = document.createElement("input");
  input.type = "number";
  input.value = 1;
  input.placeholder = "Enter speed";
  input.style.marginRight = "10px !important";
  input.style.padding = "5px !important";
  input.style.border = "1px solid #ccc !important";
  input.style.borderRadius = "3px !important";
  input.style.width = "50px !important !important";
  input.step = "0.2 !important";

  var button = document.createElement("button");
  button.innerHTML = "Set";
  button.style.padding = "5px 10px !important";
  button.style.backgroundColor = "#007BFF !important";
  button.style.color = "#fff !important";
  button.style.border = "none !important";
  button.style.borderRadius = "3px !important";
  button.style.cursor = "pointer !important";

  var removeButton = document.createElement("button");
  removeButton.innerHTML = "X";
  removeButton.style.padding = "5px 10px !important";
  removeButton.style.backgroundColor = "#FF0000 !important";
  removeButton.style.color = "#fff !important";
  removeButton.style.border = "none !important";
  removeButton.style.borderRadius = "3px !important";
  removeButton.style.cursor = "pointer !important";
  removeButton.style.marginLeft = "10px !important";

  button.addEventListener("click", function () {
    var speed = parseFloat(input.value);
    if (isNaN(speed) || speed <= 0) {
      alert("Please enter a valid speed.");
    } else {
      var video = document.querySelectorAll("video");
      for (var v of video) {
        v.playbackRate = speed;
      }
      chrome.storage.sync.set({ videoSpeed: speed });
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
    input.value = result.videoSpeed;
  });
}
