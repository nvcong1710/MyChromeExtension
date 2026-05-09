
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "addSelectedToVocab",
    title: "Add selected text to English↔Vietnamese vocab",
    contexts: ["selection"]
  });
});

async function toggleNoteInAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    try { await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_NOTE_REQUEST" }); } catch {}
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-note") toggleNoteInAllTabs();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "addSelectedToVocab") {
    const selection = info.selectionText ? info.selectionText.trim() : "";
    if (!selection) return;
    const newItem = { en: selection, vi: "" };
    const stored = await chrome.storage.local.get(["vocab"]);
    const vocab = Array.isArray(stored.vocab) ? stored.vocab : [];
    vocab.push(newItem);
    await chrome.storage.local.set({ vocab });
    if (tab?.id) {
      try { await chrome.tabs.sendMessage(tab.id, { type: "VOCAB_UPDATED", payload: { vocab } }); } catch {}
    }
  }
});
