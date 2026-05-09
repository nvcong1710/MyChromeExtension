(function () {
  const SIDEBAR_ID = "fcs-sidebar";
  const STORAGE_KEY = "flashcards";
  const VISIBLE_KEY = "fcsVisible";

  let flashcards = [];
  let visible = false;

  async function loadState() {
    const data = await chrome.storage.local.get([STORAGE_KEY, VISIBLE_KEY]);
    flashcards = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    visible = typeof data[VISIBLE_KEY] === "boolean" ? data[VISIBLE_KEY] : false;
  }

  async function saveFlashcards() {
    await chrome.storage.local.set({ [STORAGE_KEY]: flashcards });
  }

  async function setVisible(v) {
    visible = v;
    await chrome.storage.local.set({ [VISIBLE_KEY]: v });
    applyVisibility();
  }

  function applyVisibility() {
    const sidebar = document.getElementById(SIDEBAR_ID);
    if (!sidebar) return;
    sidebar.classList.toggle("fcs-visible", visible);
    document.documentElement.style.setProperty(
      "--fcs-margin",
      visible ? "320px" : "0px"
    );
    document.body.style.marginRight = visible ? "320px" : "";
  }

  function buildSidebar() {
    if (document.getElementById(SIDEBAR_ID)) return;

    const sidebar = document.createElement("div");
    sidebar.id = SIDEBAR_ID;
    sidebar.innerHTML = `
      <div class="fcs-header">
        <span class="fcs-title">Flashcards</span>
        <span class="fcs-count" id="fcs-count">0</span>
        <button class="fcs-close" id="fcs-close" title="Close (Alt+F)">×</button>
      </div>
      <div class="fcs-body">
        <div class="fcs-search-row">
          <input type="text" id="fcs-search" placeholder="Search word/definition..." />
        </div>
        <ul class="fcs-list" id="fcs-list"></ul>
        <div class="fcs-add">
          <input type="text" id="fcs-word" placeholder="Word" />
          <input type="text" id="fcs-def" placeholder="Definition" />
          <div class="fcs-add-actions">
            <button id="fcs-add-btn" class="fcs-primary">Add</button>
            <button id="fcs-import-csv-btn" title="Import CSV (word,definition)">Import CSV</button>
            <input type="file" id="fcs-import-csv" accept=".csv,text/csv" hidden />
            <button id="fcs-export-btn">Export JSON</button>
          </div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(sidebar);

    wireEvents(sidebar);
    renderList();
  }

  function renderList() {
    const list = document.getElementById("fcs-list");
    const count = document.getElementById("fcs-count");
    const search = document.getElementById("fcs-search");
    if (!list || !count) return;

    const q = (search?.value || "").trim().toLowerCase();
    const filtered = q
      ? flashcards.filter(
          (fc) =>
            (fc.word || "").toLowerCase().includes(q) ||
            (fc.definition || "").toLowerCase().includes(q)
        )
      : flashcards;

    count.textContent = `${filtered.length}/${flashcards.length}`;
    list.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("li");
      empty.className = "fcs-empty";
      empty.textContent = flashcards.length === 0
        ? "No flashcards yet. Add one below."
        : "No matches.";
      list.appendChild(empty);
      return;
    }

    filtered.forEach((fc) => {
      const originalIdx = flashcards.indexOf(fc);
      const li = document.createElement("li");
      li.className = "fcs-item";

      const text = document.createElement("div");
      text.className = "fcs-item-text";

      const word = document.createElement("strong");
      word.textContent = fc.word || "(empty)";
      const def = document.createElement("div");
      def.className = "fcs-item-def";
      def.textContent = fc.definition || "";

      text.appendChild(word);
      text.appendChild(def);

      const del = document.createElement("button");
      del.className = "fcs-del";
      del.textContent = "×";
      del.title = "Delete";
      del.addEventListener("click", async () => {
        flashcards.splice(originalIdx, 1);
        await saveFlashcards();
        renderList();
      });

      li.appendChild(text);
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  function parseCsv(text) {
    const rows = [];
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const commaIdx = line.indexOf(",");
      if (commaIdx === -1) continue;
      const word = line.slice(0, commaIdx).trim().replace(/^"|"$/g, "");
      const definition = line.slice(commaIdx + 1).trim().replace(/^"|"$/g, "");
      if (word) rows.push({ word, definition });
    }
    return rows;
  }

  function wireEvents(sidebar) {
    sidebar.querySelector("#fcs-close").addEventListener("click", () => setVisible(false));

    const wordEl = sidebar.querySelector("#fcs-word");
    const defEl = sidebar.querySelector("#fcs-def");
    const addBtn = sidebar.querySelector("#fcs-add-btn");

    async function add() {
      const word = wordEl.value.trim();
      const definition = defEl.value.trim();
      if (!word) return;
      if (flashcards.some((fc) => fc.word.toLowerCase() === word.toLowerCase())) {
        wordEl.classList.add("fcs-dup");
        setTimeout(() => wordEl.classList.remove("fcs-dup"), 800);
        return;
      }
      flashcards.push({ word, definition });
      await saveFlashcards();
      wordEl.value = "";
      defEl.value = "";
      wordEl.focus();
      renderList();
    }

    addBtn.addEventListener("click", add);
    [wordEl, defEl].forEach((el) =>
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") add();
      })
    );

    sidebar.querySelector("#fcs-search").addEventListener("input", renderList);

    const importBtn = sidebar.querySelector("#fcs-import-csv-btn");
    const importFile = sidebar.querySelector("#fcs-import-csv");
    importBtn.addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const rows = parseCsv(text);
      let added = 0;
      const existingWords = new Set(flashcards.map((f) => f.word.toLowerCase()));
      for (const row of rows) {
        if (existingWords.has(row.word.toLowerCase())) continue;
        flashcards.push(row);
        existingWords.add(row.word.toLowerCase());
        added++;
      }
      await saveFlashcards();
      renderList();
      e.target.value = "";
      alert(`Imported ${added} new flashcards (skipped ${rows.length - added} duplicates).`);
    });

    sidebar.querySelector("#fcs-export-btn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(flashcards, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "flashcards.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "TOGGLE_FLASHCARD_SIDEBAR") {
      setVisible(!visible);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]) {
      flashcards = Array.isArray(changes[STORAGE_KEY].newValue)
        ? changes[STORAGE_KEY].newValue
        : [];
      renderList();
    }
  });

  loadState().then(() => {
    buildSidebar();
    applyVisibility();
  });
})();
