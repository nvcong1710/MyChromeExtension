document.addEventListener("DOMContentLoaded", async function () {
  const noteSizeForm = document.getElementById("noteSizeForm");
  const widthInput = document.getElementById("widthInput");
  const heightInput = document.getElementById("heightInput");

  // Pre-fill from last-used size so user doesn't re-type every time.
  try {
    const { noteSize } = await chrome.storage.local.get(["noteSize"]);
    if (noteSize?.width) widthInput.value = noteSize.width;
    if (noteSize?.height) heightInput.value = noteSize.height;
  } catch {}

  noteSizeForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const width = Number(widthInput.value);
    const height = Number(heightInput.value);
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "createNote",
        width,
        height,
      });
      window.close();
    });
  });
});
