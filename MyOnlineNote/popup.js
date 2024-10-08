// popup.js

document.addEventListener("DOMContentLoaded", function () {
  var noteSizeForm = document.getElementById("noteSizeForm");
  var widthInput = document.getElementById("widthInput");
  var heightInput = document.getElementById("heightInput");

  noteSizeForm.addEventListener("submit", function (event) {
    var width = widthInput.value;
    var height = heightInput.value;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "createNote",
        width: width,
        height: height,
      });
    });
  });
});
