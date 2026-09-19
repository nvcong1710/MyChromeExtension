// First-run welcome page: compatibility check + language picker + shortcuts.
const F = self.FuFu;
const $ = (id) => document.getElementById(id);

const LANGS = [
  ["en", "English"], ["vi", "Vietnamese"], ["ja", "Japanese"], ["ko", "Korean"],
  ["zh", "Chinese"], ["fr", "French"], ["de", "German"], ["es", "Spanish"], ["ru", "Russian"],
];
function fillLangs(sel) {
  for (const [code, name] of LANGS) {
    const o = document.createElement("option");
    o.value = code; o.textContent = `${name} (${code})`; sel.appendChild(o);
  }
}
fillLangs($("src"));
fillLangs($("tgt"));

// Show the compatibility banner only if the Translator API is missing.
if (typeof Translator === "undefined") $("compat").classList.remove("hidden");

(async () => {
  const cfg = await F.getConfig();
  $("src").value = cfg.src;
  $("tgt").value = cfg.tgt;
})();

$("saveLangs").addEventListener("click", async () => {
  await F.setConfig({ src: $("src").value, tgt: $("tgt").value });
  $("langStatus").textContent = "Saved ✓";
  setTimeout(() => ($("langStatus").textContent = ""), 1500);
});

$("openSettings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
$("closeBtn").addEventListener("click", () => window.close());
