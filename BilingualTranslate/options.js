// Settings + vocabulary + flashcard decks. State via store.js (self.FuFu) and
// chrome.storage.local; theme via localStorage (shared across extension pages).

const F = self.FuFu;
const $ = (id) => document.getElementById(id);

const LANGS = [
  ["en", "English"], ["vi", "Vietnamese"], ["ja", "Japanese"], ["ko", "Korean"],
  ["zh", "Chinese"], ["fr", "French"], ["de", "German"], ["es", "Spanish"], ["ru", "Russian"],
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MASCOT_POSES = [
  ["idle", "Idle", "default"], ["walk", "Walk", "wandering"], ["talk", "Talk", "chatting"],
  ["read", "Read", "vocab reminder"], ["think", "Think", "translating"], ["happy", "Happy", "saved word"],
  ["celebrate", "Celebrate", "review/test done"], ["point", "Point", "chatting"], ["love", "Love", "chatting"],
  ["shy", "Shy", "chatting"], ["wave", "Wave", "greeting"], ["sleep", "Sleep", "idle ~90s"],
];

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fillLangs(sel) {
  for (const [code, name] of LANGS) {
    const o = document.createElement("option");
    o.value = code; o.textContent = `${name} (${code})`; sel.appendChild(o);
  }
}
fillLangs($("src"));
fillLangs($("tgt"));
WEEKDAYS.forEach((d, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = d; $("testWeekday").appendChild(o); });
for (let h = 0; h < 24; h++) { const o = document.createElement("option"); o.value = String(h); o.textContent = `${String(h).padStart(2, "0")}:00`; $("reminderHour").appendChild(o); }

// ── Theme ─────────────────────────────────────────────────────────────────
function applyTheme(t) {
  localStorage.setItem("vimiTheme", t);
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelectorAll("#themeSeg .theme-opt").forEach((b) => b.classList.toggle("active", b.dataset.theme === t));
}
document.querySelectorAll("#themeSeg .theme-opt").forEach((b) =>
  b.addEventListener("click", () => applyTheme(b.dataset.theme))
);
applyTheme(localStorage.getItem("vimiTheme") || "system");

// Text size (UI scale via zoom)
function applyZoom(z) {
  localStorage.setItem("vimiZoom", z);
  document.documentElement.style.zoom = z;
  document.querySelectorAll("#sizeSeg .theme-opt").forEach((b) => b.classList.toggle("active", b.dataset.size === z));
}
document.querySelectorAll("#sizeSeg .theme-opt").forEach((b) =>
  b.addEventListener("click", () => applyZoom(b.dataset.size))
);
applyZoom(localStorage.getItem("vimiZoom") || "1");

// ── Mascot preview ──────────────────────────────────────────────────────────
function renderMascotPreview() {
  $("mascotPreview").innerHTML = MASCOT_POSES.map(([f, label, hint]) => `
    <figure class="m-0 w-[88px] text-center">
      <img src="mascot/vimi-${f}.png" alt="" class="mx-auto h-[88px] w-auto drop-shadow" />
      <figcaption class="mt-1.5 text-[11.5px] font-semibold">${label}<span class="block text-[10.5px] font-normal text-slate-500 dark:text-slate-400">${hint}</span></figcaption>
    </figure>`).join("");
}
renderMascotPreview();

// ── Settings load + bind ────────────────────────────────────────────────────
function flashSaved() { $("saveStatus").textContent = "Saved ✓"; setTimeout(() => ($("saveStatus").textContent = ""), 1500); }
function showNextTest(cfg) { $("nextTestInfo").textContent = cfg.nextTestAt ? "Next: " + new Date(cfg.nextTestAt).toLocaleString() : "Not scheduled"; }

async function loadSettings() {
  const cfg = await F.getConfig();
  $("src").value = cfg.src; $("tgt").value = cfg.tgt; $("dailyGoal").value = cfg.dailyGoal;
  $("reminderEnabled").checked = cfg.reminderEnabled; $("reminderHour").value = String(cfg.reminderHour);
  $("testEnabled").checked = cfg.testEnabled; $("testFreq").value = cfg.testFreq;
  $("testWeekday").value = String(cfg.testWeekday); $("testQuestionCount").value = String(cfg.testQuestionCount);
  $("testType").value = cfg.testType; $("mascotEnabled").checked = cfg.mascotEnabled !== false;
  showNextTest(cfg);
}

function bindSetting(id, key, transform) {
  $(id).addEventListener("change", async () => {
    const el = $(id);
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (transform) v = transform(v);
    await F.setConfig({ [key]: v });
    flashSaved();
    if (["testFreq", "testWeekday", "reminderHour"].includes(id)) {
      const cfg = await F.getConfig();
      await F.setConfig({ nextTestAt: F.computeNextTest(F.now(), cfg) });
      showNextTest(await F.getConfig());
    }
  });
}
bindSetting("src", "src"); bindSetting("tgt", "tgt");
bindSetting("dailyGoal", "dailyGoal", (v) => Math.max(1, parseInt(v, 10) || 10));
bindSetting("reminderEnabled", "reminderEnabled"); bindSetting("reminderHour", "reminderHour", (v) => parseInt(v, 10));
bindSetting("testEnabled", "testEnabled"); bindSetting("testFreq", "testFreq");
bindSetting("testWeekday", "testWeekday", (v) => parseInt(v, 10));
bindSetting("testQuestionCount", "testQuestionCount", (v) => parseInt(v, 10));
bindSetting("testType", "testType"); bindSetting("mascotEnabled", "mascotEnabled");

$("rescheduleBtn").addEventListener("click", async () => {
  const cfg = await F.getConfig();
  await F.setConfig({ nextTestAt: F.computeNextTest(F.now(), cfg) });
  showNextTest(await F.getConfig());
  flashSaved();
});

$("testNotifyBtn").addEventListener("click", () => {
  chrome.notifications.create("fufu-test-notify", {
    type: "basic", iconUrl: "icon128.png", title: "Vimi Bilingual",
    message: "Test reminder — notifications are working.",
  }, (id) => {
    const err = chrome.runtime.lastError;
    $("notifyInfo").textContent = err ? "Blocked: " + err.message
      : id ? "Sent ✓ (if you don't see it, check Windows/Chrome notification settings)"
      : "No notification shown — check OS notification settings.";
  });
});

// ── Manual add word ──────────────────────────────────────────────────────────
async function autoTranslate(term, cfg) {
  if (typeof Translator === "undefined") return "";
  try {
    const t = await Translator.create({ sourceLanguage: cfg.src, targetLanguage: cfg.tgt });
    return await t.translate(term);
  } catch { return ""; }
}
$("addBtn").addEventListener("click", async () => {
  const term = $("addTerm").value.trim();
  if (!term) { $("addStatus").textContent = "Enter a word first."; return; }
  $("addStatus").textContent = "Adding…";
  const cfg = await F.getConfig();
  let trans = $("addTrans").value.trim();
  if (!trans) trans = await autoTranslate(term, cfg);
  await F.addWord({ term, translation: trans, src: cfg.src, tgt: cfg.tgt });
  $("addTerm").value = ""; $("addTrans").value = "";
  $("addStatus").textContent = "Added ✓";
  setTimeout(() => ($("addStatus").textContent = ""), 1500);
  renderVocab();
});

// ── Vocabulary list + selection ──────────────────────────────────────────────
const selected = new Set();
function updateSelCount() {
  $("selCount").textContent = `${selected.size} selected`;
}
async function renderVocab() {
  const all = await F.getVocab();
  const q = $("search").value.trim().toLowerCase();
  const filter = $("filter").value;
  const list = all.filter((w) => {
    if (filter !== "all" && (w.status || "new") !== filter) return false;
    if (q && !`${w.term} ${w.translation}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  $("vocabCount").textContent = `(${all.length})`;
  const ul = $("vocab");
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = `<li class="py-3 text-sm text-slate-500 dark:text-slate-400">No words. Add one above, or highlight text on any page.</li>`;
    updateSelCount();
    return;
  }
  const STATUS = { new: "bg-brand-50 text-brand-700", learning: "bg-orange-100 text-orange-700", mastered: "bg-green-100 text-green-700" };
  for (const w of list) {
    const status = w.status || "new";
    const li = document.createElement("li");
    li.className = "flex items-center gap-3 py-3 text-[15px]";
    li.innerHTML = `
      <input type="checkbox" class="vsel h-4 w-4 accent-brand-600" data-id="${w.id}" ${selected.has(w.id) ? "checked" : ""} />
      <span class="min-w-[150px] font-semibold">${escapeHtml(w.term)}</span>
      <span class="vtrans flex-1 text-slate-600 dark:text-slate-300">${escapeHtml(w.translation || "—")}</span>
      <span class="chip ${STATUS[status]}">${status}</span>
      <button class="vedit text-sm font-semibold text-brand-600 hover:underline" title="Edit meaning">Edit</button>
      <button class="vdel text-sm font-semibold text-red-600 hover:underline">Delete</button>`;
    li.querySelector(".vsel").addEventListener("change", (e) => {
      if (e.target.checked) selected.add(w.id); else selected.delete(w.id);
      updateSelCount();
    });
    li.querySelector(".vedit").addEventListener("click", () => {
      const span = li.querySelector(".vtrans");
      const input = document.createElement("input");
      input.className = "input vtrans flex-1 py-1 text-sm";
      input.value = w.translation || "";
      span.replaceWith(input);
      input.focus();
      let saved = false;
      const save = async () => { if (saved) return; saved = true; await F.updateWord(w.id, { translation: input.value.trim() }); renderVocab(); };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
        else if (e.key === "Escape") renderVocab();
      });
      input.addEventListener("blur", save);
    });
    li.querySelector(".vdel").addEventListener("click", async () => { await F.deleteWord(w.id); selected.delete(w.id); renderVocab(); });
    ul.appendChild(li);
  }
  updateSelCount();
}
$("search").addEventListener("input", renderVocab);
$("filter").addEventListener("change", renderVocab);
$("selectAll").addEventListener("change", (e) => {
  document.querySelectorAll(".vsel").forEach((cb) => {
    cb.checked = e.target.checked;
    if (e.target.checked) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id);
  });
  updateSelCount();
});
$("createDeckBtn").addEventListener("click", async () => {
  if (!selected.size) { $("deckName").focus(); return; }
  const name = $("deckName").value.trim() || `Deck (${selected.size} words)`;
  await F.createDeck(name, Array.from(selected));
  selected.clear(); $("deckName").value = ""; $("selectAll").checked = false;
  renderVocab(); renderDecks();
  showTab("decks");
});

// ── Export / import ───────────────────────────────────────────────────────────
$("exportBtn").addEventListener("click", async () => {
  const vocab = await F.getVocab();
  const blob = new Blob([JSON.stringify(vocab, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "vimi-vocabulary.json"; a.click();
  URL.revokeObjectURL(url);
});
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error("not an array");
    const existing = await F.getVocab();
    const seen = new Set(existing.map((w) => `${w.term.toLowerCase()}|${w.tgt}`));
    for (const w of data) {
      if (!w.term) continue;
      const key = `${w.term.toLowerCase()}|${w.tgt || ""}`;
      if (seen.has(key)) continue;
      seen.add(key); existing.push(w);
    }
    await F.setVocab(existing); renderVocab();
  } catch { alert("Import failed: invalid JSON file."); }
  e.target.value = "";
});

// ── Flashcard decks ───────────────────────────────────────────────────────────
async function renderDecks() {
  const decks = await F.getDecks();
  const el = $("decksList");
  if (!decks.length) {
    el.innerHTML = `<p class="text-sm text-slate-500 dark:text-slate-400">No decks yet. Go to Vocabulary, tick some words, and click “Create deck”.</p>`;
    return;
  }
  el.innerHTML = "";
  decks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach((d) => {
    const div = document.createElement("div");
    div.className = "card flex flex-col gap-4";
    div.innerHTML = `
      <div>
        <div class="font-bold">${escapeHtml(d.name)}</div>
        <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">${d.wordIds.length} word(s)</div>
      </div>
      <div class="mt-auto flex flex-col gap-2">
        <button class="btn btn-primary w-full dstudy">Study</button>
        <div class="flex gap-2">
          <button class="btn flex-1 drename" title="Rename deck">Rename</button>
          <button class="btn flex-1 ddel">Delete</button>
        </div>
      </div>`;
    div.querySelector(".dstudy").addEventListener("click", () =>
      chrome.tabs.create({ url: chrome.runtime.getURL(`review.html?deck=${d.id}`) })
    );
    div.querySelector(".drename").addEventListener("click", async () => {
      const nv = prompt("Deck name:", d.name);
      if (nv && nv.trim()) { await F.updateDeck(d.id, { name: nv.trim() }); renderDecks(); }
    });
    div.querySelector(".ddel").addEventListener("click", async () => { await F.deleteDeck(d.id); renderDecks(); });
    el.appendChild(div);
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function statCard(icon, num, label, sub) {
  return `<div class="card flex flex-col items-center gap-0.5 text-center">
    <div class="text-2xl">${icon}</div>
    <div class="text-2xl font-bold text-brand-600">${num}</div>
    <div class="text-xs text-slate-500 dark:text-slate-400">${label}</div>
    ${sub ? `<div class="text-[10px] text-slate-400">${sub}</div>` : ""}
  </div>`;
}
function statusBar(label, n, total, color) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return `<div class="mb-2.5">
    <div class="mb-1 flex justify-between text-xs"><span>${label}</span><span class="text-slate-500 dark:text-slate-400">${n}</span></div>
    <div class="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div class="h-full ${color}" style="width:${pct}%"></div></div>
  </div>`;
}
// GitHub-style year heatmap: 7 rows (days) × ~53 columns (weeks), shaded by
// daily activity intensity.
const HEAT_LV = [
  "bg-slate-200 dark:bg-slate-700",
  "bg-brand-200 dark:bg-brand-700",
  "bg-brand-400 dark:bg-brand-600",
  "bg-brand-600 dark:bg-brand-500",
  "bg-brand-800 dark:bg-brand-400",
];
function heatLevel(c) { return c <= 0 ? 0 : c <= 2 ? 1 : c <= 5 ? 2 : c <= 9 ? 3 : 4; }
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CELL_PITCH = 16; // 12px square + 4px gap
function buildHeatmap(activity) {
  const DAY = 86400000;
  const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 364 * DAY);
  start.setDate(start.getDate() - start.getDay()); // back to Sunday (row 0)

  // Squares in column-major order (7 rows per week column).
  let cells = "", active = 0;
  for (let t = start.getTime(); t <= today.getTime(); t += DAY) {
    const d = new Date(t);
    const e = activity[dk(d)];
    const added = e ? e.added || 0 : 0;
    const reviews = e ? e.reviews || 0 : 0;
    const c = added + reviews;
    if (c > 0) active++;
    const date = `${MON_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const tip = c === 0
      ? `No activity on ${date}`
      : `${date} — ${plural(added, "word")} learned, ${plural(reviews, "review")}`;
    cells += `<div class="h-3 w-3 rounded-sm ${HEAT_LV[heatLevel(c)]}" title="${tip}"></div>`;
  }

  // Month labels: group week-columns by the month of each column's Sunday.
  const totalDays = Math.round((today - start) / DAY) + 1;
  const cols = Math.ceil(totalDays / 7);
  const groups = [];
  let prev = -1;
  for (let col = 0; col < cols; col++) {
    const m = new Date(start.getTime() + col * 7 * DAY).getMonth();
    if (m !== prev) { groups.push({ label: MON_SHORT[m], weeks: 1 }); prev = m; }
    else groups[groups.length - 1].weeks++;
  }
  // Drop a 1-week leading stub label so it doesn't crowd the next month.
  if (groups.length > 1 && groups[0].weeks <= 1) groups[0].label = "";
  const months = groups.map((g) =>
    `<div class="overflow-hidden whitespace-nowrap text-[10px] text-slate-400" style="width:${g.weeks * CELL_PITCH}px">${g.label}</div>`
  ).join("");

  return { cells, active, months };
}

async function renderDashboard() {
  const s = await F.getStats();
  const activity = await F.getActivity();
  const hm = buildHeatmap(activity);
  const legend = HEAT_LV.map((cls) => `<span class="h-3 w-3 rounded-sm ${cls}"></span>`).join("");
  // Weekday labels (row 0 = Sunday); GitHub shows Mon / Wed / Fri only.
  const weekdayCol = ["", "Mon", "", "Wed", "", "Fri", ""]
    .map((w) => `<div class="h-3 text-[10px] leading-3 text-slate-400">${w}</div>`).join("");
  const goalPct = Math.min(100, Math.round((s.addedToday / (s.dailyGoal || 1)) * 100));
  const maxAct = Math.max(1, ...s.last14.map((d) => d.count));
  const bars = s.last14.map((d) => {
    const h = d.count ? Math.max(8, Math.round((d.count / maxAct) * 100)) : 2;
    return `<div class="flex flex-1 flex-col items-center gap-1" title="${d.day}: ${d.count}">
      <div class="flex h-24 w-full items-end"><div class="w-full rounded-t bg-brand-500" style="height:${h}%"></div></div>
      <div class="text-[9px] text-slate-400">${d.day.slice(5)}</div>
    </div>`;
  }).join("");
  $("dashboard").innerHTML = `
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      ${statCard("🔥", s.streak, "day streak", "Best: " + s.best)}
      ${statCard("📅", s.due, "due now", "")}
      ${statCard("📚", s.total, "total words", "")}
      ${statCard("✅", s.byStatus.mastered, "mastered", "")}
    </div>
    <section class="card">
      <div class="mb-2 flex justify-between text-sm"><span class="font-semibold">Today</span>
        <span class="text-slate-500 dark:text-slate-400">${s.addedToday}/${s.dailyGoal} words · ${s.reviewsToday} reviews</span></div>
      <div class="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div class="h-full rounded-full bg-brand-600" style="width:${goalPct}%"></div></div>
    </section>
    <section class="card">
      <div class="mb-3 text-sm font-semibold">Vocabulary breakdown</div>
      ${statusBar("New", s.byStatus.new, s.total, "bg-brand-500")}
      ${statusBar("Learning", s.byStatus.learning, s.total, "bg-orange-500")}
      ${statusBar("Mastered", s.byStatus.mastered, s.total, "bg-green-500")}
    </section>
    <section class="card">
      <div class="mb-3 text-sm font-semibold">Activity (last 14 days)</div>
      <div class="flex items-end gap-1">${bars}</div>
    </section>
    <section class="card">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-sm font-semibold">Activity this year</span>
        <span class="text-xs text-slate-500 dark:text-slate-400">${hm.active} active days</span>
      </div>
      <div class="overflow-x-auto pb-1">
        <div class="mx-auto flex w-max flex-col gap-1">
          <div class="flex pl-[34px]">${hm.months}</div>
          <div class="flex gap-1">
            <div class="flex w-[30px] flex-col gap-1">${weekdayCol}</div>
            <div class="grid w-max grid-flow-col grid-rows-[repeat(7,12px)] gap-1">${hm.cells}</div>
          </div>
        </div>
      </div>
      <div class="mt-2 flex items-center justify-end gap-1 text-[10px] text-slate-400">
        Less ${legend} More
      </div>
    </section>`;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const navButtons = document.querySelectorAll("#nav .nav-btn");
const panels = document.querySelectorAll(".tab-panel");
function showTab(name) {
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== name));
  if (name === "decks") renderDecks();
  if (name === "dashboard") renderDashboard();
}
navButtons.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

loadSettings();
renderVocab();
showTab("dashboard");
