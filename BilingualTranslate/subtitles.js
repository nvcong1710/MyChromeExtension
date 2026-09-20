// ==========================================================================
// Vimi Bilingual — Universal Video Subtitles & Captions Engine
//
// Features:
//  - Universal Multi-Engine Subtitle Capture:
//      * Engine 1: HTML5 TextTracks (Coursera, edX, Canvas, Video.js, Plyr, etc.)
//      * Engine 2: Platform-specific DOM Caption Observers (YouTube, Udemy, etc.)
//      * Engine 3: External SRT/VTT file loader with drag & drop onto video
//  - Real-time Bilingual Translation (Chrome on-device AI + background fallback)
//  - LRU In-memory Cue Cache for zero-latency replay
//  - Fullscreen compatibility (dynamic reparenting to document.fullscreenElement)
//  - Word-level interactive vocabulary integration: click any word in subtitles
//    to look up & save directly to Vimi spaced repetition vocabulary!
//  - Auto-pause on hover (Study mode for LMS lectures)
//  - Draggable & resizable overlay with floating video control badge
// ==========================================================================

(() => {
  if (window.__vimiSubtitlesLoaded) return;
  window.__vimiSubtitlesLoaded = true;

  const F = self.FuFu;
  const HAS_LETTER = /\p{L}/u;

  // Clean WebVTT and HTML tags from subtitle cues
  function cleanCueText(raw) {
    if (!raw) return "";
    return raw
      .replace(/<v[^>]*>/gi, "") // WebVTT voice tags
      .replace(/<\/v>/gi, "")
      .replace(/<c\.[^>]*>/gi, "") // WebVTT class tags
      .replace(/<\/c>/gi, "")
      .replace(/<[^>]+>/g, " ") // All remaining HTML/VTT tags
      .replace(/\{[^}]+\}/g, "") // ASS/SSA style tags
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  // ── Global Subtitle State & Config ────────────────────────────────────────
  let cfg = {
    src: "en",
    tgt: "vi",
    transColor: "",
    videoSubEnabled: true,
    videoSubLayout: "bilingual", // bilingual | transOnly | origOnly
    videoSubSize: "md", // sm | md | lg | xl
    videoSubAutoPause: false,
    videoSubHighlightVocab: true,
  };

  let savedVocabSet = new Set();
  const cueCache = new Map(); // LRU translation cache

  async function refreshConfig() {
    try {
      cfg = Object.assign(cfg, await F.getConfig());
      const vocabList = await F.getVocab();
      savedVocabSet = new Set(
        vocabList.map((w) => (w.term || "").trim().toLowerCase()).filter(Boolean)
      );
      // Update all active controllers
      for (const ctrl of activeControllers.values()) {
        ctrl.applyConfig();
      }
    } catch {}
  }

  async function refreshSavedVocabMarks() {
    try {
      const vocabList = await F.getVocab();
      savedVocabSet = new Set(
        vocabList.map((w) => (w.term || "").trim().toLowerCase()).filter(Boolean)
      );
      for (const ctrl of activeControllers.values()) {
        ctrl.highlightSavedWords();
      }
    } catch {}
  }

  F.getConfig().then(refreshConfig);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.fufuConfig) {
        refreshConfig();
      } else if (changes.fufuVocab) {
        refreshSavedVocabMarks();
      }
    }
  });

  // ── Translation Pipeline ──────────────────────────────────────────────────
  let onDeviceTranslator = null;
  let translatorInitPromise = null;

  async function getOnDeviceTranslator() {
    if (onDeviceTranslator) return onDeviceTranslator;
    if (translatorInitPromise) return translatorInitPromise;

    translatorInitPromise = (async () => {
      if (typeof Translator === "undefined") throw new Error("NO_ON_DEVICE_API");
      const t = await Translator.create({
        sourceLanguage: cfg.src || "en",
        targetLanguage: cfg.tgt || "vi",
      });
      onDeviceTranslator = t;
      return t;
    })().catch((err) => {
      translatorInitPromise = null;
      throw err;
    });

    return translatorInitPromise;
  }

  async function translateCue(text) {
    const key = `${cfg.src}:${cfg.tgt}:${text}`;
    if (cueCache.has(key)) return cueCache.get(key);

    let translated = "";
    try {
      const t = await getOnDeviceTranslator();
      translated = await t.translate(text);
    } catch {
      // Fallback to background service worker translation
      try {
        const res = await chrome.runtime.sendMessage({
          type: "FUFU_TRANSLATE",
          text,
          src: cfg.src || "auto",
          tgt: cfg.tgt || "vi",
        });
        if (res?.translation) {
          translated = res.translation;
        }
      } catch {}
    }

    if (translated) {
      if (cueCache.size > 800) {
        const firstKey = cueCache.keys().next().value;
        cueCache.delete(firstKey);
      }
      cueCache.set(key, translated);
    }

    return translated || text;
  }

  // ── SRT & WebVTT File Parser ──────────────────────────────────────────────
  function parseTimestamp(timeStr) {
    const parts = timeStr.trim().replace(",", ".").split(":");
    if (parts.length === 3) {
      const [h, m, s] = parts;
      return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
    } else if (parts.length === 2) {
      const [m, s] = parts;
      return parseFloat(m) * 60 + parseFloat(s);
    }
    return 0;
  }

  function parseSubtitles(content) {
    const cues = [];
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const blocks = normalized.split(/\n\s*\n/);

    const timeRegex = /((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{2,3})/;

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      let timeLineIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (timeRegex.test(lines[i])) {
          timeLineIdx = i;
          break;
        }
      }
      if (timeLineIdx === -1) continue;

      const match = lines[timeLineIdx].match(timeRegex);
      if (!match) continue;

      const start = parseTimestamp(match[1]);
      const end = parseTimestamp(match[2]);
      const text = cleanCueText(lines.slice(timeLineIdx + 1).join(" "));

      if (text && end > start) {
        cues.push({ start, end, text });
      }
    }

    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  // ── Single Video Controller ───────────────────────────────────────────────
  class VideoController {
    constructor(video) {
      this.video = video;
      this.container = this.findPlayerContainer();
      this.overlay = null;
      this.badge = null;
      this.menu = null;
      this.fileInput = null;

      this.currentCueText = "";
      this.currentTranslatedText = "";
      this.lastCueTime = 0;
      this.externalCues = null;
      this.activeTrack = null;
      this.domObserver = null;
      this.boundCueChange = this.onNativeCueChange.bind(this);
      this.boundTimeUpdate = this.onTimeUpdate.bind(this);
      this.boundPause = () => this.cancelStickyClear();
      this.boundPlay = () => {
        if (this.currentCueText) this.scheduleStickyClear(6000);
      };
      this.boundEnded = () => this.handleCueClear();
      this.debounceTimer = null;
      this.translateDebounceTimer = null;
      this.stickyClearTimer = null;
      this.wasPausedByHover = false;
      this.badgeHasDragged = false;
      this.badgeJustDragged = false;
      this.cleanupBadgeDrag = null;
      this.cleanupOverlayDrag = null;
      this.boundResize = null;

      this.initUI();
      this.attachEvents();
      this.detectSubtitles();
    }

    findPlayerContainer() {
      // Find the closest wrapper container that encloses the video player
      const el = this.video;
      const playerCandidate = el.closest(
        '#movie_player, .html5-video-player, .video-js, [class*="player__"], [class*="player-container"], [data-purpose="video-player"], [class*="video-player"]'
      );
      if (playerCandidate) return playerCandidate;

      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        if (
          style.position === "relative" ||
          style.position === "absolute" ||
          style.position === "fixed"
        ) {
          return parent;
        }
        parent = parent.parentElement;
      }
      const directParent = el.parentElement || document.body;
      if (directParent !== document.body) {
        const s = window.getComputedStyle(directParent);
        if (s.position === "static") {
          directParent.style.position = "relative";
        }
      }
      return directParent;
    }

    initUI() {
      // 1. Subtitle Overlay
      this.overlay = document.createElement("div");
      this.overlay.className = `vimi-sub-overlay vimi-sub-${cfg.videoSubSize || "md"} vimi-sub-hidden`;
      this.overlay.innerHTML = `
        <div class="vimi-sub-drag-handle" title="Drag to reposition subtitles"></div>
        <div class="vimi-sub-content">
          <div class="vimi-sub-orig"></div>
          <div class="vimi-sub-trans"></div>
        </div>
      `;

      // 2. Control Badge
      this.badge = document.createElement("div");
      this.badge.className = "vimi-sub-badge";
      this.badge.innerHTML = `
        <span class="vimi-sub-badge-icon">CC</span>
        <span>Vimi</span>
        <span class="vimi-sub-badge-dot"></span>
      `;
      this.badge.title = "Vimi Bilingual Video Subtitles (Drag to move, double-click to reset)";

      // 3. Settings Menu
      this.menu = document.createElement("div");
      this.menu.className = "vimi-sub-menu vimi-menu-hidden";
      this.renderMenu();

      // Hidden file input for external SRT/VTT
      this.fileInput = document.createElement("input");
      this.fileInput.type = "file";
      this.fileInput.accept = ".srt,.vtt";
      this.fileInput.style.display = "none";
      this.fileInput.addEventListener("change", (e) => this.handleFileSelect(e));

      this.mountToContainer();
      this.setupDraggable();
      this.setupHoverPause();
      this.loadSavedPositions();
    }

    mountToContainer() {
      const target = document.fullscreenElement || this.container;
      if (!target.contains(this.overlay)) target.appendChild(this.overlay);
      if (!target.contains(this.badge)) target.appendChild(this.badge);
      if (!target.contains(this.menu)) target.appendChild(this.menu);
      if (!target.contains(this.fileInput)) target.appendChild(this.fileInput);
      this.loadSavedPositions();
    }

    renderMenu() {
      const tracks = this.getAvailableTracks();
      const trackOptions = tracks
        .map(
          (t, idx) =>
            `<option value="${idx}" ${t.selected ? "selected" : ""}>${t.label || t.language || `Track ${idx + 1}`}</option>`
        )
        .join("");

      this.menu.innerHTML = `
        <div class="vimi-sub-menu-title">
          <span>🎬 Bilingual Subtitles</span>
          <span style="font-size: 11px; opacity: 0.8;">Vimi</span>
        </div>
        <div class="vimi-sub-menu-row">
          <span class="vimi-sub-menu-label">Subtitles</span>
          <button class="vimi-sub-toggle-btn ${cfg.videoSubEnabled ? "active" : ""}" id="vimiSubToggle">
            ${cfg.videoSubEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>
        <div class="vimi-sub-menu-row">
          <span class="vimi-sub-menu-label">Layout</span>
          <div class="vimi-sub-segmented">
            <button class="vimi-sub-seg-btn ${cfg.videoSubLayout === "bilingual" ? "active" : ""}" data-layout="bilingual">Both</button>
            <button class="vimi-sub-seg-btn ${cfg.videoSubLayout === "transOnly" ? "active" : ""}" data-layout="transOnly">Target</button>
            <button class="vimi-sub-seg-btn ${cfg.videoSubLayout === "origOnly" ? "active" : ""}" data-layout="origOnly">Source</button>
          </div>
        </div>
        <div class="vimi-sub-menu-row">
          <span class="vimi-sub-menu-label">Track</span>
          <select class="vimi-sub-select" id="vimiSubTrackSelect">
            <option value="auto">Auto-detect</option>
            ${trackOptions}
          </select>
        </div>
        <div class="vimi-sub-menu-row">
          <span class="vimi-sub-menu-label">Size</span>
          <div class="vimi-sub-segmented">
            <button class="vimi-sub-seg-btn ${cfg.videoSubSize === "sm" ? "active" : ""}" data-size="sm">S</button>
            <button class="vimi-sub-seg-btn ${cfg.videoSubSize === "md" ? "active" : ""}" data-size="md">M</button>
            <button class="vimi-sub-seg-btn ${cfg.videoSubSize === "lg" ? "active" : ""}" data-size="lg">L</button>
            <button class="vimi-sub-seg-btn ${cfg.videoSubSize === "xl" ? "active" : ""}" data-size="xl">XL</button>
          </div>
        </div>
        <div class="vimi-sub-menu-row">
          <span class="vimi-sub-menu-label">Study Mode (Pause on hover)</span>
          <button class="vimi-sub-toggle-btn ${cfg.videoSubAutoPause ? "active" : ""}" id="vimiSubPauseToggle">
            ${cfg.videoSubAutoPause ? "ON" : "OFF"}
          </button>
        </div>
        <button class="vimi-sub-btn-secondary" id="vimiResetPositions">
          ↺ Reset Positions (Default)
        </button>
        <button class="vimi-sub-btn-secondary" id="vimiLoadSubFile">
          📁 Load .srt / .vtt file
        </button>
      `;

      this.bindMenuEvents();
    }

    bindMenuEvents() {
      const toggleBtn = this.menu.querySelector("#vimiSubToggle");
      toggleBtn?.addEventListener("click", () => {
        cfg.videoSubEnabled = !cfg.videoSubEnabled;
        F.setConfig({ videoSubEnabled: cfg.videoSubEnabled });
        this.applyConfig();
      });

      this.menu.querySelectorAll("[data-layout]").forEach((btn) => {
        btn.addEventListener("click", () => {
          cfg.videoSubLayout = btn.dataset.layout;
          F.setConfig({ videoSubLayout: cfg.videoSubLayout });
          this.applyConfig();
        });
      });

      this.menu.querySelectorAll("[data-size]").forEach((btn) => {
        btn.addEventListener("click", () => {
          cfg.videoSubSize = btn.dataset.size;
          F.setConfig({ videoSubSize: cfg.videoSubSize });
          this.applyConfig();
        });
      });

      const pauseBtn = this.menu.querySelector("#vimiSubPauseToggle");
      pauseBtn?.addEventListener("click", () => {
        cfg.videoSubAutoPause = !cfg.videoSubAutoPause;
        F.setConfig({ videoSubAutoPause: cfg.videoSubAutoPause });
        this.applyConfig();
      });

      const trackSelect = this.menu.querySelector("#vimiSubTrackSelect");
      trackSelect?.addEventListener("change", (e) => {
        const val = e.target.value;
        if (val === "auto") {
          this.activeTrack = null;
          this.detectSubtitles();
        } else {
          const idx = parseInt(val, 10);
          this.selectTrackByIndex(idx);
        }
      });

      const resetBtn = this.menu.querySelector("#vimiResetPositions");
      resetBtn?.addEventListener("click", () => {
        this.resetPositions();
        this.showToast("Subtitles & CC badge reset to default positions");
      });

      const loadFileBtn = this.menu.querySelector("#vimiLoadSubFile");
      loadFileBtn?.addEventListener("click", () => {
        this.fileInput.click();
      });
    }

    handleFileSelect(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result;
        if (typeof text === "string") {
          const cues = parseSubtitles(text);
          if (cues.length > 0) {
            this.externalCues = cues;
            this.video.addEventListener("timeupdate", this.boundTimeUpdate);
            this.showToast(`Loaded ${cues.length} subtitles from ${file.name}`);
            this.menu.classList.add("vimi-menu-hidden");
          } else {
            this.showToast("Could not find valid subtitles in file");
          }
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    }

    showToast(msg) {
      const toast = document.createElement("div");
      toast.style.cssText = `
        position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.95); color: #38bdf8; padding: 6px 14px;
        border-radius: 8px; font-size: 12px; font-weight: 600; z-index: 2147483647;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4); border: 1px solid rgba(56, 189, 248, 0.3);
      `;
      toast.textContent = msg;
      (document.fullscreenElement || this.container).appendChild(toast);
      setTimeout(() => toast.remove(), 2500);
    }

    applyConfig() {
      // Toggle overlay visibility
      if (!cfg.videoSubEnabled) {
        this.overlay.classList.add("vimi-sub-hidden");
        this.badge.classList.add("vimi-sub-disabled");
      } else {
        this.badge.classList.remove("vimi-sub-disabled");
        if (this.currentCueText) {
          this.overlay.classList.remove("vimi-sub-hidden");
        }
      }

      // Update sizing
      this.overlay.className = this.overlay.className.replace(/vimi-sub-(sm|md|lg|xl)/g, "");
      this.overlay.classList.add(`vimi-sub-${cfg.videoSubSize || "md"}`);

      // Re-render menu
      this.renderMenu();

      // Refresh current cue display
      if (this.activeTrack) {
        this.activeTrack.mode = cfg.videoSubEnabled ? "hidden" : "showing";
      }
      if (this.currentCueText) {
        this.renderCueDisplay();
      }
    }

    positionMenu() {
      if (!this.menu || this.menu.classList.contains("vimi-menu-hidden")) return;
      const target = document.fullscreenElement || this.container;
      const parentRect = target.getBoundingClientRect();
      const badgeRect = this.badge.getBoundingClientRect();
      const menuWidth = 250;
      const menuHeight = this.menu.offsetHeight || 320;

      const badgeRelLeft = badgeRect.left - parentRect.left;
      const badgeRelTop = badgeRect.top - parentRect.top;

      // Horizontal: align right edge if near right border, otherwise align left edge
      let menuLeft = badgeRelLeft;
      if (badgeRelLeft + menuWidth > parentRect.width - 10) {
        menuLeft = badgeRelLeft + badgeRect.width - menuWidth;
      }
      menuLeft = Math.max(10, Math.min(parentRect.width - menuWidth - 10, menuLeft));

      // Vertical: flip upwards if badge is near the bottom edge
      let menuTop = badgeRelTop + badgeRect.height + 8;
      if (menuTop + menuHeight > parentRect.height - 10 && badgeRelTop - menuHeight - 8 >= 10) {
        menuTop = badgeRelTop - menuHeight - 8;
      }
      menuTop = Math.max(10, Math.min(parentRect.height - menuHeight - 10, menuTop));

      this.menu.style.left = `${menuLeft}px`;
      this.menu.style.top = `${menuTop}px`;
      this.menu.style.right = "auto";
      this.menu.style.bottom = "auto";
    }

    resetPositions() {
      // 1. Reset overlay to bottom-center default
      this.overlay.style.top = "auto";
      this.overlay.style.bottom = "50px";
      this.overlay.style.left = "50%";
      this.overlay.style.right = "auto";
      this.overlay.style.transform = "translateX(-50%)";

      // 2. Reset badge to top-right default
      this.badge.style.top = "14px";
      this.badge.style.right = "14px";
      this.badge.style.left = "auto";
      this.badge.style.bottom = "auto";
      this.badge.style.transform = "none";

      try {
        chrome.storage.local.remove(["vimiSubOverlayPos", "vimiSubBadgePos"]);
      } catch {}

      this.positionMenu();
    }

    async loadSavedPositions() {
      try {
        const { vimiSubOverlayPos, vimiSubBadgePos } = await chrome.storage.local.get([
          "vimiSubOverlayPos",
          "vimiSubBadgePos",
        ]);
        const target = document.fullscreenElement || this.container;
        const parentRect = target.getBoundingClientRect();
        if (parentRect.width <= 0 || parentRect.height <= 0) return;

        if (vimiSubOverlayPos && typeof vimiSubOverlayPos.x === "number" && typeof vimiSubOverlayPos.y === "number") {
          const overlayWidth = this.overlay.offsetWidth || Math.min(parentRect.width * 0.88, 780);
          const overlayHeight = this.overlay.offsetHeight || 50;
          const leftPx = Math.max(8, Math.min(parentRect.width - overlayWidth - 8, (vimiSubOverlayPos.x / 100) * parentRect.width));
          const topPx = Math.max(8, Math.min(parentRect.height - overlayHeight - 8, (vimiSubOverlayPos.y / 100) * parentRect.height));
          this.overlay.style.bottom = "auto";
          this.overlay.style.right = "auto";
          this.overlay.style.transform = "none";
          this.overlay.style.left = `${leftPx}px`;
          this.overlay.style.top = `${topPx}px`;
        }

        if (vimiSubBadgePos && typeof vimiSubBadgePos.x === "number" && typeof vimiSubBadgePos.y === "number") {
          const badgeWidth = this.badge.offsetWidth || 80;
          const badgeHeight = this.badge.offsetHeight || 30;
          const leftPx = Math.max(8, Math.min(parentRect.width - badgeWidth - 8, (vimiSubBadgePos.x / 100) * parentRect.width));
          const topPx = Math.max(8, Math.min(parentRect.height - badgeHeight - 8, (vimiSubBadgePos.y / 100) * parentRect.height));
          this.badge.style.right = "auto";
          this.badge.style.bottom = "auto";
          this.badge.style.transform = "none";
          this.badge.style.left = `${leftPx}px`;
          this.badge.style.top = `${topPx}px`;
        }
      } catch {}
    }

    setupDraggable() {
      const getTarget = () => document.fullscreenElement || this.container;

      // ── A. Subtitle Overlay Card Dragging ──────────────────────────────────
      let overlayActivePointerId = null;
      let overlayStartX = 0, overlayStartY = 0;
      let overlayInitLeft = 0, overlayInitTop = 0;
      let overlayMoved = false;

      const endOverlayDrag = (cancelled = false) => {
        if (overlayActivePointerId === null) return;
        const pid = overlayActivePointerId;
        overlayActivePointerId = null;

        try {
          if (this.overlay.hasPointerCapture && this.overlay.hasPointerCapture(pid)) {
            this.overlay.releasePointerCapture(pid);
          }
        } catch {}

        window.removeEventListener("pointermove", onOverlayPointerMove, true);
        window.removeEventListener("pointerup", onOverlayPointerUp, true);
        window.removeEventListener("mouseup", onOverlayPointerUp, true);
        window.removeEventListener("pointercancel", onOverlayPointerCancel, true);
        window.removeEventListener("lostpointercapture", onOverlayPointerCancel, true);
        window.removeEventListener("keydown", onOverlayKeyDown, true);
        window.removeEventListener("blur", onOverlayBlur, true);

        this.overlay.classList.remove("vimi-sub-dragging");

        if (cancelled) {
          this.overlay.style.bottom = "auto";
          this.overlay.style.right = "auto";
          this.overlay.style.transform = "none";
          this.overlay.style.left = `${overlayInitLeft}px`;
          this.overlay.style.top = `${overlayInitTop}px`;
          overlayMoved = false;
          return;
        }

        if (overlayMoved) {
          overlayMoved = false;
          const target = getTarget();
          const pRect = target.getBoundingClientRect();
          const oRect = this.overlay.getBoundingClientRect();
          const curLeft = oRect.left - pRect.left;
          const curTop = oRect.top - pRect.top;
          if (pRect.width > 0 && pRect.height > 0) {
            const xPercent = (curLeft / pRect.width) * 100;
            const yPercent = (curTop / pRect.height) * 100;
            chrome.storage.local.set({ vimiSubOverlayPos: { x: xPercent, y: yPercent } });
          }
        }
      };

      const onOverlayPointerMove = (ev) => {
        if (overlayActivePointerId === null || ev.pointerId !== overlayActivePointerId) return;
        const dx = ev.clientX - overlayStartX;
        const dy = ev.clientY - overlayStartY;

        if (!overlayMoved && Math.hypot(dx, dy) > 4) {
          overlayMoved = true;
          this.overlay.classList.add("vimi-sub-dragging");
        }
        if (!overlayMoved) return;

        const target = getTarget();
        const pRect = target.getBoundingClientRect();
        const oRect = this.overlay.getBoundingClientRect();

        let newLeft = overlayInitLeft + dx;
        let newTop = overlayInitTop + dy;

        newLeft = Math.max(8, Math.min(pRect.width - oRect.width - 8, newLeft));
        newTop = Math.max(8, Math.min(pRect.height - oRect.height - 8, newTop));

        this.overlay.style.bottom = "auto";
        this.overlay.style.right = "auto";
        this.overlay.style.transform = "none";
        this.overlay.style.left = `${newLeft}px`;
        this.overlay.style.top = `${newTop}px`;

        ev.preventDefault();
        ev.stopPropagation();
      };

      const onOverlayPointerUp = (ev) => {
        if (overlayActivePointerId !== null && (ev.pointerId === overlayActivePointerId || !ev.pointerId)) {
          endOverlayDrag(false);
        }
      };

      const onOverlayPointerCancel = (ev) => {
        if (overlayActivePointerId !== null && (!ev || ev.pointerId === overlayActivePointerId || !ev.pointerId)) {
          endOverlayDrag(true);
        }
      };

      const onOverlayBlur = () => {
        if (overlayActivePointerId !== null) {
          endOverlayDrag(true);
        }
      };

      const onOverlayKeyDown = (ev) => {
        if (overlayActivePointerId !== null && ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          endOverlayDrag(true);
        }
      };

      const onOverlayPointerDown = (e) => {
        // Do not drag if clicking an interactive vocabulary word or button
        if (e.target.closest(".vimi-sub-word, .vimi-menu-btn, button, a, input, select")) return;
        if (e.pointerType === "mouse" && e.button !== 0) return; // only left click
        if (e.isPrimary === false) return;

        e.stopPropagation();

        if (overlayActivePointerId !== null) {
          endOverlayDrag(true);
        }

        const target = getTarget();
        const parentRect = target.getBoundingClientRect();
        const overlayRect = this.overlay.getBoundingClientRect();

        overlayActivePointerId = e.pointerId;
        overlayMoved = false;
        overlayStartX = e.clientX;
        overlayStartY = e.clientY;
        overlayInitLeft = overlayRect.left - parentRect.left;
        overlayInitTop = overlayRect.top - parentRect.top;

        try {
          this.overlay.setPointerCapture(e.pointerId);
        } catch {}

        window.addEventListener("pointermove", onOverlayPointerMove, { capture: true, passive: false });
        window.addEventListener("pointerup", onOverlayPointerUp, { capture: true });
        window.addEventListener("mouseup", onOverlayPointerUp, { capture: true });
        window.addEventListener("pointercancel", onOverlayPointerCancel, { capture: true });
        window.addEventListener("lostpointercapture", onOverlayPointerCancel, { capture: true });
        window.addEventListener("keydown", onOverlayKeyDown, { capture: true });
        window.addEventListener("blur", onOverlayBlur, { capture: true });
      };

      this.cleanupOverlayDrag = endOverlayDrag;
      this.overlay.addEventListener("pointerdown", onOverlayPointerDown);

      // Double-click overlay resets position to bottom center
      this.overlay.addEventListener("dblclick", (e) => {
        if (e.target.closest(".vimi-sub-word")) return;
        e.stopPropagation();
        this.overlay.style.top = "auto";
        this.overlay.style.bottom = "50px";
        this.overlay.style.left = "50%";
        this.overlay.style.right = "auto";
        this.overlay.style.transform = "translateX(-50%)";
        chrome.storage.local.remove("vimiSubOverlayPos");
        this.showToast("Subtitles reset to bottom center");
      });

      // ── B. Control Badge Dragging ──────────────────────────────────────────
      let badgeActivePointerId = null;
      let badgeStartX = 0, badgeStartY = 0;
      let badgeInitLeft = 0, badgeInitTop = 0;
      this.badgeHasDragged = false;
      this.badgeJustDragged = false;

      const endBadgeDrag = (cancelled = false) => {
        if (badgeActivePointerId === null) return;
        const pid = badgeActivePointerId;
        badgeActivePointerId = null;

        try {
          if (this.badge.hasPointerCapture && this.badge.hasPointerCapture(pid)) {
            this.badge.releasePointerCapture(pid);
          }
        } catch {}

        window.removeEventListener("pointermove", onBadgePointerMove, true);
        window.removeEventListener("pointerup", onBadgePointerUp, true);
        window.removeEventListener("mouseup", onBadgePointerUp, true);
        window.removeEventListener("pointercancel", onBadgePointerCancel, true);
        window.removeEventListener("lostpointercapture", onBadgePointerCancel, true);
        window.removeEventListener("keydown", onBadgeKeyDown, true);
        window.removeEventListener("blur", onBadgeBlur, true);

        this.badge.classList.remove("vimi-sub-badge-dragging");

        if (cancelled) {
          this.badge.style.right = "auto";
          this.badge.style.bottom = "auto";
          this.badge.style.transform = "none";
          this.badge.style.left = `${badgeInitLeft}px`;
          this.badge.style.top = `${badgeInitTop}px`;
          this.badgeHasDragged = false;
          this.positionMenu();
          return;
        }

        if (this.badgeHasDragged) {
          this.badgeJustDragged = true;
          setTimeout(() => {
            this.badgeJustDragged = false;
            this.badgeHasDragged = false;
          }, 200);

          const target = getTarget();
          const pRect = target.getBoundingClientRect();
          const bRect = this.badge.getBoundingClientRect();
          const curLeft = bRect.left - pRect.left;
          const curTop = bRect.top - pRect.top;
          if (pRect.width > 0 && pRect.height > 0) {
            const xPercent = (curLeft / pRect.width) * 100;
            const yPercent = (curTop / pRect.height) * 100;
            chrome.storage.local.set({ vimiSubBadgePos: { x: xPercent, y: yPercent } });
          }
          this.positionMenu();
        }
      };

      const onBadgePointerMove = (ev) => {
        if (badgeActivePointerId === null || ev.pointerId !== badgeActivePointerId) return;
        const dx = ev.clientX - badgeStartX;
        const dy = ev.clientY - badgeStartY;

        if (!this.badgeHasDragged && Math.hypot(dx, dy) > 5) {
          this.badgeHasDragged = true;
          this.badge.classList.add("vimi-sub-badge-dragging");
        }
        if (!this.badgeHasDragged) return;

        const target = getTarget();
        const pRect = target.getBoundingClientRect();
        const bRect = this.badge.getBoundingClientRect();

        let newLeft = badgeInitLeft + dx;
        let newTop = badgeInitTop + dy;

        newLeft = Math.max(8, Math.min(pRect.width - bRect.width - 8, newLeft));
        newTop = Math.max(8, Math.min(pRect.height - bRect.height - 8, newTop));

        this.badge.style.right = "auto";
        this.badge.style.bottom = "auto";
        this.badge.style.transform = "none";
        this.badge.style.left = `${newLeft}px`;
        this.badge.style.top = `${newTop}px`;

        this.positionMenu();
        ev.preventDefault();
        ev.stopPropagation();
      };

      const onBadgePointerUp = (ev) => {
        if (badgeActivePointerId !== null && (ev.pointerId === badgeActivePointerId || !ev.pointerId)) {
          endBadgeDrag(false);
        }
      };

      const onBadgePointerCancel = (ev) => {
        if (badgeActivePointerId !== null && (!ev || ev.pointerId === badgeActivePointerId || !ev.pointerId)) {
          endBadgeDrag(true);
        }
      };

      const onBadgeBlur = () => {
        if (badgeActivePointerId !== null) {
          endBadgeDrag(true);
        }
      };

      const onBadgeKeyDown = (ev) => {
        if (badgeActivePointerId !== null && ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          endBadgeDrag(true);
        }
      };

      const onBadgePointerDown = (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (e.isPrimary === false) return;

        e.stopPropagation();

        if (badgeActivePointerId !== null) {
          endBadgeDrag(true);
        }

        const target = getTarget();
        const parentRect = target.getBoundingClientRect();
        const badgeRect = this.badge.getBoundingClientRect();

        badgeActivePointerId = e.pointerId;
        this.badgeHasDragged = false;
        badgeStartX = e.clientX;
        badgeStartY = e.clientY;
        badgeInitLeft = badgeRect.left - parentRect.left;
        badgeInitTop = badgeRect.top - parentRect.top;

        try {
          this.badge.setPointerCapture(e.pointerId);
        } catch {}

        window.addEventListener("pointermove", onBadgePointerMove, { capture: true, passive: false });
        window.addEventListener("pointerup", onBadgePointerUp, { capture: true });
        window.addEventListener("mouseup", onBadgePointerUp, { capture: true });
        window.addEventListener("pointercancel", onBadgePointerCancel, { capture: true });
        window.addEventListener("lostpointercapture", onBadgePointerCancel, { capture: true });
        window.addEventListener("keydown", onBadgeKeyDown, { capture: true });
        window.addEventListener("blur", onBadgeBlur, { capture: true });
      };

      this.cleanupBadgeDrag = endBadgeDrag;
      this.badge.addEventListener("pointerdown", onBadgePointerDown);

      // Double click on badge resets to top-right corner
      this.badge.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this.badge.style.top = "14px";
        this.badge.style.right = "14px";
        this.badge.style.left = "auto";
        this.badge.style.bottom = "auto";
        this.badge.style.transform = "none";
        chrome.storage.local.remove("vimiSubBadgePos");
        this.showToast("CC badge reset to top right");
        this.positionMenu();
      });
    }

    setupHoverPause() {
      this.overlay.addEventListener("mouseenter", () => {
        if (!cfg.videoSubAutoPause) return;
        if (!this.video.paused) {
          this.wasPausedByHover = true;
          this.video.pause();
        }
      });

      this.overlay.addEventListener("mouseleave", () => {
        if (!cfg.videoSubAutoPause) return;
        if (this.wasPausedByHover) {
          this.wasPausedByHover = false;
          this.video.play().catch(() => {});
        }
      });
    }

    attachEvents() {
      // Toggle Settings Menu
      this.badge.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.badgeJustDragged || this.badgeHasDragged) {
          this.badgeJustDragged = false;
          this.badgeHasDragged = false;
          return;
        }
        const willOpen = this.menu.classList.contains("vimi-menu-hidden");
        this.menu.classList.toggle("vimi-menu-hidden");
        this.badge.classList.toggle("vimi-sub-badge-active", willOpen);
        if (willOpen) {
          this.positionMenu();
        }
      });

      document.addEventListener("click", (e) => {
        if (!this.menu.contains(e.target) && !this.badge.contains(e.target)) {
          this.menu.classList.add("vimi-menu-hidden");
          this.badge.classList.remove("vimi-sub-badge-active");
        }
      });

      // Window resize / resolution adjustment
      this.boundResize = () => {
        this.loadSavedPositions();
        this.positionMenu();
      };
      window.addEventListener("resize", this.boundResize);

      // Fullscreen change handling
      const handleFullscreen = () => {
        this.mountToContainer();
      };
      document.addEventListener("fullscreenchange", handleFullscreen);
      document.addEventListener("webkitfullscreenchange", handleFullscreen);

      // Continuous timeupdate & state synchronization
      this.video.addEventListener("timeupdate", this.boundTimeUpdate);
      this.video.addEventListener("seeked", this.boundTimeUpdate);
      this.video.addEventListener("pause", this.boundPause);
      this.video.addEventListener("play", this.boundPlay);
      this.video.addEventListener("ended", this.boundEnded);

      // Drag & drop subtitle file directly onto video
      const dropZone = this.container;
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      });
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && (file.name.endsWith(".srt") || file.name.endsWith(".vtt"))) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const cues = parseSubtitles(evt.target?.result || "");
            if (cues.length > 0) {
              this.externalCues = cues;
              this.video.addEventListener("timeupdate", this.boundTimeUpdate);
              this.showToast(`Loaded ${cues.length} subtitles from ${file.name}`);
            }
          };
          reader.readAsText(file);
        }
      });
    }

    // ── Subtitle Detection & Extraction ─────────────────────────────────────
    detectSubtitles() {
      // 1. Check HTML5 TextTracks
      if (this.video.textTracks && this.video.textTracks.length > 0) {
        this.setupTextTracks();
      } else if (this.video.textTracks) {
        this.video.textTracks.onaddtrack = () => this.setupTextTracks();
      }

      // 2. On YouTube, auto-activate captions module if available
      const ytPlayer = document.getElementById("movie_player");
      if (ytPlayer && typeof ytPlayer.getOption === "function") {
        try {
          ytPlayer.loadModule?.("captions");
          const cur = ytPlayer.getOption("captions", "track");
          if (!cur || !cur.languageCode) {
            const list = ytPlayer.getOption("captions", "tracklist");
            if (list && list.length > 0) {
              const def = list.find((t) => t.is_default) || list[0];
              ytPlayer.setOption("captions", "track", def);
              ytPlayer.setOption("captions", "reload", true);
            }
          }
        } catch {}
      }

      // 3. Setup DOM Observers for custom players (YouTube, Udemy, Coursera, Video.js)
      this.setupDomCaptionObserver();
    }

    getAvailableTracks() {
      const list = [];
      if (!this.video.textTracks) return list;
      for (let i = 0; i < this.video.textTracks.length; i++) {
        const t = this.video.textTracks[i];
        if (t.kind === "subtitles" || t.kind === "captions") {
          list.push({
            index: i,
            label: t.label,
            language: t.language,
            selected: t === this.activeTrack || t.mode === "showing" || t.mode === "hidden",
          });
        }
      }
      return list;
    }

    setupTextTracks() {
      const tracks = this.video.textTracks;
      let chosen = null;

      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t.kind === "subtitles" || t.kind === "captions") {
          if (t.mode === "showing") {
            chosen = t;
            break;
          }
          if (!chosen) chosen = t;
        }
      }

      if (chosen) {
        this.attachTrack(chosen);
      }
    }

    selectTrackByIndex(idx) {
      if (!this.video.textTracks || !this.video.textTracks[idx]) return;
      this.attachTrack(this.video.textTracks[idx]);
    }

    attachTrack(track) {
      if (this.activeTrack && this.activeTrack !== track) {
        this.activeTrack.removeEventListener("cuechange", this.boundCueChange);
      }
      this.activeTrack = track;
      if (cfg.videoSubEnabled) {
        track.mode = "hidden";
      } else if (track.mode === "disabled") {
        track.mode = "hidden";
      }
      track.addEventListener("cuechange", this.boundCueChange);
      this.renderMenu();

      // Ensure track elements finish loading
      const trackEls = this.video.querySelectorAll("track");
      trackEls.forEach((el) => {
        if (el.track === track) {
          el.addEventListener("load", () => {
            if (cfg.videoSubEnabled) track.mode = "hidden";
            this.onNativeCueChange();
          });
        }
      });
      this.onNativeCueChange();
    }

    // ── Sticky Subtitle Persistence ─────────────────────────────────────────
    cancelStickyClear() {
      if (this.stickyClearTimer) {
        clearTimeout(this.stickyClearTimer);
        this.stickyClearTimer = null;
      }
    }

    scheduleStickyClear(delay = 6000) {
      if (this.video.paused) return; // NEVER clear while paused!
      if (this.stickyClearTimer) return;
      this.stickyClearTimer = setTimeout(() => {
        if (!this.video.paused) {
          this.handleCueClear();
        }
        this.stickyClearTimer = null;
      }, delay);
    }

    onNativeCueChange() {
      if (!this.activeTrack) return;
      const cues = this.activeTrack.activeCues;
      if (cues && cues.length > 0) {
        const raw = Array.from(cues).map((c) => c.text).join(" ");
        const cleaned = cleanCueText(raw);
        if (cleaned) {
          this.cancelStickyClear();
          this.handleNewCue(cleaned);
          return;
        }
      }
      this.onTimeUpdate();
    }

    onTimeUpdate() {
      let activeText = "";

      // 1. External loaded cues (.srt / .vtt)
      if (this.externalCues && this.externalCues.length > 0) {
        const t = this.video.currentTime;
        const cue = this.externalCues.find((c) => t >= c.start && t <= c.end);
        if (cue) activeText = cue.text;
      } else if (this.activeTrack) {
        // 2. HTML5 TextTrack activeCues & cues list fallback
        const activeCues = this.activeTrack.activeCues;
        if (activeCues && activeCues.length > 0) {
          activeText = Array.from(activeCues).map((c) => c.text).join(" ");
        } else if (this.activeTrack.cues && this.activeTrack.cues.length > 0) {
          const t = this.video.currentTime;
          const cue = Array.from(this.activeTrack.cues).find((c) => t >= c.startTime && t <= c.endTime);
          if (cue) activeText = cue.text;
        }
      }

      const cleaned = cleanCueText(activeText);
      if (cleaned) {
        this.cancelStickyClear();
        this.handleNewCue(cleaned);
      } else {
        // Sticky subtitle: Keep current sentence visible on screen for 6s of silence!
        // Never flash or disappear in conversational gaps between speech.
        if (this.currentCueText && !this.video.paused) {
          this.scheduleStickyClear(6000);
        }
      }
    }

    setupDomCaptionObserver() {
      const captionSelectors = [
        ".ytp-caption-window-container", // YouTube
        ".vjs-text-track-display", // Udemy / Video.js
        ".rc-SubtitleCues", // Coursera
        ".c-video-control-caption", // Coursera
        ".player-timedtext", // Netflix / Generic
        ".plyr__captions", // Plyr
        ".jw-text-track-cue", // JW Player
        '[class*="caption-window"]',
        '[class*="subtitle-cue"]',
      ];

      const findContainer = () => {
        for (const sel of captionSelectors) {
          const el = (this.container || document).querySelector(sel);
          if (el) return el;
        }
        return null;
      };

      const observeContainer = (container) => {
        if (!container) return;
        if (this.domObserver) this.domObserver.disconnect();

        const processBuffer = () => {
          // Extract text from visual lines (YouTube & custom players)
          // Query ONLY top-level visual lines to avoid duplicating text from child segments!
          let collected = [];
          const visualLines = container.querySelectorAll(".caption-visual-line");
          if (visualLines && visualLines.length > 0) {
            visualLines.forEach((line) => {
              const t = cleanCueText(line.textContent || "");
              if (t && !collected.includes(t)) {
                collected.push(t);
              }
            });
          } else {
            const segments = container.querySelectorAll(".ytp-caption-segment, [class*='subtitle-cue'], .vjs-text-track-cue");
            if (segments && segments.length > 0) {
              segments.forEach((seg) => {
                const t = cleanCueText(seg.textContent || "");
                if (t && !collected.includes(t)) {
                  collected.push(t);
                }
              });
            }
          }
          const raw = collected.length > 0 ? collected.join(" ") : (container.innerText || container.textContent || "");
          const text = cleanCueText(raw);

          if (!text) {
            if (this.currentCueText && !this.video.paused) {
              this.scheduleStickyClear(6000);
            }
            return;
          }

          if (text === this.currentCueText) return;

          // ZERO-LATENCY REAL-TIME AUDIO SYNCHRONIZATION:
          // Immediately display to match the speaker's audio with 0ms delay!
          this.handleNewCue(text);
        };

        this.domObserver = new MutationObserver(() => {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => {
            processBuffer();
          }, 35); // 35ms micro-batching for instant audio-subtitle synchronization!
        });

        this.domObserver.observe(container, {
          childList: true,
          subtree: true,
          characterData: true,
        });

        container.classList.add("vimi-hide-native");
      };

      const target = findContainer();
      if (target) {
        observeContainer(target);
      } else {
        const parentObserver = new MutationObserver(() => {
          const found = findContainer();
          if (found) {
            parentObserver.disconnect();
            observeContainer(found);
          }
        });
        parentObserver.observe(this.container || document.body, {
          childList: true,
          subtree: true,
        });
      }
    }

    // ── Cue Display & Full Sentence Rendering ───────────────────────────────
    async handleNewCue(text) {
      if (!text || text === this.currentCueText) return;
      this.cancelStickyClear();
      this.currentCueText = text;

      if (!cfg.videoSubEnabled) return;

      // 1. INSTANT ZERO-LATENCY RENDERING:
      // Show original text immediately so it synchronizes 100% with the audio!
      const cached = cueCache.get(`${cfg.src}:${cfg.tgt}:${text}`);
      this.renderFullSentence(text, cached || this.currentTranslatedText || "");

      if (cached) {
        this.currentTranslatedText = cached;
        return;
      }

      // 2. DEBOUNCE TRANSLATION:
      // Debounce translation by 200ms so we translate full clauses without thrashing the API
      clearTimeout(this.translateDebounceTimer);
      this.translateDebounceTimer = setTimeout(async () => {
        const trans = await translateCue(text);
        if (this.currentCueText === text) {
          this.currentTranslatedText = trans;
          const transEl = this.overlay.querySelector(".vimi-sub-trans");
          if (transEl && cfg.videoSubLayout !== "origOnly") {
            transEl.textContent = trans;
          }
        }
      }, 200);
    }

    handleCueClear() {
      this.cancelStickyClear();
      clearTimeout(this.translateDebounceTimer);
      this.currentCueText = "";
      this.currentTranslatedText = "";
      this.overlay.classList.add("vimi-sub-hidden");
    }

    renderFullSentence(origText, transText) {
      if (!this.overlay) return;
      this.overlay.classList.remove("vimi-sub-hidden");

      const origEl = this.overlay.querySelector(".vimi-sub-orig");
      const transEl = this.overlay.querySelector(".vimi-sub-trans");

      if (cfg.videoSubLayout === "transOnly") {
        if (origEl) origEl.style.display = "none";
        if (transEl) {
          transEl.style.display = "block";
          transEl.textContent = transText || origText;
        }
        return;
      }

      if (cfg.videoSubLayout === "origOnly") {
        if (transEl) transEl.style.display = "none";
        if (origEl) {
          origEl.style.display = "block";
          this.renderWordTokens(origEl, origText);
        }
        return;
      }

      // Bilingual mode: full original sentence on top, full translated sentence below
      if (origEl) {
        origEl.style.display = "block";
        this.renderWordTokens(origEl, origText);
      }
      if (transEl) {
        transEl.style.display = "block";
        transEl.textContent = transText;
      }
    }

    renderWordTokens(container, text) {
      if (container.dataset.renderedText === text) return;
      container.dataset.renderedText = text;
      container.innerHTML = "";
      const tokens = text.split(/([\s,.;:!?()[\]'"]+)/);

      for (const token of tokens) {
        if (!token) continue;
        if (!HAS_LETTER.test(token)) {
          container.appendChild(document.createTextNode(token));
          continue;
        }

        const span = document.createElement("span");
        span.className = "vimi-sub-word";
        span.textContent = token;

        const cleanWord = token.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
        span.dataset.word = cleanWord;

        if (cfg.videoSubHighlightVocab && savedVocabSet.has(cleanWord)) {
          span.classList.add("vimi-sub-saved");
          span.title = "Saved in your Vimi vocabulary";
        }

        span.addEventListener("click", (e) => {
          e.stopPropagation();
          this.handleWordClick(cleanWord, text, span);
        });

        container.appendChild(span);
      }
    }

    renderCueDisplay() {
      if (!cfg.videoSubEnabled || !this.currentCueText) {
        this.overlay.classList.add("vimi-sub-hidden");
        return;
      }
      this.renderFullSentence(this.currentCueText, this.currentTranslatedText);
    }

    highlightSavedWords() {
      if (!this.overlay) return;
      this.overlay.querySelectorAll(".vimi-sub-word").forEach((span) => {
        const word = span.dataset.word;
        if (word && savedVocabSet.has(word)) {
          span.classList.add("vimi-sub-saved");
          span.title = "Saved in your Vimi vocabulary";
        }
      });
    }

    async handleWordClick(word, context, targetSpan) {
      if (!word) return;
      if (!this.video.paused) {
        this.video.pause();
      }

      // Remove any existing lookup popups
      document.querySelectorAll("#vimi-sub-lookup-pop").forEach((p) => p.remove());

      const pop = document.createElement("div");
      pop.id = "vimi-sub-lookup-pop";
      pop.style.cssText = `
        position: absolute; z-index: 2147483647; background: #1e293b; color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 12px; padding: 12px 14px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.6); font-size: 12px; width: 220px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        text-align: left;
      `;

      pop.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
          <b style="font-size: 14px; color: #38bdf8;">${word}</b>
          <button id="vimiPopClose" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 14px;">✕</button>
        </div>
        <div id="vimiPopTrans" style="color: #cbd5e1; margin-bottom: 8px;">Translating...</div>
        <button id="vimiPopSave" style="width: 100%; background: #1a73e8; color: #fff; border: none; border-radius: 6px; padding: 6px; font-weight: 600; cursor: pointer;">
          + Add to Vimi Vocab
        </button>
      `;

      const rect = targetSpan.getBoundingClientRect();
      const parentRect = (document.fullscreenElement || this.container).getBoundingClientRect();
      pop.style.left = `${Math.max(10, rect.left - parentRect.left - 40)}px`;
      pop.style.top = `${Math.max(10, rect.top - parentRect.top - 100)}px`;

      (document.fullscreenElement || this.container).appendChild(pop);

      pop.querySelector("#vimiPopClose").onclick = () => pop.remove();

      let trans = "";
      try {
        trans = await translateCue(word);
        pop.querySelector("#vimiPopTrans").textContent = trans;
      } catch {
        pop.querySelector("#vimiPopTrans").textContent = "Translation unavailable";
      }

      pop.querySelector("#vimiPopSave").onclick = async () => {
        await F.addWord({
          term: word,
          translation: trans,
          src: cfg.src,
          tgt: cfg.tgt,
          context: context,
          url: window.location.href,
        });
        savedVocabSet.add(word);
        targetSpan.classList.add("vimi-sub-saved");
        pop.querySelector("#vimiPopSave").textContent = "Saved ✓";
        pop.querySelector("#vimiPopSave").style.background = "#22c55e";
        setTimeout(() => pop.remove(), 1200);
      };
    }

    destroy() {
      clearTimeout(this.debounceTimer);
      clearTimeout(this.translateDebounceTimer);
      this.cancelStickyClear();
      if (this.cleanupBadgeDrag) this.cleanupBadgeDrag(true);
      if (this.cleanupOverlayDrag) this.cleanupOverlayDrag(true);
      if (this.boundResize) window.removeEventListener("resize", this.boundResize);
      if (this.domObserver) this.domObserver.disconnect();
      if (this.activeTrack) {
        this.activeTrack.removeEventListener("cuechange", this.boundCueChange);
      }
      this.video.removeEventListener("timeupdate", this.boundTimeUpdate);
      this.video.removeEventListener("seeked", this.boundTimeUpdate);
      this.video.removeEventListener("pause", this.boundPause);
      this.video.removeEventListener("play", this.boundPlay);
      this.video.removeEventListener("ended", this.boundEnded);
      this.overlay?.remove();
      this.badge?.remove();
      this.menu?.remove();
      this.fileInput?.remove();
    }
  }

  // ── Global Video Scanner & Lifecycle Manager ─────────────────────────────
  const activeControllers = new Map();

  function isEligibleVideo(v) {
    if (!v) return false;
    // Check if video is visible and not an audio-only / tracking pixel
    const rect = v.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 120 && rect.height > 0 && rect.height < 80) return false;
    return true;
  }

  function registerVideo(video) {
    if (activeControllers.has(video)) return;
    if (!isEligibleVideo(video)) return;

    try {
      const ctrl = new VideoController(video);
      activeControllers.set(video, ctrl);
    } catch (err) {
      console.warn("[Vimi] Failed to attach video subtitles controller:", err);
    }
  }

  function scanVideos() {
    document.querySelectorAll("video").forEach(registerVideo);
  }

  // Watch for newly mounted videos (e.g. SPAs, course lectures, dynamic video players)
  const videoObserver = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length > 0) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) {
            if (n.tagName === "VIDEO" || n.querySelector?.("video")) {
              shouldScan = true;
              break;
            }
          }
        }
      }
      if (m.removedNodes && m.removedNodes.length > 0) {
        for (const n of m.removedNodes) {
          if (n.nodeType === 1) {
            if (n.tagName === "VIDEO" && activeControllers.has(n)) {
              activeControllers.get(n).destroy();
              activeControllers.delete(n);
            } else if (n.querySelectorAll) {
              n.querySelectorAll("video").forEach((v) => {
                if (activeControllers.has(v)) {
                  activeControllers.get(v).destroy();
                  activeControllers.delete(v);
                }
              });
            }
          }
        }
      }
    }
    if (shouldScan) scanVideos();
  });

  videoObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Initial scan
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanVideos);
  } else {
    scanVideos();
  }
})();
