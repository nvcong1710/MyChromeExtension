// First-run welcome page: compatibility check + language picker + shortcuts.
const F = self.FuFu;
const $ = (id) => document.getElementById(id);

function fillLangs(sel) {
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
fillLangs($("src"));
fillLangs($("tgt"));

// Show the compatibility banner only if the Translator API is missing.
if (typeof Translator === "undefined") $("compat").classList.remove("hidden");

async function checkModelStatus() {
  const src = $("src").value;
  const tgt = $("tgt").value;
  const badge = $("modelBadge");
  const desc = $("modelDesc");
  const btn = $("downloadModelBtn");
  const prog = $("modelProgressContainer");

  if (!badge || !desc || !btn) return;

  if (typeof Translator === "undefined") {
    badge.textContent = "Cloud Fallback Ready";
    badge.className = "chip bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    desc.textContent = "Your browser will automatically use the instant cloud fallback for all translations.";
    btn.classList.add("hidden");
    return;
  }

  try {
    const availability = await Translator.availability({ sourceLanguage: src, targetLanguage: tgt }).catch(() => "unavailable");
    if (availability === "available" || availability === "readily") {
      badge.textContent = "Ready ✓";
      badge.className = "chip bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
      desc.textContent = "Local AI model is installed and ready for instant offline translations!";
      btn.classList.add("hidden");
      prog?.classList.add("hidden");
    } else if (availability === "downloading") {
      badge.textContent = "Downloading…";
      badge.className = "chip bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
      desc.textContent = "Model is currently being downloaded in the background.";
      btn.classList.add("hidden");
      prog?.classList.remove("hidden");
    } else if (availability === "after-download" || availability === "downloadable") {
      badge.textContent = "Download Required";
      badge.className = "chip bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
      desc.textContent = "Download the local model once (~25MB) so video subtitles and word lookup work offline.";
      btn.classList.remove("hidden");
      btn.textContent = "📥 Download Model";
      btn.disabled = false;
    } else {
      badge.textContent = "Cloud Fallback Ready";
      badge.className = "chip bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
      desc.textContent = `Offline model not available for ${src}→${tgt}. Instant cloud fallback will handle all translations seamlessly.`;
      btn.classList.add("hidden");
    }
  } catch {
    badge.textContent = "Cloud Fallback Ready";
    badge.className = "chip bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    desc.textContent = "Instant cloud fallback active. All features (subtitles, words, pages) are fully operational.";
    btn.classList.add("hidden");
  }
}

async function startModelDownload() {
  const src = $("src").value;
  const tgt = $("tgt").value;
  const btn = $("downloadModelBtn");
  const prog = $("modelProgressContainer");
  const bar = $("modelProgressBar");
  const pct = $("modelProgressPct");
  const lbl = $("modelProgressLabel");
  const badge = $("modelBadge");

  btn.disabled = true;
  btn.textContent = "Preparing…";
  prog.classList.remove("hidden");
  bar.style.width = "5%";
  pct.textContent = "5%";
  lbl.textContent = `Downloading ${src}→${tgt} model…`;

  try {
    await Translator.create({
      sourceLanguage: src,
      targetLanguage: tgt,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          const loadedPct = Math.round((e.loaded || 0) * 100);
          bar.style.width = `${Math.max(5, loadedPct)}%`;
          pct.textContent = `${loadedPct}%`;
          lbl.textContent = `Downloading model (${loadedPct}%)…`;
        });
      },
    });
    bar.style.width = "100%";
    pct.textContent = "100%";
    badge.textContent = "Ready ✓";
    badge.className = "chip bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
    $("modelDesc").textContent = "Language model installed! All features are ready on-device.";
    btn.classList.add("hidden");
    setTimeout(() => prog.classList.add("hidden"), 2500);
  } catch (err) {
    console.warn("Model download error:", err);
    lbl.textContent = "Could not download local model. Cloud fallback will be used.";
    badge.textContent = "Cloud Fallback Active";
    badge.className = "chip bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    btn.classList.add("hidden");
  }
}

(async () => {
  const cfg = await F.getConfig();
  $("src").value = cfg.src;
  $("tgt").value = cfg.tgt;
  await checkModelStatus();
})();

$("src").addEventListener("change", checkModelStatus);
$("tgt").addEventListener("change", checkModelStatus);
$("downloadModelBtn")?.addEventListener("click", startModelDownload);

$("saveLangs").addEventListener("click", async () => {
  await F.setConfig({ src: $("src").value, tgt: $("tgt").value });
  $("langStatus").textContent = "Saved ✓";
  setTimeout(() => ($("langStatus").textContent = ""), 1500);
  await checkModelStatus();
});

$("openSettings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
$("closeBtn").addEventListener("click", () => window.close());
