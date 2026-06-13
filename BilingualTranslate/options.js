// Settings page: default language pair + management of the sites that have
// auto-translate turned on. Same storage keys as popup/content (btSrc/btTgt/
// btHosts), so everything stays in sync.

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
const srcSel = $("src");
const tgtSel = $("tgt");
const status = $("status");
const sitesEl = $("sites");

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

chrome.storage.local.get(["btSrc", "btTgt"], (cfg) => {
  srcSel.value = cfg.btSrc || "en";
  tgtSel.value = cfg.btTgt || "vi";
});

function saveLangs() {
  chrome.storage.local.set({ btSrc: srcSel.value, btTgt: tgtSel.value }, () => {
    status.textContent = "Saved ✓";
    setTimeout(() => (status.textContent = ""), 1500);
  });
}
srcSel.addEventListener("change", saveLangs);
tgtSel.addEventListener("change", saveLangs);
$("swap").addEventListener("click", () => {
  const a = srcSel.value;
  srcSel.value = tgtSel.value;
  tgtSel.value = a;
  saveLangs();
});

// ── Enabled-sites list ──────────────────────────────────────────────────
function renderSites() {
  chrome.storage.local.get(["btHosts"], (cfg) => {
    const hosts = Object.keys(cfg.btHosts || {}).sort();
    sitesEl.innerHTML = "";
    if (!hosts.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No sites yet. Turn on translation on a page to add it here.";
      sitesEl.appendChild(li);
      return;
    }
    for (const h of hosts) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = h;
      const btn = document.createElement("button");
      btn.className = "site-remove";
      btn.textContent = "Remove";
      btn.addEventListener("click", () => removeSite(h));
      li.append(name, btn);
      sitesEl.appendChild(li);
    }
  });
}

function removeSite(host) {
  chrome.storage.local.get(["btHosts"], (cfg) => {
    const hosts = cfg.btHosts || {};
    delete hosts[host];
    chrome.storage.local.set({ btHosts: hosts }, renderSites);
  });
}

renderSites();
