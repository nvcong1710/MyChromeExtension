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
const modelStatus = $("modelStatus");
const modelStatusIcon = $("modelStatusIcon");
const modelStatusText = $("modelStatusText");
const modelAction = $("modelAction");
const modelActionIcon = $("modelActionIcon");
const modelActionText = $("modelActionText");

const MODEL_ICONS = Object.freeze({
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>',
  required: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>',
  unavailable: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 8.5 4.8 4.8 0 0 0 7 18Z"/></svg>',
  spinner: '<svg class="model-spinner" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
});

let tab = null;
let host = "";
let modelRequestId = 0;
let languageChangeId = 0;
let languageSaveQueue = Promise.resolve();
let appliedPair = null;
let languageSelectionDirty = false;
let currentModelState = "checking";
const modelDownloads = new Map();

function fill(sel) {
  sel.innerHTML = "";
  const popGroup = document.createElement("optgroup");
  popGroup.label = "Popular Languages";
  for (const [code, name] of F.POPULAR_LANGUAGES) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = `${shortLanguageName(code, name)} (${code})`;
    o.title = `${name} (${code})`;
    popGroup.appendChild(o);
  }
  sel.appendChild(popGroup);

  const allGroup = document.createElement("optgroup");
  allGroup.label = "All Languages (A-Z)";
  for (const [code, name] of F.LANGUAGES) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = `${shortLanguageName(code, name)} (${code})`;
    o.title = `${name} (${code})`;
    allGroup.appendChild(o);
  }
  sel.appendChild(allGroup);
}

function shortLanguageName(code, name) {
  if (code === "zh") return "Chinese";
  if (code === "zh-TW" || code === "zh-Hant") return "Chinese Trad.";
  return name.replace(/\s*\([^)]*\)\s*$/, "");
}

function syncLanguageTitles() {
  srcSel.title = srcSel.selectedOptions?.[0]?.title || srcSel.selectedOptions?.[0]?.textContent || "";
  tgtSel.title = tgtSel.selectedOptions?.[0]?.title || tgtSel.selectedOptions?.[0]?.textContent || "";
}
fill(srcSel);
fill(tgtSel);

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

async function send(type, detail = {}) {
  if (!tab?.id) return null;
  try { return await chrome.tabs.sendMessage(tab.id, { type, ...detail }); } catch { return null; }
}

function selectedPair() {
  return { sourceLanguage: srcSel.value, targetLanguage: tgtSel.value };
}

function pairKey({ sourceLanguage, targetLanguage }) {
  return `${sourceLanguage}->${targetLanguage}`;
}

function isCurrentPair(pair) {
  const current = selectedPair();
  return current.sourceLanguage === pair.sourceLanguage &&
    current.targetLanguage === pair.targetLanguage;
}

function selectedPairNeedsApply() {
  if (!appliedPair) return languageSelectionDirty;
  const current = selectedPair();
  return current.sourceLanguage !== appliedPair.sourceLanguage ||
    current.targetLanguage !== appliedPair.targetLanguage;
}

function onDevicePair(pair) {
  return F.toOnDevicePair ? F.toOnDevicePair(pair) : pair;
}

function errorSummary(error) {
  const name = error?.name && error.name !== "Error" ? `${error.name}: ` : "";
  return `${name}${error?.message || String(error)}`;
}

function renderModelState(state) {
  const states = {
    checking: { status: "Checking model…", icon: "spinner", tone: "neutral", action: "", actionType: "none", disabled: true },
    ready: { status: "Model ready", icon: "check", tone: "ready", action: "Refresh", actionIcon: "refresh", actionType: "apply", disabled: false },
    required: { status: "Model required", icon: "required", tone: "required", action: "Download model", actionIcon: "download", actionType: "download", disabled: false },
    downloading: { status: "Downloading model…", icon: "spinner", tone: "required", action: "Downloading…", actionIcon: "spinner", actionType: "none", disabled: true },
    cloud: { status: "Local model unavailable · Use cloud", icon: "cloud", tone: "neutral", action: "Use cloud", actionIcon: "refresh", actionType: "apply", disabled: false },
    checkFailed: { status: "Model check failed · Use cloud", icon: "cloud", tone: "neutral", action: "Use cloud", actionIcon: "refresh", actionType: "apply", disabled: false },
    downloadFailed: { status: "Model download failed · Use cloud", icon: "unavailable", tone: "error", action: "Use cloud", actionIcon: "refresh", actionType: "apply", disabled: false },
  };
  currentModelState = states[state] ? state : "cloud";
  const view = { ...(states[currentModelState]) };
  const needsApply = selectedPairNeedsApply();
  if (needsApply && state === "ready") {
    view.status = "Changes not applied";
    view.action = "Apply & refresh";
    view.tone = "required";
  }
  if (!needsApply && view.actionType === "apply" && currentModelState !== "ready") {
    view.action = "Refresh with cloud";
  }
  modelStatus.dataset.tone = view.tone;
  modelStatusIcon.innerHTML = MODEL_ICONS[view.icon] || "";
  modelStatusText.textContent = view.status;
  modelActionIcon.innerHTML = MODEL_ICONS[view.actionIcon] || "";
  modelActionText.textContent = view.action;
  modelAction.disabled = view.disabled;
  modelAction.dataset.modelState = currentModelState;
  modelAction.dataset.actionType = view.actionType;
  modelAction.classList.toggle("hidden", !view.action);
  modelAction.classList.toggle("model-action-download", view.actionType === "download");
  modelAction.title = view.actionType === "download"
    ? "Download the on-device translation model"
    : "Apply this language pair and refresh translation";
}

