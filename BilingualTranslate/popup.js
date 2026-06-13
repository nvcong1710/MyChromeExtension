// Popup control panel. Reflects and controls the current tab's translation
// state. Source of truth lives in chrome.storage.local (btHosts / btSrc /
// btTgt); the content script reads the same keys, so popup and page stay in
// sync. Actions are pushed to the page via messages (BT_TOGGLE / BT_RELOAD).

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

const $ = (id) => document.getElementById(id);
const power = $("power");
const srcSel = $("src");
const tgtSel = $("tgt");

let tab = null;
let host = "";

function fill(sel) {
  for (const [code, name] of LANGS) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = `${name} (${code})`;
    sel.appendChild(o);
  }
}
fill(srcSel);
fill(tgtSel);

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function send(type) {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    // content script absent — ignore
  }
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const usable = tab && /^https?:/.test(tab.url || "");
  host = usable ? hostOf(tab.url) : "";

  const cfg = await chrome.storage.local.get(["btHosts", "btSrc", "btTgt"]);
  srcSel.value = cfg.btSrc || "en";
  tgtSel.value = cfg.btTgt || "vi";

  if (!usable) {
    document.body.classList.add("bt-disabled");
    $("host").textContent = "Not available on this page";
    return;
  }

  $("host").textContent = host;
  const hosts = cfg.btHosts || {};
  power.checked = !!hosts[host];
}

// Master toggle for the current site.
power.addEventListener("change", () => {
  send("BT_TOGGLE"); // content script flips state + updates btHosts
});

// Language changes: persist, then re-translate live if currently on.
function saveLangsAndMaybeReload() {
  chrome.storage.local.set({ btSrc: srcSel.value, btTgt: tgtSel.value }, () => {
    if (power.checked) send("BT_RELOAD");
  });
}
srcSel.addEventListener("change", saveLangsAndMaybeReload);
tgtSel.addEventListener("change", saveLangsAndMaybeReload);

$("swap").addEventListener("click", () => {
  const a = srcSel.value;
  srcSel.value = tgtSel.value;
  tgtSel.value = a;
  saveLangsAndMaybeReload();
});

$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());

init();
