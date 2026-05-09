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

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "addSelectedToVocab") return;
  const selection = info.selectionText ? info.selectionText.trim() : "";
  if (!selection) return;

  const stored = await chrome.storage.local.get(["vocab"]);
  const vocab = Array.isArray(stored.vocab) ? stored.vocab : [];

  const existsIdx = vocab.findIndex(
    (v) => (v.en || "").toLowerCase() === selection.toLowerCase()
  );
  if (existsIdx !== -1) {
    // Already in list — jump current index to it instead of duplicating
    await chrome.storage.local.set({ currentIndex: existsIdx });
    return;
  }

  vocab.push({ en: selection, vi: "" });
  await chrome.storage.local.set({ vocab, currentIndex: vocab.length - 1 });
  // Open tabs sync via chrome.storage.onChanged listener in content.js —
  // no per-tab broadcast needed.
});
