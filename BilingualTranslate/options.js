// Settings + vocabulary manager. All state in chrome.storage.local via
// store.js (self.FuFu), shared with popup/content/review/test.

const F = self.FuFu;
const $ = (id) => document.getElementById(id);

const LANGS = [
  ["en", "English"],
  ["vi", "Vietnamese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
  ["fr", "French"],
  ["de", "German"],
  ["es", "Spanish"],
  ["ru", "Russian"],
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fillLangs(sel) {
  for (const [code, name] of LANGS) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = `${name} (${code})`;
    sel.appendChild(o);
  }
}
fillLangs($("src"));
fillLangs($("tgt"));

WEEKDAYS.forEach((d, i) => {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = d;
  $("testWeekday").appendChild(o);
});
for (let h = 0; h < 24; h++) {
  const o = document.createElement("option");
  o.value = String(h);
  o.textContent = `${String(h).padStart(2, "0")}:00`;
  $("reminderHour").appendChild(o);
}

function flashSaved() {
  $("saveStatus").textContent = "Saved ✓";
  setTimeout(() => ($("saveStatus").textContent = ""), 1500);
}

function showNextTest(cfg) {
  $("nextTestInfo").textContent = cfg.nextTestAt
    ? "Next: " + new Date(cfg.nextTestAt).toLocaleString()
    : "Not scheduled";
}

// ── Load settings ─────────────────────────────────────────────────────────
async function loadSettings() {
  const cfg = await F.getConfig();
  $("src").value = cfg.src;
  $("tgt").value = cfg.tgt;
  $("dailyGoal").value = cfg.dailyGoal;
  $("reminderEnabled").checked = cfg.reminderEnabled;
  $("reminderHour").value = String(cfg.reminderHour);
  $("testEnabled").checked = cfg.testEnabled;
  $("testFreq").value = cfg.testFreq;
  $("testWeekday").value = String(cfg.testWeekday);
  $("testQuestionCount").value = String(cfg.testQuestionCount);
  $("testType").value = cfg.testType;
  $("mascotEnabled").checked = cfg.mascotEnabled !== false;
  showNextTest(cfg);
}

// Persist a single setting change.
function bindSetting(id, key, transform) {
  $(id).addEventListener("change", async () => {
    const el = $(id);
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (transform) v = transform(v);
    await F.setConfig({ [key]: v });
    flashSaved();
    if (["testFreq", "testWeekday", "reminderHour"].includes(id)) {
      // schedule depends on these — recompute
      const cfg = await F.getConfig();
      const next = F.computeNextTest(F.now(), cfg);
      await F.setConfig({ nextTestAt: next });
      showNextTest(await F.getConfig());
    }
  });
}

bindSetting("src", "src");
bindSetting("tgt", "tgt");
bindSetting("dailyGoal", "dailyGoal", (v) => Math.max(1, parseInt(v, 10) || 10));
bindSetting("reminderEnabled", "reminderEnabled");
bindSetting("reminderHour", "reminderHour", (v) => parseInt(v, 10));
bindSetting("testEnabled", "testEnabled");
bindSetting("testFreq", "testFreq");
bindSetting("testWeekday", "testWeekday", (v) => parseInt(v, 10));
bindSetting("testQuestionCount", "testQuestionCount", (v) => parseInt(v, 10));
bindSetting("testType", "testType");
bindSetting("mascotEnabled", "mascotEnabled");

// Fire a notification immediately, bypassing the hour / due-words / once-a-day
// gates, so the user can verify Chrome + OS notifications are allowed.
$("testNotifyBtn").addEventListener("click", () => {
  chrome.notifications.create(
    "fufu-test-notify",
    {
      type: "basic",
      iconUrl: "icon128.png",
      title: "Vimi Bilingual",
      message: "Test reminder — notifications are working.",
    },
    (id) => {
      const err = chrome.runtime.lastError;
      $("notifyInfo").textContent = err
        ? "Blocked: " + err.message
        : id
        ? "Sent ✓ (if you don't see it, check Windows/Chrome notification settings)"
        : "No notification shown — check OS notification settings.";
    }
  );
});

$("rescheduleBtn").addEventListener("click", async () => {
  const cfg = await F.getConfig();
  await F.setConfig({ nextTestAt: F.computeNextTest(F.now(), cfg) });
  showNextTest(await F.getConfig());
  flashSaved();
});

// ── Vocabulary manager ──────────────────────────────────────────────────
function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

async function renderVocab() {
  const all = await F.getVocab();
  const q = $("search").value.trim().toLowerCase();
  const filter = $("filter").value;
  const list = all.filter((w) => {
    if (filter !== "all" && (w.status || "new") !== filter) return false;
    if (q && !(`${w.term} ${w.translation}`.toLowerCase().includes(q))) return false;
    return true;
  });
  $("vocabCount").textContent = `(${all.length})`;

  const ul = $("vocab");
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = `<li class="muted">No words. Highlight text on any page to save vocabulary.</li>`;
    return;
  }
  list
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .forEach((w) => {
      const li = document.createElement("li");
      const status = w.status || "new";
      li.innerHTML = `
        <span class="v-term">${escapeHtml(w.term)}</span>
        <span class="v-trans">${escapeHtml(w.translation || "—")}</span>
        <span class="v-status ${status}">${status}</span>
        <button class="v-del">Delete</button>`;
      li.querySelector(".v-del").addEventListener("click", async () => {
        await F.deleteWord(w.id);
        renderVocab();
      });
      ul.appendChild(li);
    });
}

$("search").addEventListener("input", renderVocab);
$("filter").addEventListener("change", renderVocab);

// ── Export / import ───────────────────────────────────────────────────────
$("exportBtn").addEventListener("click", async () => {
  const vocab = await F.getVocab();
  const blob = new Blob([JSON.stringify(vocab, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fufu-vocabulary.json";
  a.click();
  URL.revokeObjectURL(url);
});

$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error("not an array");
    const existing = await F.getVocab();
    const seen = new Set(existing.map((w) => `${w.term.toLowerCase()}|${w.tgt}`));
    for (const w of data) {
      if (!w.term) continue;
      const key = `${w.term.toLowerCase()}|${w.tgt || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      existing.push(w);
    }
    await F.setVocab(existing);
    renderVocab();
    flashSaved();
  } catch {
    alert("Import failed: invalid JSON file.");
  }
  e.target.value = "";
});

// ── Tab navigation ────────────────────────────────────────────────────────
const navButtons = document.querySelectorAll("#nav button");
const panels = document.querySelectorAll(".tab-panel");
function showTab(name) {
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  panels.forEach((p) => (p.hidden = p.dataset.panel !== name));
}
navButtons.forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab))
);

loadSettings();
renderVocab();
