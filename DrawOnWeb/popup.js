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
  // Tạo và chèn canvas vào body
  let canvas = document.querySelector("#drawingCanvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "drawingCanvas";
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.pointerEvents = "auto";
    canvas.style.zIndex = "1000"; // Đảm bảo canvas ở trên các phần tử khác
    document.body.appendChild(canvas);

    // Thiết lập kích thước của canvas theo kích thước của tài liệu
    function resizeCanvas() {
      canvas.width = document.documentElement.scrollWidth;
      canvas.height = document.documentElement.scrollHeight;
    }
    resizeCanvas();

    // Lấy context của canvas
    const ctx = canvas.getContext("2d");

    // Biến để lưu trữ trạng thái vẽ
    let isDrawing = false;

    // Hàm bắt đầu vẽ
    function startDrawing(e) {
      isDrawing = true;
      ctx.beginPath();
      ctx.moveTo(e.clientX, e.clientY + window.scrollY); // Thêm scrollY để chính xác vị trí vẽ
    }

    //Hàm vẽ
    function draw(e) {
      if (!isDrawing) return;
      ctx.lineJoin = "round";
      // ctx.lineCap = "round";
      ctx.lineTo(e.clientX, e.clientY + window.scrollY); // Thêm scrollY để chính xác vị trí vẽ
      ctx.stroke();
    }
    // Hàm dừng vẽ
    function stopDrawing() {
      isDrawing = false;
      ctx.closePath();
    }

    // Sự kiện chuột để vẽ
    canvas.addEventListener("mousedown", startDrawing);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", stopDrawing);
    canvas.addEventListener("mouseout", stopDrawing);

    // Xử lý thay đổi kích thước cửa sổ
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
