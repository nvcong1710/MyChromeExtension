// Review / flashcard study page.
//   default      → words currently due (spaced repetition)
//   ?deck=<id>   → every word in a deck (study/cram a set)
//
// Free navigation: flip back and forth any number of times, go Prev/Next,
// loop around, shuffle, and study the same cards repeatedly in one sitting.
// Grading (Again/Hard/Good/Easy) still updates each word's SM-2 schedule but
// never removes it from the session, so you can keep reviewing.

const F = self.FuFu;
const $ = (id) => document.getElementById(id);

let cards = [];
let idx = 0;
let showBack = false;
let graded = 0;

function speak(text, lang) {
  if (!text) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || "en";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
const cur = () => cards[idx];

function previewDays(word, grade) {
  const c = Object.assign({}, word);
  F.applyGrade(c, grade);
  return c.interval || 1;
}

// Quick Y-flip: rotate edge-on, swap content while invisible, rotate back.
function animate(render) {
  const el = $("flash");
  el.style.transition = "transform .16s ease";
  el.style.transform = "rotateY(90deg)";
  setTimeout(() => { render(); el.style.transform = "rotateY(0deg)"; }, 160);
}

function audioRow() {
  const w = cur();
  return `<button id="pron" title="Pronounce word" class="rounded-full p-2 text-2xl transition hover:bg-slate-100 dark:hover:bg-slate-700">🔊</button>`;
}
function contextBlock() {
  const w = cur();
  if (!w.context) return "";
  return `<div class="mt-1 max-w-lg text-sm italic text-slate-500 dark:text-slate-400">
            “${escapeHtml(w.context)}”
            <button id="readCtx" title="Read the whole sentence" class="ml-1 align-middle rounded-full p-1 text-base transition hover:bg-slate-100 dark:hover:bg-slate-700">🔈</button>
          </div>`;
}
function bindAudio() {
  const w = cur();
  $("pron")?.addEventListener("click", () => speak(w.term, w.src));
  $("readCtx")?.addEventListener("click", () => speak(w.context, w.src));
}

function renderFace() {
  const w = cur();
  $("flash").innerHTML = showBack
    ? `<div class="text-3xl font-bold">${escapeHtml(w.term)}</div>
       <div class="text-2xl font-semibold text-brand-600">${escapeHtml(w.translation || "—")}</div>
       ${audioRow()}${contextBlock()}`
    : `<div class="text-3xl font-bold">${escapeHtml(w.term)}</div>
       ${audioRow()}${contextBlock()}
       <div class="text-xs text-slate-400 dark:text-slate-500">click / Space to flip</div>`;
  bindAudio();
}

function flipToggle() { animate(() => { showBack = !showBack; renderFace(); }); }

function go(delta) {
  const n = cards.length;
  idx = (idx + delta + n) % n; // wrap around → loop forever
  showBack = false;
  updateHeader();
  animate(renderFace);
}

function updateHeader() {
  $("sub").textContent = `${idx + 1} / ${cards.length}`;
  $("bar").style.width = Math.round(((idx + 1) / cards.length) * 100) + "%";
}

async function grade(g) {
  await F.review(cur().id, g);
  graded++;
  go(1); // advance, but the card stays in the deck for repeat study
}

function renderControls() {
  const w = cur();
  const grades = [
    ["again", "Again", "text-red-600 border-red-200 dark:border-red-900"],
    ["hard", "Hard", "text-orange-600 border-orange-200 dark:border-orange-900"],
    ["good", "Good", "text-brand-600 border-brand-200 dark:border-brand-900"],
    ["easy", "Easy", "text-green-600 border-green-200 dark:border-green-900"],
  ];
  $("controls").innerHTML = `
    <div class="flex w-full max-w-lg flex-col items-center gap-3">
      <div class="flex w-full items-center gap-2">
        <button id="prev" class="btn px-4" title="Previous (←)">◀</button>
        <button id="flip" class="btn btn-primary flex-1" title="Flip (Space)">Flip</button>
        <button id="next" class="btn px-4" title="Next (→)">▶</button>
      </div>
      <div class="grid w-full grid-cols-4 gap-2">
        ${grades.map(([g, label, cls]) =>
          `<button data-g="${g}" class="btn flex-col !py-2 ${cls}">
             <span>${label}</span><span class="text-[11px] font-normal opacity-70">${previewDays(w, g)}d</span>
           </button>`).join("")}
      </div>
      <div class="flex gap-4 text-xs">
        <button id="shuffle" class="font-semibold text-brand-600 hover:underline">Shuffle</button>
        <button id="finish" class="text-slate-500 hover:underline dark:text-slate-400">Finish</button>
      </div>
    </div>`;
  $("prev").addEventListener("click", () => go(-1));
  $("next").addEventListener("click", () => go(1));
  $("flip").addEventListener("click", flipToggle);
  $("controls").querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => grade(b.dataset.g)));
  $("shuffle").addEventListener("click", () => { F.shuffle(cards); idx = 0; showBack = false; updateHeader(); animate(renderFace); });
  $("finish").addEventListener("click", finish);
}

function renderCard() {
  updateHeader();
  renderFace();
  renderControls();
}

function finish() {
  if (graded > 0) chrome.storage.local.set({ fufuCelebrate: Date.now() });
  $("flash").style.transform = "";
  $("flash").innerHTML =
    `<div class="text-5xl">🎉</div>
     <div class="text-2xl font-bold text-brand-600">Nice work!</div>
     <div class="max-w-md text-sm text-slate-500 dark:text-slate-400">You graded ${graded} card(s) this session.</div>`;
  $("controls").innerHTML =
    `<div class="flex gap-2">
       <button id="again" class="btn btn-primary">Study again</button>
       <button id="closeBtn" class="btn">Close</button>
     </div>`;
  $("again").addEventListener("click", () => { graded = 0; idx = 0; showBack = false; F.shuffle(cards); renderCard(); });
  $("closeBtn").addEventListener("click", () => window.close());
  $("sub").textContent = "Done";
  $("bar").style.width = "100%";
}

document.addEventListener("keydown", (e) => {
  if (!cards.length) return;
  if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); flipToggle(); }
  else if (e.code === "ArrowLeft") go(-1);
  else if (e.code === "ArrowRight") go(1);
  else if (["1", "2", "3", "4"].includes(e.key)) grade(["again", "hard", "good", "easy"][+e.key - 1]);
});

// Let clicking the card flip it too.
$("flash").addEventListener("click", (e) => { if (!e.target.closest("button")) flipToggle(); });

function empty(msg) {
  $("flash").innerHTML = `<div class="text-2xl font-bold text-brand-600">All caught up!</div>
    <div class="max-w-md text-sm text-slate-500 dark:text-slate-400">${msg}</div>`;
  $("controls").innerHTML = `<button id="closeBtn" class="btn btn-primary">Close</button>`;
  $("closeBtn").addEventListener("click", () => window.close());
  $("bar").style.width = "100%";
}

(async function start() {
  const deckId = new URLSearchParams(location.search).get("deck");
  if (deckId) {
    cards = await F.getDeckWords(deckId);
    const deck = (await F.getDecks()).find((d) => d.id === deckId);
    $("title").textContent = "Flashcard deck";
    if (deck) $("sub").textContent = deck.name;
    if (!cards.length) return empty("This deck has no words yet.");
  } else {
    cards = await F.dueWords();
    if (!cards.length) return empty("No words are due right now. Study a deck to review anytime.");
  }
  F.shuffle(cards);
  renderCard();
})();
