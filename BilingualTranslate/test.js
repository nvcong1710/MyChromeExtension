// Test page. Loads the pending test (created on schedule by the service
// worker), renders MCQ + typing questions with a live progress bar, grades on
// submit, and shows the result. If no test is pending, offers a practice test.

const F = self.FuFu;
const $ = (id) => document.getElementById(id);
const body = $("body");
let activeTest = null;

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function dirLabel(d, src, tgt) {
  return d === "t2m" ? `Translate ${src} → ${tgt}` : `Translate ${tgt} → ${src}`;
}

function renderEmpty(cfg) {
  const next = cfg.nextTestAt ? new Date(cfg.nextTestAt).toLocaleString() : "not scheduled";
  body.innerHTML = `
    <section class="card text-center">
      <h2 class="mb-1 text-lg font-bold">No test waiting</h2>
      <p class="mb-4 text-sm text-slate-500 dark:text-slate-400">Your next scheduled test: <b>${escapeHtml(next)}</b>.</p>
      <button class="btn btn-primary" id="practice">Start a practice test now</button>
    </section>`;
  $("practice").addEventListener("click", async () => {
    const t = await F.createTestNow();
    if (!t) {
      body.innerHTML = `<section class="card text-center"><h2 class="mb-1 text-lg font-bold">Not enough vocabulary</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">Save some words first, then come back.</p></section>`;
      return;
    }
    renderTest(t);
  });
}

function renderTest(t) {
  activeTest = t;
  $("sub").textContent = `${t.questions.length} questions`;
  $("progressBar").classList.remove("hidden");

  const qs = t.questions.map((q, i) => {
    const head = `<div class="font-semibold">${i + 1}. ${escapeHtml(q.prompt)}</div>
      <div class="mb-2.5 text-[11.5px] text-slate-500 dark:text-slate-400">${dirLabel(q.direction, t.src, t.tgt)}</div>`;
    if (q.type === "mcq") {
      const opts = q.options.map((o) =>
        `<label class="opt flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 hover:bg-brand-50/60 dark:border-slate-700 dark:hover:bg-slate-700/40">
           <input type="radio" name="q${i}" value="${escapeHtml(o)}" class="accent-brand-600" />
           <span>${escapeHtml(o)}</span>
         </label>`).join("");
      return `<div class="q mb-5" data-i="${i}">${head}<div class="flex flex-col gap-2">${opts}</div>
        <div class="verdict mt-1.5 text-xs" id="v${i}"></div></div>`;
    }
    return `<div class="q mb-5" data-i="${i}">${head}
      <input class="typing input" name="q${i}" autocomplete="off" placeholder="Type your answer…" />
      <div class="verdict mt-1.5 text-xs" id="v${i}"></div></div>`;
  }).join("");

  body.innerHTML = `
    <section class="card">${qs}</section>
    <div class="mt-5 flex justify-center"><button class="btn btn-primary" id="submit">Submit test</button></div>`;

  body.querySelectorAll('input[type="radio"], input.typing').forEach((el) =>
    el.addEventListener("input", updateProgress)
  );
  $("submit").addEventListener("click", () => submit(t));
  updateProgress();
}

function answeredCount(t) {
  let n = 0;
  t.questions.forEach((q, i) => {
    if (document.querySelector(`[name="q${i}"]:checked`)) n++;
    else {
      const inp = document.querySelector(`input.typing[name="q${i}"]`);
      if (inp && inp.value.trim()) n++;
    }
  });
  return n;
}
function updateProgress() {
  if (!activeTest) return;
  const n = answeredCount(activeTest), total = activeTest.questions.length;
  $("progressText").textContent = `${n} / ${total} answered`;
  $("progressFill").style.width = Math.round((n / total) * 100) + "%";
}

function readAnswers(t) {
  const answers = {};
  t.questions.forEach((q, i) => {
    const checked = document.querySelector(`[name="q${i}"]:checked`);
    if (checked) answers[q.id] = checked.value;
    else {
      const input = document.querySelector(`input.typing[name="q${i}"]`);
      if (input) answers[q.id] = input.value;
    }
  });
  return answers;
}

async function submit(t) {
  const result = await F.completeTest(readAnswers(t));
  const graded = await F.getTest();

  graded.questions.forEach((q, i) => {
    const v = $("v" + i);
    if (q.correct) { v.textContent = "Correct"; v.className = "verdict mt-1.5 text-xs text-green-600"; }
    else { v.textContent = `Answer: ${q.answer}`; v.className = "verdict mt-1.5 text-xs text-red-600"; }
    if (q.type === "mcq") {
      document.querySelectorAll(`[data-i="${i}"] .opt`).forEach((opt) => {
        const val = opt.querySelector("input").value;
        if (val === q.answer) opt.classList.add("!border-green-500", "bg-green-50", "dark:bg-green-900/20");
        else if (val === q.given && !q.correct) opt.classList.add("!border-red-500", "bg-red-50", "dark:bg-red-900/20");
        opt.querySelector("input").disabled = true;
      });
    } else {
      const input = document.querySelector(`input.typing[name="q${i}"]`);
      if (input) input.disabled = true;
    }
  });

  const pct = Math.round((result.correct / result.total) * 100);
  const banner = document.createElement("section");
  banner.className = "card mb-5 text-center";
  banner.innerHTML = `
    <div class="text-4xl font-extrabold text-brand-600">${result.correct}/${result.total}</div>
    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">You scored ${pct}%. Great work!</p>
    <button class="btn mt-3" id="closeBtn">Close</button>`;
  body.prepend(banner);
  banner.querySelector("#closeBtn").addEventListener("click", () => window.close());
  $("submit").disabled = true;
  $("sub").textContent = `Score ${result.correct}/${result.total}`;
  $("progressFill").style.width = "100%";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

(async function start() {
  const pending = await F.getPendingTest();
  if (pending) renderTest(pending);
  else renderEmpty(await F.getConfig());
})();
