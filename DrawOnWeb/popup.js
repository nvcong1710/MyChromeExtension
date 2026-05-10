document.getElementById("apply").addEventListener("click", () => {
  const color = document.getElementById("color").value;
  const size = document.getElementById("size").value;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: applyDrawing,
      args: [color, size],
    });
  });
});

document.getElementById("clear").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: clearCanvases,
    });
  });
});

function applyDrawing(color, size) {
  let canvas = document.querySelector("#drawingCanvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "drawingCanvas";
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.pointerEvents = "auto";
    canvas.style.zIndex = "1000";
    document.body.appendChild(canvas);

    function resizeCanvas() {
      canvas.width = document.documentElement.scrollWidth;
      canvas.height = document.documentElement.scrollHeight;
    }
    resizeCanvas();

    const ctx = canvas.getContext("2d");

    let isDrawing = false;

    function startDrawing(e) {
      isDrawing = true;
      ctx.beginPath();
      ctx.moveTo(e.clientX, e.clientY + window.scrollY);
    }

    function draw(e) {
      if (!isDrawing) return;
      ctx.lineJoin = "round";
      ctx.lineTo(e.clientX, e.clientY + window.scrollY);
      ctx.stroke();
    }

    function stopDrawing() {
      isDrawing = false;
      ctx.closePath();
    }

    canvas.addEventListener("mousedown", startDrawing);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", stopDrawing);
    // canvas.addEventListener("mouseout", stopDrawing);

    window.addEventListener("resize", resizeCanvas);
  }
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
}

function clearCanvases() {
  const canvases = document.querySelectorAll("canvas");
  canvases.forEach((canvas) => canvas.remove());
}
