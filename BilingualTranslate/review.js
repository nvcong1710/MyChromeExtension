// Review page — SM-2 flashcard session over all due words.
// Show the term → user recalls → reveal translation/context → grade
// Again/Hard/Good/Easy, which reschedules the word via store.js.

const F = self.FuFu;
const $ = (id) => document.getElementById(id);

let queue = [];
let total = 0;
let done = 0;
let current = null;
let revealed = false;

function speak(text, lang) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
}

function setBar() {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("bar").style.width = pct + "%";
}

function finish() {
  // Signal the mascot (on other tabs) to celebrate a completed session.
  if (done > 0) chrome.storage.local.set({ fufuCelebrate: Date.now() });
  $("cardArea").innerHTML =
    `<div class="flash center"><div class="term">🎉</div>` +
    `<div class="trans">All caught up!</div>` +
    `<div class="context">You reviewed ${done} word(s). Come back when more are due.</div></div>`;
  $("controls").innerHTML =
    `<button class="btn btn-primary" id="closeBtn">Close</button>`;
  $("closeBtn").addEventListener("click", () => window.close());
  $("sub").textContent = "Done";
  $("bar").style.width = "100%";
}

function renderFront() {
  revealed = false;
  $("flash").innerHTML =
    `<div class="term">${escapeHtml(current.term)}</div>` +
    `<button class="pron" id="pron" title="Pronounce">🔊</button>` +
    `<div class="context">${escapeHtml(current.context || "")}</div>`;
  $("pron").addEventListener("click", () => speak(current.term, current.src));
  $("controls").innerHTML =
    `<button class="btn btn-primary" id="show">Show answer</button>`;
  $("show").addEventListener("click", renderBack);
}

function renderBack() {
  revealed = true;
  $("flash").innerHTML =
    `<div class="term">${escapeHtml(current.term)}</div>` +
    `<div class="trans">${escapeHtml(current.translation || "—")}</div>` +
    `<button class="pron" id="pron" title="Pronounce">🔊</button>` +
    `<div class="context">${escapeHtml(current.context || "")}</div>`;
  $("pron").addEventListener("click", () => speak(current.term, current.src));
  $("controls").innerHTML =
    `<div class="grade-row" style="width:100%;max-width:480px;">
       <button class="btn g-again" data-g="again">Again</button>
       <button class="btn g-hard" data-g="hard">Hard</button>
       <button class="btn g-good" data-g="good">Good</button>
       <button class="btn g-easy" data-g="easy">Easy</button>
     </div>`;
  $("controls").querySelectorAll("[data-g]").forEach((b) => {
    b.addEventListener("click", () => grade(b.dataset.g));
  });
}

async function grade(g) {
  await F.review(current.id, g);
  done++;
  setBar();
  next();
}

function next() {
  current = queue.shift();
  if (!current) { finish(); return; }
  $("sub").textContent = `${done + 1} of ${total}`;
  renderFront();
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

// Keyboard: space reveals; 1-4 grade.
document.addEventListener("keydown", (e) => {
  if (!current) return;
  if (!revealed && (e.code === "Space" || e.code === "Enter")) {
    e.preventDefault();
    renderBack();
  } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
    grade(["again", "hard", "good", "easy"][+e.key - 1]);
  }
});

(async function start() {
  queue = await F.dueWords();
  F.shuffle(queue);
  total = queue.length;
  if (!total) { finish(); return; }
  next();
})();
