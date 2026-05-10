async function toggleInAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_FLASHCARD_SIDEBAR" });
    } catch {
      // Tab may not have content script (chrome:// pages, etc.)
    }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_FLASHCARD_SIDEBAR" });
  } catch {
    // No content script in this tab — silently ignore
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-sidebar") toggleInAllTabs();
});
