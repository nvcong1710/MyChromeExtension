// Vimi mascot — a cute chibi companion that lives on the page.
// Content script (loaded after store.js + content.js, same isolated world).
//
//  - Shadow DOM so the page's CSS can't touch it (and vice-versa).
//  - Draggable; position persisted (fufuMascotPos).
//  - Autonomous behaviour loop: wanders along the page, naps, and every so
//    often pops a vocabulary reminder bubble (or a friendly line).
//  - Poses swap on events too: think (translating) / happy (saved word).
//  - Click opens a quick menu: toggle translation, Review, Test, Hide.
//
// Pose files live in mascot/vimi-<pose>.png. They can be swapped for animated
// GIFs of the same name without code changes.

(() => {
  if (window.top !== window) return; // top frame only
  if (window.__vimiMascotLoaded) return;

  const F = self.FuFu;
  // walk / talk are animated WebP (4-frame loops); the rest are static.
  const FILES = {
    idle: "vimi-idle.png",
    happy: "vimi-happy.png",
    think: "vimi-think.png",
    sleep: "vimi-sleep.png",
    wave: "vimi-wave.png",
    walk: "vimi-walk.png",
    talk: "vimi-talk.png",
    read: "vimi-read.png",
    point: "vimi-point.png",
    celebrate: "vimi-celebrate.png",
    shy: "vimi-shy.png",
    love: "vimi-love.png",
  };
  const SRC = {};
  Object.entries(FILES).forEach(
    ([k, v]) => (SRC[k] = chrome.runtime.getURL(`mascot/${v}`)),
  );
  // The walk sheet is drawn facing LEFT; flip horizontally to face right.
  const CHAT_POSES = ["talk", "point", "love", "shy"];

  const CHAT = [
    "Keep going! 🌟",
    "Reading something good?",
    "Highlight a word to save it 📚",
    "Need a translation? Click me!",
  ];
  // Random reactions when the user pokes Vimi.
  const POKES = [
    { pose: "love", text: "Hehe~ 💙" },
    { pose: "shy", text: "Eep! Don't poke me 😳" },
    { pose: "happy", text: "Hihi, that tickles!" },
    { pose: "wave", text: "Hi hi! 👋" },
    { pose: "celebrate", text: "Wheee! 🎉" },
    { pose: "think", text: "Hmm? What is it?" },
    { pose: "point", text: "Hey, watch it! 😆" },
  ];

  let host, root, wrapEl, charBox, charImg, bubble, menu;
  let baseline = "idle";
  let facing = 1;
  let busy = false; // performing an autonomous action
  let dragging = false;
  let loopTimer = null;
  let bubbleTimer = null;
  let poseTimer = null;
  let mascotVisible = false; // currently shown on this page
  let boundGlobal = false; // document/window listeners attached once

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // After the extension is reloaded/updated, content scripts on already-open
  // tabs keep running but lose their extension context — any chrome.* call then
  // throws "Extension context invalidated". Detect that and tear down quietly.
  let destroyed = false;
  function contextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }
  function teardown() {
    if (destroyed) return;
    destroyed = true;
    mascotVisible = false;
    clearTimeout(loopTimer);
    clearTimeout(bubbleTimer);
    clearTimeout(poseTimer);
    if (host) host.remove();
  }

  // ── Build (Shadow DOM) ───────────────────────────────────────────────
  function build() {
    host = document.createElement("div");
    host.id = "vimi-host";
    host.style.cssText =
      "position:fixed;z-index:2147483647;pointer-events:none;";
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { position: relative; display: inline-block;
                font: 12.5px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
        .charbox { display: inline-block; }
        .charbox.walking { animation: bob 0.5s ease-in-out infinite; }
        @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .charbox.poked { animation: shake 0.4s ease; }
        @keyframes shake {
          0%,100% { transform: translateX(0) rotate(0); }
          20% { transform: translateX(-4px) rotate(-4deg); }
          50% { transform: translateX(4px) rotate(4deg); }
          80% { transform: translateX(-2px) rotate(-2deg); }
        }
        .char {
          display: block; pointer-events: auto; cursor: grab;
          user-select: none; -webkit-user-drag: none;
          filter: drop-shadow(0 3px 6px rgba(0,0,0,0.25));
        }
        .char:active { cursor: grabbing; }
        /* Size by HEIGHT so every pose shows the character at a consistent
           size regardless of how wide the frame is (walk/talk are wider). */
        .char { height: 116px; width: auto; }
        .char.sleep { height: 92px; }
        .bubble {
          position: absolute; bottom: 100%; right: 0; margin-bottom: 8px;
          background: #fff; color: #202124; padding: 8px 12px; border-radius: 13px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.22); max-width: 200px; width: max-content;
          pointer-events: auto; cursor: pointer; opacity: 0; transform: translateY(8px);
          transition: opacity 0.2s, transform 0.2s;
        }
        .bubble::after { content: ""; position: absolute; top: 100%; right: 18px;
          border: 6px solid transparent; border-top-color: #fff; }
        .bubble.show { opacity: 1; transform: none; }
        .menu { position: absolute; bottom: 4px; right: 100%; margin-right: 8px;
          display: none; flex-direction: column; gap: 6px; width: 148px; pointer-events: auto; }
        .menu.show { display: flex; }
        .menu button { font: 600 12px system-ui, sans-serif; text-align: left;
          padding: 8px 11px; border: none; border-radius: 10px; cursor: pointer;
          background: #fff; color: #202124; box-shadow: 0 3px 10px rgba(0,0,0,0.18); }
        .menu button:hover { background: #eef3fe; }
        .menu .danger { color: #d93025; }
        @media (prefers-color-scheme: dark) {
          .bubble, .menu button { background: #2a2b2e; color: #e8eaed; }
          .bubble::after { border-top-color: #2a2b2e; }
          .menu button:hover { background: #34363a; }
        }
      </style>
      <div class="wrap">
        <div class="bubble" id="bubble"></div>
        <div class="menu" id="menu"></div>
        <div class="charbox" id="charbox"><img class="char idle" id="char" alt="Vimi" /></div>
      </div>`;
    wrapEl = root.querySelector(".wrap");
    charBox = root.getElementById("charbox");
    charImg = root.getElementById("char");
    bubble = root.getElementById("bubble");
    menu = root.getElementById("menu");
  }

  // ── Pose / facing / bubble ─────────────────────────────────────────────
  function setPose(p) {
    if (!SRC[p]) p = "idle";
    charImg.src = SRC[p];
    charImg.className = "char " + p;
    charImg.style.transform = `scaleX(${facing})`; // className reset keeps transform
  }
  function setFacing(dir) {
    facing = dir;
    charImg.style.transform = `scaleX(${dir})`;
  }
  function tempPose(p, ttl = 2500) {
    setPose(p);
    clearTimeout(poseTimer);
    poseTimer = setTimeout(() => setPose(baseline), ttl);
  }
  function say(text, onClick, p, ttl = 4500) {
    bubble.textContent = text;
    bubble.classList.add("show");
    bubble.onclick = () => {
      hideBubble();
      if (onClick) onClick();
    };
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, ttl);
    if (p) tempPose(p, ttl);
  }
  function hideBubble() {
    bubble.classList.remove("show");
  }

  // ── Position + drag ────────────────────────────────────────────────────
  function place(left, top) {
    left = Math.max(0, Math.min(left, window.innerWidth - 70));
    top = Math.max(0, Math.min(top, window.innerHeight - 80));
    host.style.left = left + "px";
    host.style.top = top + "px";
    host.dataset.left = left;
    host.dataset.top = top;
  }
  async function restorePosition() {
    const { fufuMascotPos } = await chrome.storage.local.get("fufuMascotPos");
    if (fufuMascotPos) place(fufuMascotPos.left, fufuMascotPos.top);
    else place(window.innerWidth - 110, window.innerHeight - 150);
  }
  function savePosition() {
    if (!contextAlive()) return;
    try {
      chrome.storage.local.set({
        fufuMascotPos: { left: +host.dataset.left, top: +host.dataset.top },
      });
    } catch {}
  }

  function cancelMotion() {
    // App events can arrive while init() is still waiting for storage, before
    // build() has created the mascot DOM (notably just after an extension
    // reload). Keep cancellation safe during that short lifecycle gap.
    if (host) host.style.transition = "";
    if (charBox) charBox.classList.remove("walking");
    busy = false;
  }

  function mascotReady() {
    return mascotVisible && !destroyed && !!host && !!charBox;
  }

  function bindDrag() {
    let sx, sy, ox, oy, moved;
    charImg.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging = true;
      moved = 0;
      sx = e.clientX;
      sy = e.clientY;
      cancelMotion(); // stop any walk so dragging is snappy
      ox = +host.dataset.left || 0;
      oy = +host.dataset.top || 0;
      charImg.setPointerCapture(e.pointerId);
    });
    charImg.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      place(ox + dx, oy + dy);
    });
    charImg.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      charImg.releasePointerCapture(e.pointerId);
      if (moved < 5) toggleMenu();
      else savePosition();
      scheduleLoop();
    });
  }

  // ── Autonomous behaviour ───────────────────────────────────────────────
  function scheduleLoop() {
    if (destroyed) return;
    clearTimeout(loopTimer);
    const delay = 12000 + Math.random() * 3000; // ~12–15s between events
    loopTimer = setTimeout(runBehavior, delay);
  }

  async function runBehavior() {
    if (destroyed) return;
    if (!contextAlive()) {
      teardown();
      return;
    }
    if (
      dragging ||
      busy ||
      menu.classList.contains("show") ||
      document.hidden
    ) {
      scheduleLoop();
      return;
    }
    try {
      const r = Math.random();
      if (r < 0.04)
        await wander(); // 20% walk
      else if (r < 0.8)
        await remind(); // 65% vocab reminder (mostly)
      else if (r < 0.9)
        await celebrate(); // 7% celebrate
      else await nap(); // 8% nap
    } catch (e) {
      if (!contextAlive()) {
        teardown();
        return;
      }
    }
    scheduleLoop();
  }

  function wander() {
    return new Promise((resolve) => {
      busy = true;
      const cur = +host.dataset.left || 0;
      const margin = 16;
      const maxLeft = Math.max(margin, window.innerWidth - 110);
      let target = margin + Math.random() * (maxLeft - margin);
      if (Math.abs(target - cur) < 90)
        target = cur + (target > cur ? 130 : -130);
      target = Math.max(margin, Math.min(target, maxLeft));
      // Art faces left; flip (scaleX -1) only when heading right.
      setFacing(target > cur ? -1 : 1);
      setPose("walk");
      const dist = Math.abs(target - cur);
      const dur = Math.max(700, Math.round(dist / 0.05)); // ~50 px/s
      host.style.transition = `left ${dur}ms linear`;
      place(target, +host.dataset.top || 0);
      setTimeout(() => {
        cancelMotion();
        setFacing(1);
        setPose(baseline);
        savePosition();
        resolve();
      }, dur + 60);
    });
  }

  async function remind() {
    const vocab = await F.getVocab();
    if (!vocab.length || Math.random() < 0.12) {
      const p = CHAT_POSES[Math.floor(Math.random() * CHAT_POSES.length)];
      say(CHAT[Math.floor(Math.random() * CHAT.length)], null, p, 4000);
      await wait(4000);
      return;
    }
    const due = vocab.filter((w) => (w.due || 0) <= F.now() && w.translation);
    const pool = (due.length ? due : vocab).filter((w) => w.translation);
    const w = pool[Math.floor(Math.random() * pool.length)];
    if (!w) return;
    // Keep the vocab reminder up long enough to read comfortably.
    say(
      `“${w.term}” = ${w.translation}`,
      () => open("review.html"),
      "read",
      10000,
    );
    await wait(10000);
  }

  async function celebrate() {
    say("You're doing great! 🎉", null, "celebrate", 4000);
    await wait(4000);
  }

  async function nap() {
    baseline = "sleep";
    setPose("sleep");
    await wait(6000);
    baseline = "idle";
    setPose("idle");
  }

  // ── Quick menu ───────────────────────────────────────────────────────────
  async function toggleMenu() {
    if (menu.classList.contains("show")) {
      menu.classList.remove("show");
      return;
    }
    if (!contextAlive()) {
      teardown();
      return;
    }
    const due = await F.dueCount();
    const pending = await F.getPendingTest();
    menu.innerHTML = "";
    addMenu("👉 Poke Vimi", poke); // hide menu after poking, like other items
    // Label reflects the tab's current translation state (menu is rebuilt on
    // each open, so it stays in sync).
    const translating = !!window.__vimi?.isOn?.();
    addMenu(
      translating ? "🌐 Show original page" : "🌐 Translate this page",
      () => window.__vimi?.toggle?.(),
    );
    addMenu(`📚 Review${due ? ` (${due})` : ""}`, () => open("review.html"));
    addMenu(pending ? "📝 Take test ●" : "📝 Practice test", () =>
      open("test.html"),
    );
    addMenu(
      "🙈 Hide Vimi",
      async () => {
        // Persist so she stays hidden after reload / on other tabs. Re-enable in
        // Settings → Mascot. (The storage listener removes her from every tab.)
        await F.setConfig({ mascotEnabled: false });
        host.remove();
      },
      true,
    );
    menu.classList.add("show");
  }
  function addMenu(label, fn, danger, keepOpen) {
    const b = document.createElement("button");
    b.textContent = label;
    if (danger) b.className = "danger";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!keepOpen) menu.classList.remove("show");
      fn();
    });
    menu.appendChild(b);
  }

  // Poke reaction: a quick jiggle + a random emotion bubble.
  function poke() {
    cancelMotion();
    charBox.classList.remove("poked");
    void charBox.offsetWidth; // restart the animation
    charBox.classList.add("poked");
    setTimeout(() => charBox.classList.remove("poked"), 450);
    const r = POKES[Math.floor(Math.random() * POKES.length)];
    say(r.text, null, r.pose, 2600);
  }
  function open(page) {
    if (!contextAlive()) return;
    try {
      chrome.runtime.sendMessage({ type: "VIMI_OPEN", page });
    } catch {}
  }

  function bindOutside() {
    document.addEventListener("pointerdown", (e) => {
      if (!menu.classList.contains("show")) return;
      if (e.composedPath && e.composedPath().includes(host)) return;
      menu.classList.remove("show");
    });
    window.addEventListener("resize", () =>
      place(+host.dataset.left, +host.dataset.top),
    );
  }

  // ── App events from content.js ─────────────────────────────────────────
  function bindEvents() {
    window.addEventListener("vimi:event", (e) => {
      if (!mascotReady()) return;
      const d = e.detail || {};
      cancelMotion();
      if (d.say) say(d.say, d.onClick, d.pose || "happy", d.ttl);
      else if (d.pose) tempPose(d.pose, d.ttl);
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "local") return;
      // Show / hide live when the toggle flips (popup panel or Settings).
      if (ch.mascotEnabled) {
        if (ch.mascotEnabled.newValue === false) hideMascot();
        else showMascot();
      }
      // Review/Test finished in another tab → celebrate.
      if (ch.fufuCelebrate && ch.fufuCelebrate.newValue && mascotReady()) {
        cancelMotion();
        say("Great job! 🎉", null, "celebrate", 5000);
      }
    });
  }

  async function greet() {
    const pending = await F.getPendingTest();
    const due = await F.dueCount();
    if (pending)
      say("Your test is ready!", () => open("test.html"), "wave", 6000);
    else if (due > 0)
      say(
        `You have ${due} word(s) to review!`,
        () => open("review.html"),
        "wave",
        6000,
      );
  }

  // ── Show / hide ────────────────────────────────────────────────────────
  async function showMascot() {
    if (mascotVisible || destroyed) return;
    mascotVisible = true;
    window.__vimiMascotLoaded = true;
    build();
    setPose("idle");
    await restorePosition();
    bindDrag();
    if (!boundGlobal) { bindOutside(); boundGlobal = true; } // attach once
    greet();
    scheduleLoop();
  }
  function hideMascot() {
    if (!mascotVisible) return;
    mascotVisible = false;
    clearTimeout(loopTimer);
    clearTimeout(bubbleTimer);
    clearTimeout(poseTimer);
    host?.remove();
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    bindEvents(); // listen even while hidden, so the toggle can show her live
    const cfg = await F.getConfig();
    if (cfg.mascotEnabled !== false) showMascot();
  }

  init();
})();
