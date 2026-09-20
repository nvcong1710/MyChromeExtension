// Popup control panel. Translation toggle + language pair (shared with content
// via fufuConfig / fufuHosts), plus learning stats and entry points to the
// Review and Test pages. store.js (self.FuFu) is loaded first.

const F = self.FuFu;
const $ = (id) => document.getElementById(id);
const power = $("power");
// Notification dot for Review/Test buttons (Tailwind classes, literal for purge).
const DOT_CLASS =
  "vm-dot absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-white text-[10px] leading-4 font-bold text-center";
const srcSel = $("src");
const tgtSel = $("tgt");

let tab = null;
let host = "";

function fill(sel) {
  sel.innerHTML = "";
  const popGroup = document.createElement("optgroup");
  popGroup.label = "Popular Languages";
  for (const [code, name] of F.POPULAR_LANGUAGES) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = `${name} (${code})`;
    popGroup.appendChild(o);
  }
  sel.appendChild(popGroup);

  const allGroup = document.createElement("optgroup");
  allGroup.label = "All Languages (A-Z)";
  for (const [code, name] of F.LANGUAGES) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = `${name} (${code})`;
    allGroup.appendChild(o);
  }
  sel.appendChild(allGroup);
}
fill(srcSel);
fill(tgtSel);

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

async function send(type) {
  if (!tab?.id) return;
  try { await chrome.tabs.sendMessage(tab.id, { type }); } catch {}
}

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function refreshStats() {
  const cfg = await F.getConfig();
  const vocab = await F.getVocab();
  const due = await F.dueCount();
  const today = startOfDay();
  const learnedToday = vocab.filter((w) => (w.createdAt || 0) >= today).length;

  $("dueNum").textContent = String(due);
  $("goalNum").textContent = `${learnedToday}/${cfg.dailyGoal}`;
  $("totalNum").textContent = String(vocab.length);
  $("streakNum").textContent = String(await F.getStreak());

  // Review button: badge with due count
  const reviewBtn = $("review");
  reviewBtn.querySelector(".vm-dot")?.remove();
  if (due > 0) {
    const dot = document.createElement("span");
    dot.className = DOT_CLASS;
    dot.textContent = String(Math.min(due, 99));
    reviewBtn.appendChild(dot);
  }

  // Test button + note
  const pending = await F.getPendingTest();
  const testBtn = $("test");
  testBtn.querySelector(".vm-dot")?.remove();
  if (pending) {
    const dot = document.createElement("span");
    dot.className = DOT_CLASS;
    dot.textContent = "!";
    testBtn.appendChild(dot);
    $("testNote").textContent = `Test ready: ${pending.count} questions waiting`;
  } else if (cfg.nextTestAt) {
    const d = new Date(cfg.nextTestAt);
    $("testNote").textContent = `Next test: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } else {
    $("testNote").textContent = "";
  }
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const usable = tab && /^https?:/.test(tab.url || "");
  host = usable ? hostOf(tab.url) : "";

  const cfg = await F.getConfig();
  srcSel.value = cfg.src || "en";
  tgtSel.value = cfg.tgt || "vi";
  $("mascot").checked = cfg.mascotEnabled !== false;
  $("videoSub").checked = cfg.videoSubEnabled !== false;

  if (usable) {
    $("host").textContent = host;
    const hosts = await F.getHosts();
    power.checked = !!hosts[host];
  } else {
    document.body.classList.add("bt-disabled");
    $("host").textContent = "Not available on this page";
    power.disabled = true;
  }

  await refreshStats();
}

power.addEventListener("change", () => send("BT_TOGGLE"));

// Show/hide the mascot. Open tabs react live via mascot.js's storage listener.
$("mascot").addEventListener("change", () => {
  F.setConfig({ mascotEnabled: $("mascot").checked });
});

// Toggle video bilingual subtitles.
$("videoSub").addEventListener("change", () => {
  F.setConfig({ videoSubEnabled: $("videoSub").checked });
});

async function saveLangs() {
  await F.setConfig({ src: srcSel.value, tgt: tgtSel.value });
  if (power.checked) send("BT_RELOAD");
}
srcSel.addEventListener("change", saveLangs);
tgtSel.addEventListener("change", saveLangs);
$("swap").addEventListener("click", () => {
  const a = srcSel.value;
  srcSel.value = tgtSel.value;
  tgtSel.value = a;
  saveLangs();
});

$("review").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
  window.close();
});
$("test").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("test.html") });
  window.close();
});
$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());

init();
