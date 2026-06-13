// With a default_popup set, clicking the toolbar icon opens the popup, so
// action.onClicked no longer fires. The only thing the service worker handles
// is the Alt+T keyboard command: toggle translation on the active tab. The
// content script is registered (document_idle); on restricted pages (chrome://,
// web store) it isn't present and sendMessage throws, which we swallow.

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-translate") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "BT_TOGGLE" });
  } catch {
    // No content script on this page — ignore.
  }
});
