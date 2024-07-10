// content.js

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "createNote") {
    createNoteOnPage(request.width, request.height);
  }
});

function createNoteOnPage(width, height) {
  function setCookie(name, value) {
    let date = new Date();
    date.setFullYear(date.getFullYear() + 100);
    let expires = "; expires=" + date.toUTCString();
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
  }

  function getCookie(name) {
    var nameEQ = name + "=";
    var ca = document.cookie.split(";");
    for (var i = 0; i < ca.length; i++) {
      var c = ca[i];
      while (c.charAt(0) == " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }

  function checkCookie() {
    var text = getCookie("savedText");
    if (text != null) {
      inputBox.value = text;
    }
  }

  var inputContainer = document.createElement("div");
  inputContainer.style.position = "fixed";
  inputContainer.style.top = "100px";
  inputContainer.style.right = "0";
  inputContainer.style.height = height + "px";
  inputContainer.style.width = width + "px";
  inputContainer.style.display = "flex";
  inputContainer.style.flexDirection = "column";
  inputContainer.style.alignItems = "flex-start";
  inputContainer.style.padding = "10px";
  inputContainer.style.zIndex = "9000";
  inputContainer.style.backgroundColor = "white";
  inputContainer.style.border = "1px solid #ccc";
  inputContainer.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.1)";

  var dragHandle = document.createElement("div");
  dragHandle.style.width = "100%";
  dragHandle.style.boxSizing = "border-box";
  dragHandle.style.height = "30px";
  dragHandle.style.backgroundColor = "#007BFF";
  dragHandle.style.cursor = "move";
  dragHandle.style.display = "flex";
  dragHandle.style.alignItems = "center";
  dragHandle.style.padding = "0 10px";

  var closeButton = document.createElement("button");
  closeButton.textContent = "x";
  closeButton.style.width = "10%";
  closeButton.style.marginLeft = "auto";
  closeButton.style.border = "none";
  closeButton.style.background = "none";
  closeButton.style.fontSize = "20px";
  closeButton.style.cursor = "pointer";
  closeButton.style.color = "white";

  closeButton.addEventListener("click", function () {
    document.body.removeChild(inputContainer);
  });

  dragHandle.appendChild(closeButton);

  var inputBox = document.createElement("textarea");
  inputBox.placeholder = "Enter text here";
  inputBox.style.padding = "10px";
  inputBox.style.fontSize = "16px";
  inputBox.style.border = "2px solid #ccc";
  inputBox.style.borderRadius = "5px";
  inputBox.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.1)";
  inputBox.style.outline = "none";
  inputBox.style.transition = "border-color 0.3s, box-shadow 0.3s";
  inputBox.style.width = "100%";
  inputBox.style.boxSizing = "border-box";
  inputBox.style.height = "100%";
  inputBox.style.resize = "none";
  inputBox.style.lineHeight = "18px";
  inputBox.spellcheck = false;

  checkCookie();

  inputBox.addEventListener("focus", function () {
    inputBox.style.borderColor = "#007BFF";
    inputBox.style.boxShadow = "0 4px 8px rgba(0, 123, 255, 0.3)";
  });

  inputBox.addEventListener("input", function () {
    setCookie("savedText", inputBox.value);
  });

  inputContainer.appendChild(dragHandle);
  inputContainer.appendChild(inputBox);
  document.body.appendChild(inputContainer);

  dragHandle.onmousedown = function (event) {
    event.preventDefault();

    let shiftX = event.clientX - inputContainer.getBoundingClientRect().left;
    let shiftY = event.clientY - inputContainer.getBoundingClientRect().top;

    function moveAt(pageX, pageY) {
      let newLeft = pageX - shiftX;
      let newTop = pageY - shiftY;

      newLeft = Math.max(
        0,
        Math.min(window.innerWidth - inputContainer.offsetWidth, newLeft)
      );
      newTop = Math.max(
        0,
        Math.min(window.innerHeight - inputContainer.offsetHeight, newTop)
      );

      inputContainer.style.left = newLeft + "px";
      inputContainer.style.top = newTop + "px";
    }

    function onMouseMove(event) {
      moveAt(event.clientX, event.clientY);
    }

    document.addEventListener("mousemove", onMouseMove);

    document.onmouseup = function () {
      document.removeEventListener("mousemove", onMouseMove);
      document.onmouseup = null;
    };
  };

  dragHandle.ondragstart = function () {
    return false;
  };
}