function stateForAvailability(availability) {
  if (availability === "available" || availability === "readily") return "ready";
  if (availability === "downloadable" || availability === "after-download") return "required";
  if (availability === "downloading") return "downloading";
  return "cloud";
}

async function checkModelStatus() {
  const requestId = ++modelRequestId;
  const pair = selectedPair();
  renderModelState("checking");

  if (typeof Translator === "undefined") {
    if (requestId === modelRequestId && isCurrentPair(pair)) renderModelState("cloud");
    return;
  }

  try {
    const availability = await Translator.availability(onDevicePair(pair));
    if (requestId !== modelRequestId || !isCurrentPair(pair)) return;
    const state = stateForAvailability(availability);
    if (state === "cloud" && availability !== "unavailable") {
      console.warn(`[Vimi] Unknown model availability (${pairKey(pair)}): ${availability}`);
    }
    renderModelState(state);
  } catch (error) {
    if (requestId !== modelRequestId || !isCurrentPair(pair)) return;
    console.warn(`[Vimi] Model availability check failed (${pairKey(pair)}): ${errorSummary(error)}`);
    renderModelState("checkFailed");
  }
}

async function applySelectedPair() {
  const pair = selectedPair();
  await F.setConfig({ src: pair.sourceLanguage, tgt: pair.targetLanguage });
  if (!isCurrentPair(pair)) return;
  const localModelReady = currentModelState === "ready";
  const response = await send("BT_RELOAD", {
    localModelReady,
    preferCloud: !localModelReady,
  });
  if (response?.ok && isCurrentPair(pair)) {
    appliedPair = { ...pair };
    languageSelectionDirty = false;
    renderModelState(currentModelState);
  }
}

async function downloadSelectedModel() {
  if (typeof Translator === "undefined") {
    renderModelState("cloud");
    return;
  }

  const pair = selectedPair();
  const key = pairKey(pair);
  const requestId = ++modelRequestId;
  renderModelState("downloading");

  try {
    let download = modelDownloads.get(key);
    if (!download) {
      download = (async () => {
        const translator = await Translator.create({
          ...onDevicePair(pair),
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", () => {
              if (requestId === modelRequestId && isCurrentPair(pair)) {
                renderModelState("downloading");
              }
            });
          },
        });
        translator?.destroy?.();
      })();
      modelDownloads.set(key, download);
      download.then(
        () => modelDownloads.delete(key),
        () => modelDownloads.delete(key)
      );
    }
    await download;
    if (requestId === modelRequestId && isCurrentPair(pair)) renderModelState("ready");
  } catch (error) {
    if (requestId !== modelRequestId || !isCurrentPair(pair)) return;
    console.warn(`[Vimi] Model download failed (${pairKey(pair)}): ${errorSummary(error)}`);
    renderModelState("downloadFailed");
  }
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
  appliedPair = selectedPair();
  syncLanguageTitles();
  $("mascot").checked = cfg.mascotEnabled !== false;
  $("videoSub").checked = cfg.videoSubEnabled !== false;

  if (usable) {
    $("host").textContent = host;
    const hosts = await F.getHosts();
    power.checked = !!hosts[host];
    const runtimeConfig = await send("BT_GET_CONFIG");
    if (runtimeConfig?.ok) {
      appliedPair = {
        sourceLanguage: runtimeConfig.sourceLanguage,
        targetLanguage: runtimeConfig.targetLanguage,
      };
    }
  } else {
    document.body.classList.add("bt-disabled");
    const isLocal = tab?.url?.startsWith("file:");
    if (isLocal) {
      $("host").innerHTML = 'Local file &bull; <a id="localFileLink" href="#" class="font-semibold text-brand-600 underline">Open in Doc2Notion ↗</a>';
      $("localFileLink")?.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: "https://doc2-notion.vercel.app/" });
        window.close();
      });
    } else {
      $("host").textContent = "Not available on this page";
    }
    power.disabled = true;
  }

  await Promise.all([refreshStats(), checkModelStatus()]);
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
  const changeId = ++languageChangeId;
  const pair = selectedPair();
  languageSelectionDirty = true;
  syncLanguageTitles();
  languageSaveQueue = languageSaveQueue
    .catch(() => {})
    .then(() => F.setConfig({ src: pair.sourceLanguage, tgt: pair.targetLanguage }));
  await languageSaveQueue;
  if (changeId !== languageChangeId || !isCurrentPair(pair)) return;
  await checkModelStatus();
}
srcSel.addEventListener("change", saveLangs);
tgtSel.addEventListener("change", saveLangs);
$("swap").addEventListener("click", () => {
  const a = srcSel.value;
  srcSel.value = tgtSel.value;
  tgtSel.value = a;
  saveLangs();
});

modelAction.addEventListener("click", () => {
  const actionType = modelAction.dataset.actionType;
  if (actionType === "download") downloadSelectedModel();
  else if (actionType === "apply") applySelectedPair();
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
$("openDoc2Notion")?.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "https://doc2-notion.vercel.app/" });
  window.close();
});

init();
