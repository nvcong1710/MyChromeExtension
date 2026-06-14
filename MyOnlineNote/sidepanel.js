(function () {
  "use strict";

  const STORE_KEY = "monNotesV2";

  // ---------- State ----------
  // nodes: { [id]: { id, title, content, parentId, childIds:[], collapsed } }
  let state = { nodes: {}, rootIds: [], activeId: null };
  let writingLocally = false; // ignore our own storage.onChanged echoes

  // Slash commands available in the editor (Notion-style "/").
  // snippet may be a string or a function returning a string (for dynamic
  // values like the current date). caret = caret offset within the snippet
  // (default: end). selectLen = how many chars to select from the caret.
  const SLASH_COMMANDS = [
    { keys: ["h1", "tieude1", "#"], key: "#", label: "Tiêu đề 1", hint: "Tiêu đề lớn", snippet: "# ", caret: 2 },
    { keys: ["h2", "tieude2", "##"], key: "##", label: "Tiêu đề 2", hint: "Tiêu đề vừa", snippet: "## ", caret: 3 },
    { keys: ["h3", "tieude3", "###"], key: "###", label: "Tiêu đề 3", hint: "Tiêu đề nhỏ", snippet: "### ", caret: 4 },
    { keys: ["todo", "check", "checkbox", "viec"], key: "☐", label: "Việc cần làm", hint: "- [ ] checkbox", snippet: "- [ ] ", caret: 6 },
    { keys: ["bullet", "list", "ul", "danhsach"], key: "•", label: "Danh sách", hint: "- gạch đầu dòng", snippet: "- ", caret: 2 },
    { keys: ["number", "ol", "danhsachso"], key: "1.", label: "Danh sách số", hint: "1. đánh số", snippet: "1. ", caret: 3 },
    { keys: ["quote", "trichdan"], key: "❝", label: "Trích dẫn", hint: "> blockquote", snippet: "> ", caret: 2 },
    { keys: ["code", "codeblock"], key: "</>", label: "Khối code", hint: "``` code ```", snippet: "```\n\n```\n", caret: 4 },
    { keys: ["table", "bang"], key: "▦", label: "Bảng", hint: "bảng Markdown 2×2", snippet: "| Cột 1 | Cột 2 |\n| --- | --- |\n| A | B |\n", caret: 2, selectLen: 5 },
    { keys: ["divider", "hr", "duongke"], key: "―", label: "Đường kẻ", hint: "--- ngăn cách", snippet: "---\n", caret: 4 },
    { keys: ["page", "trang", "mention", "wiki"], key: "[[", label: "Liên kết trang", hint: "[[chọn trang khác]]", snippet: "[[", caret: 2 },
    { keys: ["link", "url", "lienket"], key: "↗", label: "Liên kết web", hint: "[chữ](địa-chỉ)", snippet: "[text](url)", caret: 1, selectLen: 4 },
    { keys: ["image", "img", "anh", "hinh"], key: "▣", label: "Hình ảnh", hint: "![mô tả](địa-chỉ)", snippet: "![alt](url)", caret: 2, selectLen: 3 },
    { keys: ["bold", "dam"], key: "B", label: "Chữ đậm", hint: "**đậm**", snippet: "****", caret: 2 },
    { keys: ["italic", "nghieng"], key: "I", label: "Chữ nghiêng", hint: "*nghiêng*", snippet: "**", caret: 1 },
    { keys: ["strike", "gachngang", "del"], key: "~", label: "Gạch ngang chữ", hint: "~~chữ~~", snippet: "~~~~", caret: 2 },
    { keys: ["icode", "inlinecode", "ma"], key: "`", label: "Code trong dòng", hint: "`code`", snippet: "``", caret: 1 },
    { keys: ["date", "ngay", "today", "homnay"], key: "D", label: "Ngày hôm nay", hint: "vd 2026-06-14", snippet: () => todayStr() + " " },
    { keys: ["time", "gio", "now"], key: "T", label: "Giờ hiện tại", hint: "vd 14:30", snippet: () => timeStr() + " " },
    { keys: ["datetime", "ngaygio", "timestamp"], key: "DT", label: "Ngày & giờ", hint: "vd 2026-06-14 14:30", snippet: () => nowStr() + " " },
  ];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const treeEl = $("tree");
  const emptyTreeEl = $("emptyTree");
  const editorPane = $("editorPane");
  const welcomeEl = $("welcome");
  const titleInput = $("titleInput");
  const contentArea = $("contentArea");
  const previewArea = $("previewArea");
  const editorBody = $("editorBody");
  const backlinksEl = $("backlinks");
  const breadcrumbEl = $("breadcrumb");
  const saveStatus = $("saveStatus");
  const searchInput = $("searchInput");
  const slashMenu = $("slashMenu");
  const ctxMenu = $("ctxMenu");
  const sidebar = $("sidebar");
  const scrim = $("scrim");
  const menuBtn = $("menuBtn");
  const themeBtn = $("themeBtn");
  const moreBtn = $("moreBtn");
  const moreMenu = $("moreMenu");

  // ---------- Persistence ----------
  async function load() {
    const data = await chrome.storage.local.get([STORE_KEY, "noteText"]);
    if (data[STORE_KEY] && data[STORE_KEY].nodes) {
      state = data[STORE_KEY];
    } else if (typeof data.noteText === "string" && data.noteText.trim()) {
      // Migrate the old single-note extension into a first page.
      const id = uid();
      state = {
        nodes: {
          [id]: blankNode(id, "Ghi chú cũ", data.noteText),
        },
        rootIds: [id],
        activeId: id,
      };
      await save();
    }
    if (!state.nodes) state = { nodes: {}, rootIds: [], activeId: null };
  }

  let saveTimer = null;
  function scheduleSave(showStatus) {
    if (showStatus) setStatus("Đang lưu…");
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await save();
      if (showStatus) setStatus("Đã lưu ✓");
    }, 300);
  }
  async function save() {
    writingLocally = true;
    await chrome.storage.local.set({ [STORE_KEY]: state });
    // release the flag after the change event has had a chance to fire
    setTimeout(() => (writingLocally = false), 50);
  }
  function setStatus(text) {
    saveStatus.textContent = text;
  }

  // ---------- Helpers ----------
  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function timeStr() {
    const d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function nowStr() {
    return todayStr() + " " + timeStr();
  }
  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      "n" + Date.now() + Math.floor(Math.random() * 1e6);
  }
  function blankNode(id, title, content) {
    return {
      id,
      title: title || "",
      content: content || "",
      parentId: null,
      childIds: [],
      collapsed: false,
    };
  }
  function parentListOf(node) {
    return node.parentId ? state.nodes[node.parentId].childIds : state.rootIds;
  }
  function isDescendant(ancestorId, nodeId) {
    let cur = state.nodes[nodeId];
    while (cur && cur.parentId) {
      if (cur.parentId === ancestorId) return true;
      cur = state.nodes[cur.parentId];
    }
    return false;
  }
  function ancestorsOf(id) {
    const chain = [];
    let cur = state.nodes[id];
    while (cur && cur.parentId) {
      cur = state.nodes[cur.parentId];
      if (cur) chain.unshift(cur);
    }
    return chain;
  }

  // ---------- Node operations ----------
  function createNode(parentId) {
    const id = uid();
    const node = blankNode(id, "");
    node.parentId = parentId || null;
    state.nodes[id] = node;
    if (parentId) {
      state.nodes[parentId].childIds.push(id);
      state.nodes[parentId].collapsed = false;
    } else {
      state.rootIds.push(id);
    }
    state.activeId = id;
    scheduleSave();
    renderTree();
    openEditor(id);
    closeDrawer();
    titleInput.focus();
  }

  function deleteNode(id) {
    const node = state.nodes[id];
    if (!node) return;
    const count = countDescendants(id) + 1;
    const msg =
      count > 1
        ? `Xoá trang này và ${count - 1} trang con? Không thể hoàn tác.`
        : "Xoá trang này? Không thể hoàn tác.";
    if (!confirm(msg)) return;

    const list = parentListOf(node);
    const idx = list.indexOf(id);
    if (idx > -1) list.splice(idx, 1);
    removeRecursive(id);

    if (state.activeId === id || !state.nodes[state.activeId]) {
      state.activeId = state.rootIds[0] || null;
    }
    scheduleSave();
    renderTree();
    if (state.activeId) openEditor(state.activeId);
    else showWelcome();
  }
  function removeRecursive(id) {
    const node = state.nodes[id];
    if (!node) return;
    node.childIds.slice().forEach(removeRecursive);
    delete state.nodes[id];
  }
  function countDescendants(id) {
    const node = state.nodes[id];
    if (!node) return 0;
    return node.childIds.reduce((s, c) => s + 1 + countDescendants(c), 0);
  }

  function moveNode(dragId, targetId, position) {
    if (dragId === targetId) return;
    if (isDescendant(dragId, targetId)) return; // can't drop into own subtree
    const drag = state.nodes[dragId];
    const target = state.nodes[targetId];
    if (!drag || !target) return;

    // detach
    const fromList = parentListOf(drag);
    fromList.splice(fromList.indexOf(dragId), 1);

    if (position === "into") {
      drag.parentId = targetId;
      target.childIds.push(dragId);
      target.collapsed = false;
    } else {
      drag.parentId = target.parentId;
      const toList = parentListOf(drag);
      let idx = toList.indexOf(targetId);
      if (position === "after") idx += 1;
      toList.splice(idx, 0, dragId);
    }
    scheduleSave();
    renderTree();
  }

  // ---------- Tree rendering ----------
  function renderTree() {
    treeEl.innerHTML = "";
    const hasNodes = state.rootIds.length > 0;
    emptyTreeEl.hidden = hasNodes;

    const query = searchInput.value.trim().toLowerCase();
    let visible = null;
    if (query) {
      visible = new Set();
      for (const id in state.nodes) {
        if ((state.nodes[id].title || "").toLowerCase().includes(query)) {
          visible.add(id);
          ancestorsOf(id).forEach((a) => visible.add(a.id));
        }
      }
    }

    state.rootIds.forEach((id) => {
      const el = renderNode(id, 0, visible, query);
      if (el) treeEl.appendChild(el);
    });
  }

  function renderNode(id, depth, visible, query) {
    const node = state.nodes[id];
    if (!node) return null;
    if (visible && !visible.has(id)) return null;

    const wrap = document.createElement("div");
    wrap.className = "node";

    const row = document.createElement("div");
    row.className = "node-row" + (id === state.activeId ? " active" : "");
    row.style.paddingLeft = 6 + depth * 14 + "px";
    row.draggable = true;
    row.dataset.id = id;

    const hasChildren = node.childIds.length > 0;
    const expanded = query ? true : !node.collapsed;

    const twisty = document.createElement("span");
    twisty.className = "twisty" + (hasChildren ? "" : " leaf") + (expanded ? "" : " collapsed");
    twisty.textContent = "▾";
    twisty.addEventListener("click", (e) => {
      e.stopPropagation();
      node.collapsed = !node.collapsed;
      scheduleSave();
      renderTree();
    });

    const title = document.createElement("span");
    title.className = "node-title";
    title.textContent = node.title || "Trang không tên";

    const add = document.createElement("span");
    add.className = "node-add";
    add.textContent = "＋";
    add.title = "Thêm trang con";
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      createNode(id);
    });

    row.append(twisty, title, add);
    row.addEventListener("click", () => {
      state.activeId = id;
      scheduleSave();
      renderTree();
      openEditor(id);
      closeDrawer();
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(e, id);
    });
    wireDnd(row, id);

    wrap.appendChild(row);

    if (hasChildren) {
      const childrenEl = document.createElement("div");
      childrenEl.className = "children" + (expanded ? "" : " collapsed");
      node.childIds.forEach((cid) => {
        const childEl = renderNode(cid, depth + 1, visible, query);
        if (childEl) childrenEl.appendChild(childEl);
      });
      wrap.appendChild(childrenEl);
    }
    return wrap;
  }

  // ---------- Drag & drop ----------
  let dragId = null;
  function wireDnd(row, id) {
    row.addEventListener("dragstart", (e) => {
      dragId = id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    });
    row.addEventListener("dragend", () => {
      dragId = null;
      clearDropMarks();
    });
    row.addEventListener("dragover", (e) => {
      if (!dragId || dragId === id) return;
      e.preventDefault();
      clearDropMarks();
      row.classList.add("drop-" + zoneFor(e, row));
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after", "drop-into"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const pos = zoneFor(e, row);
      clearDropMarks();
      if (dragId) moveNode(dragId, id, pos);
    });
  }
  function zoneFor(e, row) {
    const r = row.getBoundingClientRect();
    const y = e.clientY - r.top;
    if (y < r.height * 0.28) return "before";
    if (y > r.height * 0.72) return "after";
    return "into";
  }
  function clearDropMarks() {
    treeEl.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach((el) =>
      el.classList.remove("drop-before", "drop-after", "drop-into")
    );
  }

  // ---------- Editor ----------
  function openEditor(id) {
    const node = state.nodes[id];
    if (!node) return showWelcome();
    welcomeEl.hidden = true;
    editorPane.hidden = false;
    titleInput.value = node.title;
    contentArea.value = node.content;
    renderBreadcrumb(node);
    renderPreview();
    renderBacklinks(node);
    setStatus("");
  }
  function navigateTo(id) {
    if (!state.nodes[id]) return;
    state.activeId = id;
    scheduleSave();
    renderTree();
    openEditor(id);
    closeDrawer();
  }
  function findPageByTitle(title) {
    const t = (title || "").trim().toLowerCase();
    if (!t) return null;
    return Object.values(state.nodes).find((n) => (n.title || "").trim().toLowerCase() === t) || null;
  }
  function showWelcome() {
    editorPane.hidden = true;
    welcomeEl.hidden = false;
  }
  function renderBreadcrumb(node) {
    // Only the parent path — the current page is already shown as the big title.
    breadcrumbEl.innerHTML = "";
    const chain = ancestorsOf(node.id);
    chain.forEach((a, i) => {
      const c = document.createElement("span");
      c.className = "crumb";
      c.textContent = a.title || "Trang không tên";
      c.addEventListener("click", () => {
        state.activeId = a.id;
        scheduleSave();
        renderTree();
        openEditor(a.id);
      });
      breadcrumbEl.append(c);
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      breadcrumbEl.append(sep);
    });
  }
  function renderPreview() {
    previewArea.innerHTML = window.MiniMarkdown.render(contentArea.value);
    // Wire up [[wiki links]]: mark unresolved ones, navigate on click.
    previewArea.querySelectorAll("a.wikilink").forEach((a) => {
      const title = a.dataset.wikilink || a.textContent;
      if (!findPageByTitle(title)) a.classList.add("missing");
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = findPageByTitle(title);
        if (target) return navigateTo(target.id);
        // Missing link → create the page, then go to it.
        const id = uid();
        state.nodes[id] = blankNode(id, title.trim());
        state.rootIds.push(id);
        scheduleSave();
        navigateTo(id);
      });
    });
  }

  // Pages whose content references [[this page's title]].
  function renderBacklinks(node) {
    const title = (node.title || "").trim().toLowerCase();
    const linkers = title
      ? Object.values(state.nodes).filter((n) => {
          if (n.id === node.id) return false;
          const re = /\[\[([^\]\n]+)\]\]/g;
          let m;
          while ((m = re.exec(n.content || ""))) {
            if (m[1].trim().toLowerCase() === title) return true;
          }
          return false;
        })
      : [];
    backlinksEl.innerHTML = "";
    if (!linkers.length) {
      backlinksEl.hidden = true;
      return;
    }
    backlinksEl.hidden = false;
    const label = document.createElement("div");
    label.className = "backlinks-label";
    label.textContent = "↩ Được liên kết từ " + linkers.length + " trang";
    backlinksEl.appendChild(label);
    const chips = document.createElement("div");
    chips.className = "backlinks-chips";
    linkers.forEach((n) => {
      const chip = document.createElement("button");
      chip.className = "backlink-chip";
      chip.textContent = n.title || "Trang không tên";
      chip.addEventListener("click", () => navigateTo(n.id));
      chips.appendChild(chip);
    });
    backlinksEl.appendChild(chips);
  }

  function activeNode() {
    return state.nodes[state.activeId];
  }

  titleInput.addEventListener("input", () => {
    const node = activeNode();
    if (!node) return;
    node.title = titleInput.value;
    // update tree label + breadcrumb without full rebuild flicker
    const row = treeEl.querySelector('.node-row[data-id="' + node.id + '"] .node-title');
    if (row) row.textContent = node.title || "Trang không tên";
    renderBreadcrumb(node);
    renderBacklinks(node);
    scheduleSave(true);
  });
  contentArea.addEventListener("input", () => {
    const node = activeNode();
    if (!node) return;
    node.content = contentArea.value;
    if (editorBody.dataset.mode !== "write") renderPreview();
    scheduleSave(true);
    updateAutocomplete();
  });
  contentArea.addEventListener("keydown", (e) => {
    // Autocomplete navigation takes priority while the menu is open.
    if (acAt >= 0 && !slashMenu.hidden) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAc();
        return;
      }
      if (acItems.length) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          acIndex = (acIndex + 1) % acItems.length;
          highlightAc();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          acIndex = (acIndex - 1 + acItems.length) % acItems.length;
          highlightAc();
          return;
        }
        if ((e.key === "Enter" || e.key === "Tab") && acItems[acIndex]) {
          e.preventDefault();
          acItems[acIndex].apply();
          return;
        }
      }
    }
    // Tab key inserts spaces instead of leaving the textarea.
    if (e.key === "Tab") {
      e.preventDefault();
      const s = contentArea.selectionStart;
      const en = contentArea.selectionEnd;
      contentArea.value = contentArea.value.slice(0, s) + "  " + contentArea.value.slice(en);
      contentArea.selectionStart = contentArea.selectionEnd = s + 2;
      contentArea.dispatchEvent(new Event("input"));
    }
  });
  // Caret moved by mouse or arrows: re-evaluate / close the menu.
  contentArea.addEventListener("click", updateAutocomplete);
  contentArea.addEventListener("keyup", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) updateAutocomplete();
  });
  contentArea.addEventListener("blur", () => setTimeout(closeAc, 150));

  // mode toggle
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      editorBody.dataset.mode = btn.dataset.mode;
      if (btn.dataset.mode !== "write") renderPreview();
    });
  });

  // ---------- Autocomplete: "/" commands and "[[" page links ----------
  // acAt = index of the trigger char in the textarea, or -1 when closed.
  // Each item in acItems: { key, label, hint, apply() }.
  let acAt = -1;
  let acItems = [];
  let acIndex = 0;

  // "/query" where "/" is at line start or after a space. Returns index or -1.
  function detectSlash() {
    const pos = contentArea.selectionStart;
    if (pos !== contentArea.selectionEnd) return -1;
    const text = contentArea.value;
    let i = pos - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "/") {
        const before = i === 0 ? "" : text[i - 1];
        return before === "" || before === "\n" || before === " " ? i : -1;
      }
      if (ch === " " || ch === "\n") return -1;
      i--;
    }
    return -1;
  }

  // "[[query" still being typed. Returns { at, query } or null.
  function detectMention() {
    const pos = contentArea.selectionStart;
    if (pos !== contentArea.selectionEnd) return null;
    const text = contentArea.value;
    let i = pos - 1;
    while (i >= 1) {
      const ch = text[i];
      if (ch === "]" || ch === "\n") return null;
      if (ch === "[") {
        if (text[i - 1] === "[") return { at: i - 1, query: text.slice(i + 1, pos) };
        return null;
      }
      i--;
    }
    return null;
  }

  function updateAutocomplete() {
    const m = detectMention();
    if (m) return openMention(m);
    const s = detectSlash();
    if (s >= 0) return openSlash(s);
    closeAc();
  }

  function openSlash(at) {
    acAt = at;
    const query = contentArea.value.slice(at + 1, contentArea.selectionStart).toLowerCase();
    const cmds = query
      ? SLASH_COMMANDS.filter(
          (c) => c.keys.some((k) => k.startsWith(query)) || c.label.toLowerCase().includes(query)
        )
      : SLASH_COMMANDS.slice();
    acItems = cmds.map((c) => ({
      key: c.key,
      label: c.label,
      hint: c.hint,
      apply: () => applySlash(at, c),
    }));
    acIndex = 0;
    renderAcMenu("Không có lệnh khớp");
  }

  function openMention(m) {
    acAt = m.at;
    const q = m.query.trim().toLowerCase();
    const pages = Object.values(state.nodes)
      .filter((n) => n.id !== state.activeId && (n.title || "").toLowerCase().includes(q))
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
      .slice(0, 8);
    acItems = pages.map((p) => ({
      key: "↗",
      label: p.title || "Trang không tên",
      hint: "Liên kết tới trang",
      apply: () => applyMention(m, p.title || "Trang không tên"),
    }));
    const exact = Object.values(state.nodes).some((n) => (n.title || "").toLowerCase() === q);
    if (m.query.trim() && !exact) {
      acItems.push({
        key: "＋",
        label: `Tạo "${m.query.trim()}"`,
        hint: "Tạo trang mới rồi liên kết",
        apply: () => createAndLink(m),
      });
    }
    acIndex = 0;
    renderAcMenu("Không có trang khớp");
  }

  function renderAcMenu(emptyMsg) {
    slashMenu.innerHTML = "";
    if (!acItems.length) {
      const empty = document.createElement("div");
      empty.className = "slash-empty";
      empty.textContent = emptyMsg;
      slashMenu.appendChild(empty);
    } else {
      acItems.forEach((it, i) => {
        const item = document.createElement("div");
        item.className = "slash-item" + (i === acIndex ? " active" : "");
        const key = document.createElement("span");
        key.className = "slash-key";
        key.textContent = it.key;
        const text = document.createElement("span");
        text.className = "slash-text";
        const label = document.createElement("div");
        label.className = "slash-label";
        label.textContent = it.label;
        const hint = document.createElement("div");
        hint.className = "slash-hint";
        hint.textContent = it.hint;
        text.append(label, hint);
        item.append(key, text);
        item.addEventListener("mousedown", (e) => {
          e.preventDefault(); // keep textarea focus
          it.apply();
        });
        item.addEventListener("mouseenter", () => {
          acIndex = i;
          highlightAc();
        });
        slashMenu.appendChild(item);
      });
    }
    positionAcMenu();
    slashMenu.hidden = false;
  }

  function highlightAc() {
    [...slashMenu.children].forEach((el, i) => el.classList.toggle("active", i === acIndex));
  }

  function positionAcMenu() {
    const coords = caretCoordinates(contentArea, acAt);
    let y = coords.top + coords.height + 2;
    slashMenu.style.visibility = "hidden";
    slashMenu.hidden = false;
    const h = slashMenu.offsetHeight || 200;
    if (y + h > window.innerHeight) y = coords.top - h - 2;
    slashMenu.style.left = Math.min(coords.left, window.innerWidth - 250) + "px";
    slashMenu.style.top = Math.max(4, y) + "px";
    slashMenu.style.visibility = "visible";
  }

  function applySlash(at, cmd) {
    const end = contentArea.selectionStart;
    const v = contentArea.value;
    const snippet = typeof cmd.snippet === "function" ? cmd.snippet() : cmd.snippet;
    contentArea.value = v.slice(0, at) + snippet + v.slice(end);
    const caretRel = cmd.caret == null ? snippet.length : cmd.caret;
    const selStart = at + caretRel;
    contentArea.selectionStart = selStart;
    contentArea.selectionEnd = selStart + (cmd.selectLen || 0);
    closeAc();
    contentArea.focus();
    contentArea.dispatchEvent(new Event("input"));
  }

  function applyMention(m, title) {
    const end = contentArea.selectionStart;
    const v = contentArea.value;
    const snippet = "[[" + title + "]]";
    contentArea.value = v.slice(0, m.at) + snippet + v.slice(end);
    const caret = m.at + snippet.length;
    contentArea.selectionStart = contentArea.selectionEnd = caret;
    closeAc();
    contentArea.focus();
    contentArea.dispatchEvent(new Event("input"));
  }

  function createAndLink(m) {
    const title = m.query.trim();
    const id = uid();
    const node = blankNode(id, title);
    state.nodes[id] = node;
    state.rootIds.push(id);
    scheduleSave();
    renderTree();
    applyMention(m, title);
  }

  function closeAc() {
    acAt = -1;
    acItems = [];
    slashMenu.hidden = true;
  }

  // Mirror-div technique to find the pixel position of a character in a textarea.
  function caretCoordinates(el, index) {
    const div = document.createElement("div");
    const style = getComputedStyle(el);
    const props = [
      "boxSizing","width","paddingTop","paddingRight","paddingBottom","paddingLeft",
      "borderWidth","fontFamily","fontSize","fontWeight","lineHeight","letterSpacing",
      "textTransform","wordSpacing",
    ];
    props.forEach((p) => (div.style[p] = style[p]));
    div.style.position = "absolute";
    div.style.visibility = "hidden";
    div.style.whiteSpace = "pre-wrap";
    div.style.wordWrap = "break-word";
    div.style.overflow = "hidden";
    div.textContent = el.value.slice(0, index);
    const span = document.createElement("span");
    span.textContent = el.value.slice(index) || ".";
    div.appendChild(span);
    document.body.appendChild(div);
    const elRect = el.getBoundingClientRect();
    const top = elRect.top + (span.offsetTop - el.scrollTop);
    const left = elRect.left + (span.offsetLeft - el.scrollLeft);
    const height = parseInt(style.lineHeight) || parseInt(style.fontSize) * 1.5;
    document.body.removeChild(div);
    return { top, left, height };
  }

  // ---------- Context menu ----------
  function openContextMenu(e, id) {
    ctxMenu.innerHTML = "";
    const items = [
      { label: "Thêm trang con", fn: () => createNode(id) },
      { label: "Đổi tên", fn: () => { state.activeId = id; openEditor(id); renderTree(); titleInput.focus(); titleInput.select(); } },
      { label: "Xuất trang (.md)", fn: () => exportNode(id) },
      { sep: true },
      { label: "Xoá", danger: true, fn: () => deleteNode(id) },
    ];
    items.forEach((it) => {
      if (it.sep) {
        const s = document.createElement("div");
        s.className = "ctx-sep";
        ctxMenu.appendChild(s);
        return;
      }
      const b = document.createElement("button");
      if (it.danger) b.className = "danger";
      b.textContent = it.label;
      b.addEventListener("click", () => {
        ctxMenu.hidden = true;
        it.fn();
      });
      ctxMenu.appendChild(b);
    });
    ctxMenu.hidden = false;
    ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 190) + "px";
    ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 220) + "px";
  }

  // close popovers on outside click / escape
  document.addEventListener("click", (e) => {
    if (!ctxMenu.contains(e.target)) ctxMenu.hidden = true;
    if (!moreMenu.contains(e.target) && e.target !== moreBtn && !moreBtn.contains(e.target))
      moreMenu.hidden = true;
    if (!slashMenu.contains(e.target) && e.target !== contentArea) closeAc();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      ctxMenu.hidden = true;
      moreMenu.hidden = true;
      closeDrawer();
    }
  });

  // ---------- Export / Import ----------
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function safeName(s) {
    return (s || "untitled").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60).trim() || "untitled";
  }
  function nodeToMarkdown(id, depth) {
    const node = state.nodes[id];
    if (!node) return "";
    const heading = "#".repeat(Math.min(depth + 1, 6));
    let out = `${heading} ${node.title || "Trang không tên"}\n\n`;
    if (node.content.trim()) out += node.content.trim() + "\n\n";
    node.childIds.forEach((cid) => (out += nodeToMarkdown(cid, depth + 1)));
    return out;
  }
  function exportNode(id) {
    const node = state.nodes[id];
    download(safeName(node.title) + ".md", nodeToMarkdown(id, 0), "text/markdown;charset=utf-8");
  }
  function exportAll() {
    // Full backup as JSON (re-importable) — preserves the whole tree.
    download("my-notes-backup.json", JSON.stringify(state, null, 2), "application/json");
  }
  function triggerImport() {
    $("importFile").click();
  }
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    e.target.value = "";
    if (/\.json$/i.test(file.name)) {
      try {
        const data = JSON.parse(text);
        if (data && data.nodes && data.rootIds) {
          if (!confirm("Nhập sẽ thay thế toàn bộ ghi chú hiện tại. Tiếp tục?")) return;
          state = data;
          state.activeId = state.rootIds[0] || null;
          await save();
          renderTree();
          state.activeId ? openEditor(state.activeId) : showWelcome();
        } else throw new Error("bad");
      } catch {
        alert("File JSON không hợp lệ.");
      }
    } else {
      // Markdown / text -> create a new top-level page.
      const id = uid();
      const node = blankNode(id, file.name.replace(/\.(md|markdown|txt)$/i, ""), text);
      node.parentId = null;
      state.nodes[id] = node;
      state.rootIds.push(id);
      state.activeId = id;
      await save();
      renderTree();
      openEditor(id);
    }
  });

  // ---------- Drawer (tree show/hide on narrow panels) ----------
  function openDrawer() {
    sidebar.classList.add("open");
    scrim.hidden = false;
  }
  function closeDrawer() {
    sidebar.classList.remove("open");
    scrim.hidden = true;
  }
  function toggleDrawer() {
    sidebar.classList.contains("open") ? closeDrawer() : openDrawer();
  }
  menuBtn.addEventListener("click", toggleDrawer);
  scrim.addEventListener("click", closeDrawer);

  // ---------- Theme (Sáng / Tối / Hệ thống) ----------
  const THEME_KEY = "monTheme";
  const THEME_ORDER = ["system", "light", "dark"];
  const THEME_LABEL = { system: "Hệ thống", light: "Sáng", dark: "Tối" };
  const THEME_GLYPH = { system: "◐", light: "☀", dark: "🌙" };
  let themeSetting = "system";
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");

  function resolvedTheme() {
    return themeSetting === "system" ? (darkMq.matches ? "dark" : "light") : themeSetting;
  }
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", resolvedTheme());
    themeBtn.textContent = THEME_GLYPH[themeSetting];
    themeBtn.title = "Giao diện: " + THEME_LABEL[themeSetting] + " (bấm để đổi)";
  }
  async function setTheme(next) {
    themeSetting = next;
    applyTheme();
    await chrome.storage.local.set({ [THEME_KEY]: themeSetting });
  }
  themeBtn.addEventListener("click", () => {
    const i = THEME_ORDER.indexOf(themeSetting);
    setTheme(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
  });
  darkMq.addEventListener("change", () => {
    if (themeSetting === "system") applyTheme();
  });

  // ---------- Overflow menu (⋯) ----------
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    moreMenu.innerHTML = "";
    const items = [
      { label: "Xuất trang này (.md)", disabled: !state.activeId, fn: () => state.activeId && exportNode(state.activeId) },
      { label: "Xuất toàn bộ (.json)", fn: exportAll },
      { label: "Nhập từ file…", fn: triggerImport },
      { sep: true },
      { groupLabel: "Giao diện" },
      ...THEME_ORDER.map((t) => ({
        label: THEME_LABEL[t],
        checked: themeSetting === t,
        fn: () => setTheme(t),
      })),
    ];
    items.forEach((it) => {
      if (it.sep) {
        const s = document.createElement("div");
        s.className = "ctx-sep";
        moreMenu.appendChild(s);
        return;
      }
      if (it.groupLabel) {
        const l = document.createElement("div");
        l.className = "ctx-label";
        l.textContent = it.groupLabel;
        moreMenu.appendChild(l);
        return;
      }
      const b = document.createElement("button");
      b.textContent = it.label;
      if (it.checked) b.classList.add("checked");
      if (it.disabled) b.disabled = true;
      b.addEventListener("click", () => {
        moreMenu.hidden = true;
        it.fn();
      });
      moreMenu.appendChild(b);
    });
    moreMenu.hidden = false;
    const r = moreBtn.getBoundingClientRect();
    moreMenu.style.left = Math.min(r.left, window.innerWidth - 200) + "px";
    moreMenu.style.top = r.bottom + 4 + "px";
  });

  // ---------- Top-level buttons ----------
  $("newRootBtn").addEventListener("click", () => createNode(null));
  $("emptyCreateBtn").addEventListener("click", () => createNode(null));
  $("welcomeCreateBtn").addEventListener("click", () => createNode(null));
  searchInput.addEventListener("input", renderTree);

  // Sync across multiple open side panels / windows.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || writingLocally || !changes[STORE_KEY]) return;
    const next = changes[STORE_KEY].newValue;
    if (!next || !next.nodes) return;
    const editing =
      document.activeElement === contentArea || document.activeElement === titleInput;
    state = next;
    if (!state.nodes[state.activeId]) state.activeId = state.rootIds[0] || null;
    renderTree();
    if (!editing) {
      state.activeId ? openEditor(state.activeId) : showWelcome();
    }
  });

  // ---------- Boot ----------
  (async function init() {
    const { [THEME_KEY]: savedTheme } = await chrome.storage.local.get([THEME_KEY]);
    if (THEME_ORDER.includes(savedTheme)) themeSetting = savedTheme;
    applyTheme();

    await load();
    renderTree();
    if (state.activeId && state.nodes[state.activeId]) openEditor(state.activeId);
    else if (state.rootIds.length) openEditor((state.activeId = state.rootIds[0]));
    else showWelcome();
  })();
})();
