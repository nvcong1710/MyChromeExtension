
// content.js v1.8
(function(){
  const STORAGE_KEYS = {
    vocab: "vocab",
    currentIndex: "currentIndex",
    noteVisible: "noteVisible",
    notePosition: "notePosition",
    noteSize: "noteSize",
    listVisible: "listVisible",
    docked: "docked",
    dockWidth: "dockWidth"
  };
  const MIN_W = 320, MIN_H = 260;
  const SIZE_EPS = 6;
  const DOCK_MIN_W = 260, DOCK_MAX_W_RATIO = 0.7;
  const DEFAULT_DOCK_W = 300;

  async function ensureDefaults() {
    const data = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
    const updates = {};
    if (typeof data.noteVisible !== "boolean") updates.noteVisible = true;
    if (typeof data.listVisible !== "boolean") updates.listVisible = true;
    if (typeof data.docked !== "boolean") updates.docked = true; // default docked per request
    if (typeof data.dockWidth !== "number") updates.dockWidth = DEFAULT_DOCK_W;
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  }

  function clampToViewport(el, margin = 12) {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(margin, vw - rect.width - margin);
    const maxTop  = Math.max(margin, vh - rect.height - margin);
    const left = Math.min(Math.max(margin, rect.left), maxLeft);
    const top  = Math.min(Math.max(margin, rect.top),  maxTop);
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function createToggle() {
    let toggle = document.getElementById("edge-eng-toggle");
    if (toggle) return toggle;
    toggle = document.createElement("div");
    toggle.id = "edge-eng-toggle";
    toggle.title = "Toggle English Note (Alt+N)";
    toggle.textContent = "EN";
    toggle.addEventListener("click", toggleNote);
    document.documentElement.appendChild(toggle);
    return toggle;
  }

  function createDockResizer() {
    let rz = document.getElementById("edge-eng-dock-resizer");
    if (rz) return rz;
    rz = document.createElement("div");
    rz.id = "edge-eng-dock-resizer";
    document.documentElement.appendChild(rz);
    return rz;
  }

  function createNote() {
    let note = document.getElementById("edge-eng-note");
    if (note) return note;
    note = document.createElement("div");
    note.id = "edge-eng-note";
    note.innerHTML = `
      <div class="note-header" id="edge-eng-drag">
        <div class="title">English ↔ Vietnamese</div>
        <div class="pill" id="edge-eng-count">0 / 0</div>
      </div>
      <div class="note-body">
        <div id="edge-eng-editor">
          <div class="row">
            <input type="text" id="edge-eng-en" placeholder="English">
            <button id="edge-eng-prev" title="Previous">◀</button>
          </div>
          <div class="row" style="margin-top:6px;">
            <input type="text" id="edge-eng-vi" placeholder="Vietnamese">
            <button id="edge-eng-next" title="Next">▶</button>
          </div>
        </div>

        <div id="edge-eng-list-panel">
          <input type="text" id="edge-eng-list-search" placeholder="Search... (EN/VI)">
          <div id="edge-eng-list"></div>
        </div>

        <div class="controls">
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <button id="edge-eng-add">Add</button>
            <button id="edge-eng-save">Save</button>
            <button id="edge-eng-del">Delete</button>
            <button id="edge-eng-shuffle" title="Random word">Shuffle</button>
            <button id="edge-eng-toggle-list" title="List view">List</button>
            <button id="edge-eng-toggle-dock" title="Dock/Float">Dock</button>
            <button id="edge-eng-import">Import</button>
            <button id="edge-eng-export">Export</button>
            <input type="file" id="edge-eng-file" accept="application/json" style="display:none;" />
          </div>
          <div class="muted" id="edge-eng-status"></div>
        </div>
      </div>
      <div class="edge-eng-resize-handle edge-eng-handle-top"></div>
      <div class="edge-eng-resize-handle edge-eng-handle-bottom"></div>
      <div class="edge-eng-resize-handle edge-eng-handle-left"></div>
      <div class="edge-eng-resize-handle edge-eng-handle-right"></div>
    `;
    document.documentElement.appendChild(note);
    wireUp(note);
    return note;
  }

  function makeDraggable(el, handle) {
    let offsetX = 0, offsetY = 0, startX = 0, startY = 0, moving = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target && (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT")) return;
      moving = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      offsetX = startX - rect.left;
      offsetY = startY - rect.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!moving) return;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const M = 12;
      const rawLeft = e.clientX - offsetX;
      const rawTop  = e.clientY - offsetY;
      const left = Math.min(Math.max(M, rawLeft), Math.max(M, vw - w - M));
      const top  = Math.min(Math.max(M, rawTop),  Math.max(M, vh - h - M));
      el.style.left = left + "px";
      el.style.top  = top  + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });
    window.addEventListener("mouseup", async () => {
      if (!moving) return;
      moving = false;
      const rect = el.getBoundingClientRect();
      await chrome.storage.local.set({ notePosition: { left: rect.left, top: rect.top } });
    });
  }

  // Custom overlay edge resizers
  function addEdgeResize(el) {
    const handles = {
      top: el.querySelector(".edge-eng-handle-top"),
      bottom: el.querySelector(".edge-eng-handle-bottom"),
      left: el.querySelector(".edge-eng-handle-left"),
      right: el.querySelector(".edge-eng-handle-right"),
    };
    const state = { resizing: false, edge: null, startX: 0, startY: 0, startRect: null };
    function onDown(edge) {
      return (e) => {
        state.resizing = true; state.edge = edge;
        state.startX = e.clientX; state.startY = e.clientY;
        state.startRect = el.getBoundingClientRect();
        e.preventDefault();
      };
    }
    function onMove(e) {
      if (!state.resizing) return;
      let w = state.startRect.width, h = state.startRect.height;
      let left = state.startRect.left, top = state.startRect.top;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (state.edge === "right") w = Math.max(MIN_W, Math.round(state.startRect.width + dx));
      if (state.edge === "left") { w = Math.max(MIN_W, Math.round(state.startRect.width - dx)); left = state.startRect.left + dx; }
      if (state.edge === "bottom") h = Math.max(MIN_H, Math.round(state.startRect.height + dy));
      if (state.edge === "top") { h = Math.max(MIN_H, Math.round(state.startRect.height - dy)); top = state.startRect.top + dy; }
      el.style.width = w + "px";
      el.style.height = h + "px";
      el.style.left = Math.max(12, left) + "px";
      el.style.top  = Math.max(12, top) + "px";
    }
    function onUp() {
      if (!state.resizing) return;
      state.resizing = false;
      const rect = el.getBoundingClientRect();
      chrome.storage.local.set({
        noteSize: { width: Math.round(rect.width), height: Math.round(rect.height) },
        notePosition: { left: rect.left, top: rect.top }
      });
    }
    handles.top.addEventListener("mousedown", onDown("top"));
    handles.bottom.addEventListener("mousedown", onDown("bottom"));
    handles.left.addEventListener("mousedown", onDown("left"));
    handles.right.addEventListener("mousedown", onDown("right"));
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  let sizeObserver = null;
  let lastSaved = null;
  function observeSize(el) {
    if (sizeObserver) sizeObserver.disconnect();
    sizeObserver = new ResizeObserver(async (entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        const w = Math.max(MIN_W, Math.round(cr.width));
        const h = Math.max(MIN_H, Math.round(cr.height));
        const cur = { width: w, height: h };
        if (!lastSaved || Math.abs(cur.width - lastSaved.width) >= SIZE_EPS || Math.abs(cur.height - lastSaved.height) >= SIZE_EPS) {
          lastSaved = cur;
          await chrome.storage.local.set({ noteSize: cur });
          clampToViewport(el, 12);
        }
      }
    });
    sizeObserver.observe(el);
  }

  async function getState() {
    const data = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
    return {
      vocab: Array.isArray(data.vocab) ? data.vocab : [],
      currentIndex: Number.isInteger(data.currentIndex) ? data.currentIndex : 0,
      noteVisible: typeof data.noteVisible === "boolean" ? data.noteVisible : true,
      notePosition: data.notePosition || null,
      noteSize: data.noteSize || null,
      listVisible: typeof data.listVisible === "boolean" ? data.listVisible : true,
      docked: typeof data.docked === "boolean" ? data.docked : true,
      dockWidth: typeof data.dockWidth === "number" ? data.dockWidth : DEFAULT_DOCK_W,
    };
  }
  async function setState(p){ await chrome.storage.local.set(p); }

  function renderList(listEl, items, currentIdx, onPick) {
    listEl.innerHTML = "";
    items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "edge-eng-item" + (idx === currentIdx ? " active" : "");
      const left = document.createElement("div");
      left.className = "edge-eng-en";
      left.textContent = item.en || "(empty)";
      const right = document.createElement("div");
      right.className = "edge-eng-vi";
      right.textContent = item.vi || "";
      row.appendChild(left);
      row.appendChild(right);
      row.addEventListener("click", () => onPick(idx));
      listEl.appendChild(row);
    });
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "edge-eng-item";
      empty.textContent = "No items";
      listEl.appendChild(empty);
    }
  }

  async function render() {
    const { vocab, currentIndex, noteVisible, listVisible, docked, dockWidth } = await getState();
    const note = createNote();
    createToggle();
    const dockResizer = createDockResizer();

    const en = note.querySelector("#edge-eng-en");
    const vi = note.querySelector("#edge-eng-vi");
    const count = note.querySelector("#edge-eng-count");
    const editorPanel = note.querySelector("#edge-eng-editor");
    const listPanel = note.querySelector("#edge-eng-list-panel");
    const listBox = note.querySelector("#edge-eng-list");
    const search = note.querySelector("#edge-eng-list-search");
    const toggleDockBtn = note.querySelector("#edge-eng-toggle-dock");

    note.classList.toggle("visible", noteVisible);
    note.classList.toggle("docked", docked);
    note.classList.toggle("floating", !docked);
    dockResizer.style.display = (noteVisible && docked) ? "block" : "none";

    if (listPanel) listPanel.classList.toggle("visible", listVisible);
    if (editorPanel) editorPanel.style.display = listVisible ? "none" : "block";

    let idx = Math.min(Math.max(0, currentIndex), Math.max(0, vocab.length - 1));
    if (vocab.length === 0) {
      if (en) en.value = "";
      if (vi) vi.value = "";
      if (count) count.textContent = `0 / 0`;
    } else {
      if (en) en.value = vocab[idx]?.en ?? "";
      if (vi) vi.value = vocab[idx]?.vi ?? "";
      if (count) count.textContent = `${idx + 1} / ${vocab.length}`;
    }

    if (docked) {
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const maxW = Math.round(vw * DOCK_MAX_W_RATIO);
      const dw = Math.min(Math.max(DOCK_MIN_W, dockWidth || DEFAULT_DOCK_W), maxW);
      note.style.width = dw + "px";
      note.style.left = "auto";
      note.style.top = "0px";
      note.style.bottom = "0px";
      note.style.right = "0px";
      // Push page content by adding margin-right
      document.documentElement.style.setProperty("--dock-width", dw + "px");
      dockResizer.style.right = "calc(" + dw + "px)";
      dockResizer.style.setProperty("--dock-width", dw + "px");
      document.documentElement.style.marginRight = dw + "px";
      document.body.style.marginRight = dw + "px";
    } else {
      // Overlay position & size
      const data = await chrome.storage.local.get(["notePosition","noteSize"]);
      const size = data.noteSize || { width: 380, height: 320 };
      const w = Math.max(MIN_W, size.width || 380);
      const h = Math.max(MIN_H, size.height || 320);
      note.style.width = w + "px";
      note.style.height = h + "px";
      if (data.notePosition) {
        note.style.left = Math.max(12, data.notePosition.left) + "px";
        note.style.top  = Math.max(12, data.notePosition.top)  + "px";
        note.style.right = "auto";
        note.style.bottom = "auto";
      }
      clampToViewport(note, 12);
      // Remove page margin
      document.documentElement.style.marginRight = "";
      document.body.style.marginRight = "";
    }

    // List render
    if (listBox) {
      const q = (search && search.value ? search.value : "").trim().toLowerCase();
      const items = q
        ? vocab.filter(v => (v.en||"").toLowerCase().includes(q) || (v.vi||"").toLowerCase().includes(q))
        : vocab.slice();
      let filteredIdx = -1;
      if (items.length && vocab.length) {
        const currentItem = vocab[idx];
        filteredIdx = items.findIndex(it => it === currentItem);
      }
      renderList(listBox, items, filteredIdx, async (pickIdx) => {
        const pickedItem = items[pickIdx];
        const originalIdx = vocab.indexOf(pickedItem);
        await setState({ currentIndex: Math.max(0, originalIdx) });
        render();
      });
      if (search && !search._bound) {
        search._bound = true;
        search.addEventListener("input", () => render());
      }
      const active = listBox.querySelector(".edge-eng-item.active");
      if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
    }

    // Update dock toggle label
    toggleDockBtn.textContent = docked ? "Float" : "Dock";
  }

  function wireUp(note) {
    const dragHandle = note.querySelector("#edge-eng-drag");
    makeDraggable(note, dragHandle);
    observeSize(note);
    addEdgeResize(note);

    const en = note.querySelector("#edge-eng-en");
    const vi = note.querySelector("#edge-eng-vi");
    const prevBtn = note.querySelector("#edge-eng-prev");
    const nextBtn = note.querySelector("#edge-eng-next");
    const addBtn = note.querySelector("#edge-eng-add");
    const saveBtn = note.querySelector("#edge-eng-save");
    const delBtn = note.querySelector("#edge-eng-del");
    const shuffleBtn = note.querySelector("#edge-eng-shuffle");
    const status = note.querySelector("#edge-eng-status");
    const toggleListBtn = note.querySelector("#edge-eng-toggle-list");
    const toggleDockBtn = note.querySelector("#edge-eng-toggle-dock");
    const importBtn = note.querySelector("#edge-eng-import");
    const exportBtn = note.querySelector("#edge-eng-export");
    const fileInput = note.querySelector("#edge-eng-file");
    const dockResizer = createDockResizer();

    prevBtn.addEventListener("click", async () => {
      const s = await getState();
      const n = Math.max(0, (s.currentIndex || 0) - 1);
      await setState({ currentIndex: n });
      render();
    });

    nextBtn.addEventListener("click", async () => {
      const s = await getState();
      const n = Math.min(Math.max(0, s.vocab.length - 1), (s.currentIndex || 0) + 1);
      await setState({ currentIndex: n });
      render();
    });

    shuffleBtn.addEventListener("click", async () => {
      const s = await getState();
      if (s.vocab.length === 0) return;
      const n = Math.floor(Math.random() * s.vocab.length);
      await setState({ currentIndex: n });
      render();
    });

    addBtn.addEventListener("click", async () => {
      const s = await getState();
      const newItem = { en: (en.value||"").trim(), vi: (vi.value||"").trim() };
      if (!newItem.en) { status.textContent = "Type an English word first."; return; }
      const vocab = s.vocab.concat([newItem]);
      const idx = vocab.length - 1;
      await setState({ vocab, currentIndex: idx });
      status.textContent = "Added ✓";
      render();
      setTimeout(()=> status.textContent="", 1200);
    });

    saveBtn.addEventListener("click", async () => {
      const s = await getState();
      if (s.vocab.length === 0) {
        const newItem = { en: (en.value||"").trim(), vi: (vi.value||"").trim() };
        if (!newItem.en) return;
        await setState({ vocab: [newItem], currentIndex: 0 });
      } else {
        const idx = Math.min(Math.max(0, s.currentIndex), s.vocab.length - 1);
        s.vocab[idx] = { en: (en.value||"").trim(), vi: (vi.value||"").trim() };
        await setState({ vocab: s.vocab });
      }
      status.textContent = "Saved ✓";
      render();
      setTimeout(()=> status.textContent="", 1200);
    });

    delBtn.addEventListener("click", async () => {
      const s = await getState();
      if (s.vocab.length === 0) return;
      const idx = Math.min(Math.max(0, s.currentIndex), s.vocab.length - 1);
      const vocab = s.vocab.slice(0, idx).concat(s.vocab.slice(idx+1));
      const n = Math.max(0, Math.min(idx, vocab.length - 1));
      await setState({ vocab, currentIndex: n });
      status.textContent = "Deleted ✓";
      render();
      setTimeout(()=> status.textContent="", 1200);
    });

    toggleListBtn.addEventListener("click", async () => {
      const s = await getState();
      await setState({ listVisible: !s.listVisible });
      render();
    });

    toggleDockBtn.addEventListener("click", async () => {
      const s = await getState();
      await setState({ docked: !s.docked });
      render();
    });

    importBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error("JSON must be an array");
        await setState({ vocab: parsed });
        status.textContent = "Imported ✓";
        render();
      } catch (err) {
        status.textContent = "Invalid JSON";
      } finally {
        e.target.value = "";
      }
    });

    exportBtn.addEventListener("click", async () => {
      const s = await getState();
      const blob = new Blob([JSON.stringify(s.vocab, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "english_vocab.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    // Dock resizer drag
    (function setupDockResizer() {
      let resizing = false, startX = 0, startW = 0;
      dockResizer.addEventListener("mousedown", async (e) => {
        const s = await getState();
        if (!s.docked) return;
        resizing = true; startX = e.clientX; startW = s.dockWidth || DEFAULT_DOCK_W;
        e.preventDefault();
      });
      window.addEventListener("mousemove", async (e) => {
        if (!resizing) return;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const maxW = Math.round(vw * DOCK_MAX_W_RATIO);
        const dx = startX - e.clientX; // dragging left increases width
        let w = Math.round(startW + dx);
        w = Math.min(Math.max(DOCK_MIN_W, w), maxW);
        document.getElementById("edge-eng-note").style.width = w + "px";
        document.getElementById("edge-eng-dock-resizer").style.right = "calc(" + w + "px)";
        document.documentElement.style.marginRight = w + "px";
        document.body.style.marginRight = w + "px";
      });
      window.addEventListener("mouseup", async (e) => {
        if (!resizing) return;
        resizing = false;
        const el = document.getElementById("edge-eng-note");
        if (el) {
          const w = Math.round(el.getBoundingClientRect().width);
          await setState({ dockWidth: w });
        }
      });
    })();
  }

  async function toggleNote() {
    const s = await getState();
    await chrome.storage.local.set({ noteVisible: !s.noteVisible });
    render();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "TOGGLE_NOTE_REQUEST") toggleNote();
    else if (msg?.type === "VOCAB_UPDATED") render();
  });

  ensureDefaults().then(() => {
    createToggle();
    createNote();
    window.addEventListener("resize", () => {
      const el = document.getElementById("edge-eng-note");
      if (el && !el.classList.contains("docked")) clampToViewport(el, 12);
      if (el && el.classList.contains("docked")) {
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const maxW = Math.round(vw * DOCK_MAX_W_RATIO);
        chrome.storage.local.get(["dockWidth"]).then(({dockWidth}) => {
          const w = Math.min(Math.max(DOCK_MIN_W, dockWidth || DEFAULT_DOCK_W), maxW);
          el.style.width = w + "px";
          document.documentElement.style.marginRight = w + "px";
          document.body.style.marginRight = w + "px";
          const rz = document.getElementById("edge-eng-dock-resizer");
          if (rz) rz.style.right = "calc(" + w + "px)";
        });
      }
    });
    render();
  });
})();
