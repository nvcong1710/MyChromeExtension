chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: createSpeedControlBox,
  });
});

var intervalNum;

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

  var button = document.createElement("button");
  button.innerHTML = "Skip";
  button.style.padding = "5px 10px";
  button.style.backgroundColor = "#007BFF";
  button.style.color = "#fff";
  button.style.border = "none";
  button.style.borderRadius = "3px";
  button.style.cursor = "pointer";

  var removeButton = document.createElement("button");
  removeButton.innerHTML = "X";
  removeButton.style.padding = "5px 10px";
  removeButton.style.backgroundColor = "#FF0000";
  removeButton.style.color = "#fff";
  removeButton.style.border = "none";
  removeButton.style.borderRadius = "3px";
  removeButton.style.cursor = "pointer";
  removeButton.style.marginLeft = "10px";

  button.addEventListener("click", function () {
    function skipVideo() {
      var videos = document.querySelectorAll("video");
      videos.forEach((video) => {
        if (video.currentTime < video.duration) {
          video.currentTime = video.duration;
        }
      });
    }
    var adCloseButton = document.querySelector(
      'div[aria-label="Đóng quảng cáo"]'
    );
    if (adCloseButton) {
      adCloseButton.click();
    }

    var imageIcon = document.querySelector(
      'i.img[data-visualcompletion="css-img"]'
    );
    if (imageIcon) {
      imageIcon.click();
    }

    intervalNum = setInterval(skipVideo, 1000);
  });

  removeButton.addEventListener("click", function () {
    clearInterval(intervalNum);
    container.remove();
  });

  container.appendChild(button);
  container.appendChild(removeButton);

  document.body.appendChild(container);
}
