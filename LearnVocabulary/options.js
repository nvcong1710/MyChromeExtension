
async function getVocab() {
  const data = await chrome.storage.local.get(["vocab"]);
  return Array.isArray(data.vocab) ? data.vocab : [];
}
async function setVocab(vocab) {
  await chrome.storage.local.set({ vocab });
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "VOCAB_UPDATED", payload: { vocab } });
  } catch {}
}

const area = document.getElementById("jsonArea");
const status = document.getElementById("status");

document.getElementById("btnLoad").addEventListener("click", async () => {
  const vocab = await getVocab();
  area.value = JSON.stringify(vocab, null, 2);
  status.textContent = "Loaded ✓";
});

document.getElementById("btnSave").addEventListener("click", async () => {
  try {
    const parsed = JSON.parse(area.value || "[]");
    if (!Array.isArray(parsed)) throw new Error("JSON must be an array");
    await setVocab(parsed);
    status.textContent = "Saved ✓";
  } catch (e) {
    status.textContent = "Invalid JSON: " + e.message;
  }
});

document.getElementById("btnExport").addEventListener("click", async () => {
  const vocab = await getVocab();
  const blob = new Blob([JSON.stringify(vocab, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "english_vocab.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("btnAdd").addEventListener("click", async () => {
  const en = document.getElementById("en").value.trim();
  const vi = document.getElementById("vi").value.trim();
  if (!en) { status.textContent = "English word is required."; return; }
  const vocab = await getVocab();
  vocab.push({ en, vi });
  await setVocab(vocab);
  area.value = JSON.stringify(vocab, null, 2);
  status.textContent = "Added ✓";
});

document.getElementById("btnImport").addEventListener("click", async () => {
  const file = document.getElementById("fileInput").files[0];
  if (!file) { status.textContent = "Choose a file first."; return; }
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("JSON must be an array");
    await setVocab(parsed);
    area.value = JSON.stringify(parsed, null, 2);
    status.textContent = "Imported ✓";
  } catch (e) {
    status.textContent = "Invalid JSON: " + e.message;
  }
});
