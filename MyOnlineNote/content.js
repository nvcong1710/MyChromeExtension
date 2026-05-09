(function () {
  const CONTAINER_ID = "mon-note-container";
  const STORAGE_KEYS = {
    text: "noteText",
    pos: "notePosition",
    size: "noteSize",
  };
  const DEFAULT_POS = { left: null, top: 100 }; // null left → use right:0 fallback
  const DEFAULT_SIZE = { width: 300, height: 300 };

  chrome.runtime.onMessage.addListener(function (request) {
    if (request.action === "createNote") {
      createNoteOnPage({
        width: Number(request.width) || DEFAULT_SIZE.width,
        height: Number(request.height) || DEFAULT_SIZE.height,
      });
    }
  });

  async function loadState() {
    const data = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
    return {
      text: typeof data[STORAGE_KEYS.text] === "string" ? data[STORAGE_KEYS.text] : "",
      pos: data[STORAGE_KEYS.pos] || null,
      size: data[STORAGE_KEYS.size] || null,
    };
  }

  function saveText(text) {
    chrome.storage.local.set({ [STORAGE_KEYS.text]: text });
  }
  function savePos(pos) {
    chrome.storage.local.set({ [STORAGE_KEYS.pos]: pos });
  }
  function saveSize(size) {
    chrome.storage.local.set({ [STORAGE_KEYS.size]: size });
  }

  async function createNoteOnPage(initialSize) {
    const existing = document.getElementById(CONTAINER_ID);
    const state = await loadState();

    // Prefer last-saved size, else the size the popup just submitted, else default.
    const size = state.size || initialSize || DEFAULT_SIZE;

    if (existing) {
      // Reuse existing note: just resize and bring to front. Don't duplicate.
      existing.style.width = size.width + "px";
      existing.style.height = size.height + "px";
      saveSize(size);
      return;
    }

    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    Object.assign(container.style, {
      position: "fixed",
      top: (state.pos?.top ?? DEFAULT_POS.top) + "px",
      ...(state.pos?.left != null
        ? { left: state.pos.left + "px" }
        : { right: "0" }),
      width: size.width + "px",
      height: size.height + "px",
      display: "flex",
      flexDirection: "column",
      padding: "10px",
      zIndex: "2147483646",
      backgroundColor: "white",
      border: "1px solid #ccc",
      boxShadow: "0 4px 8px rgba(0, 0, 0, 0.15)",
      boxSizing: "border-box",
    });

    const dragHandle = document.createElement("div");
    Object.assign(dragHandle.style, {
      width: "100%",
      boxSizing: "border-box",
      height: "30px",
      backgroundColor: "#007BFF",
      cursor: "move",
      display: "flex",
      alignItems: "center",
      padding: "0 10px",
      flex: "0 0 auto",
    });

    const closeButton = document.createElement("button");
    closeButton.textContent = "×";
    closeButton.title = "Close";
    Object.assign(closeButton.style, {
      marginLeft: "auto",
      border: "none",
      background: "none",
      fontSize: "20px",
      cursor: "pointer",
      color: "white",
      lineHeight: "1",
    });
    closeButton.addEventListener("click", function () {
      container.remove();
    });
    dragHandle.appendChild(closeButton);

    const inputBox = document.createElement("textarea");
    inputBox.placeholder = "Enter text here";
    inputBox.value = state.text;
    inputBox.spellcheck = false;
    Object.assign(inputBox.style, {
      flex: "1 1 auto",
      padding: "10px",
      fontSize: "16px",
      border: "2px solid #ccc",
      borderRadius: "5px",
      boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
      outline: "none",
      transition: "border-color 0.3s, box-shadow 0.3s",
      width: "100%",
      boxSizing: "border-box",
      resize: "none",
      lineHeight: "18px",
      marginTop: "8px",
    });

    inputBox.addEventListener("focus", function () {
      inputBox.style.borderColor = "#007BFF";
      inputBox.style.boxShadow = "0 4px 8px rgba(0, 123, 255, 0.3)";
    });
    inputBox.addEventListener("blur", function () {
      inputBox.style.borderColor = "#ccc";
      inputBox.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.1)";
    });

    let saveTimer = null;
    inputBox.addEventListener("input", function () {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveText(inputBox.value), 250);
    });

    container.appendChild(dragHandle);
    container.appendChild(inputBox);
    document.body.appendChild(container);
    saveSize(size);

    wireDrag(container, dragHandle);
    wireResize(container);

    // React to text edits made on other tabs.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[STORAGE_KEYS.text] && document.activeElement !== inputBox) {
        inputBox.value = changes[STORAGE_KEYS.text].newValue ?? "";
      }
    });
  }

  function wireDrag(container, handle) {
    handle.addEventListener("mousedown", function (event) {
      if (event.target.tagName === "BUTTON") return;
      event.preventDefault();
      const startRect = container.getBoundingClientRect();
      const shiftX = event.clientX - startRect.left;
      const shiftY = event.clientY - startRect.top;

      function moveAt(pageX, pageY) {
        const newLeft = Math.max(
          0,
          Math.min(window.innerWidth - container.offsetWidth, pageX - shiftX)
        );
        const newTop = Math.max(
          0,
          Math.min(window.innerHeight - container.offsetHeight, pageY - shiftY)
        );
        container.style.left = newLeft + "px";
        container.style.top = newTop + "px";
        container.style.right = "auto";
      }

      function onMouseMove(e) {
        moveAt(e.clientX, e.clientY);
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        const rect = container.getBoundingClientRect();
        savePos({ left: rect.left, top: rect.top });
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    handle.addEventListener("dragstart", () => false);
  }

  function wireResize(container) {
    const handle = document.createElement("div");
    Object.assign(handle.style, {
      position: "absolute",
      right: "0",
      bottom: "0",
      width: "14px",
      height: "14px",
      cursor: "nwse-resize",
      background:
        "linear-gradient(135deg, transparent 50%, #999 50%, #999 60%, transparent 60%, transparent 75%, #999 75%, #999 85%, transparent 85%)",
    });
    container.appendChild(handle);

    handle.addEventListener("mousedown", function (e) {
      e.preventDefault();
      const startRect = container.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;

      function onMove(ev) {
        const w = Math.max(160, Math.round(startRect.width + (ev.clientX - startX)));
        const h = Math.max(120, Math.round(startRect.height + (ev.clientY - startY)));
        container.style.width = w + "px";
        container.style.height = h + "px";
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const rect = container.getBoundingClientRect();
        saveSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
})();
