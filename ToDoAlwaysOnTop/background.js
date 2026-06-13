chrome.windows.create(
  {
    url: "popup.html", // Thay đổi URL nếu cần
    type: "popup", // Kiểu popup
    focused: true,
    width: 400,
    height: 600,
  },
  (window) => {
    console.log("Popup window created:", window);
  }
);
