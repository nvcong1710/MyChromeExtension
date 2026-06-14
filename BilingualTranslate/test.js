// Test page. Loads the pending test (created on schedule by the service
// worker), renders MCQ + typing questions, grades on submit, and shows the
// result. If no test is pending, offers to start a practice test now.

const F = self.FuFu;
const $ = (id) => document.getElementById(id);
const body = $("body");

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function dirLabel(d, src, tgt) {
  return d === "t2m"
    ? `Translate from ${src} → ${tgt}`
    : `Translate from ${tgt} → ${src}`;
}

function renderEmpty(cfg) {
  const next = cfg.nextTestAt
    ? new Date(cfg.nextTestAt).toLocaleString()
    : "not scheduled";
  body.innerHTML = `
    <section class="card center">
      <h2>No test waiting</h2>
      <p class="desc">Your next scheduled test: <b>${escapeHtml(next)}</b>.</p>
      <div class="row" style="justify-content:center;">
        <button class="btn btn-primary" id="practice">Start a practice test now</button>
      </div>
    </section>`;
  $("practice").addEventListener("click", async () => {
    const t = await F.createTestNow();
    if (!t) {
      body.innerHTML = `<section class="card center"><h2>Not enough vocabulary</h2>
        <p class="desc">Save some words first (highlight text on any page), then come back.</p></section>`;
      return;
    }
    renderTest(t);
  });
}

function renderTest(t) {
  $("sub").textContent = `${t.questions.length} questions`;
  const qs = t.questions
    .map((q, i) => {
      const head = `<div class="q-prompt">${i + 1}. ${escapeHtml(q.prompt)}</div>
        <div class="q-dir">${dirLabel(q.direction, t.src, t.tgt)}</div>`;
      if (q.type === "mcq") {
        const opts = q.options
          .map(
            (o, k) => `<label class="opt"><input type="radio" name="q${i}" value="${escapeHtml(o)}" />
              <span>${escapeHtml(o)}</span></label>`
          )
          .join("");
        return `<div class="q" data-i="${i}">${head}<div class="opts">${opts}</div>
          <div class="verdict" id="v${i}"></div></div>`;
      }
      return `<div class="q" data-i="${i}">${head}
        <input class="typing" name="q${i}" autocomplete="off" placeholder="Type your answer…" />
        <div class="verdict" id="v${i}"></div></div>`;
    })
    .join("");

  body.innerHTML = `
    <section class="card">${qs}</section>
    <div class="row" style="justify-content:center;">
      <button class="btn btn-primary" id="submit">Submit test</button>
    </div>`;

  $("submit").addEventListener("click", () => submit(t));
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
  const answers = readAnswers(t);
  const result = await F.completeTest(answers);
  const graded = await F.getTest(); // has per-question correctness now

  // Annotate each question with verdict + correct option highlight.
  graded.questions.forEach((q, i) => {
    const v = $("v" + i);
    if (q.correct) {
      v.textContent = "Correct";
      v.className = "verdict ok";
    } else {
      v.textContent = `Answer: ${q.answer}`;
      v.className = "verdict no";
    }
    if (q.type === "mcq") {
      document.querySelectorAll(`[data-i="${i}"] .opt`).forEach((opt) => {
        const val = opt.querySelector("input").value;
        if (val === q.answer) opt.classList.add("correct");
        else if (val === q.given && !q.correct) opt.classList.add("wrong");
        opt.querySelector("input").disabled = true;
      });
    } else {
      const input = document.querySelector(`input.typing[name="q${i}"]`);
      if (input) input.disabled = true;
    }
  });

  const pct = Math.round((result.correct / result.total) * 100);
  const banner = document.createElement("section");
  banner.className = "card center";
  banner.innerHTML = `
    <div class="score-big">${result.correct}/${result.total}</div>
    <p class="desc">You scored ${pct}%. Great work!</p>
    <div class="row" style="justify-content:center;">
      <button class="btn" id="closeBtn">Close</button>
    </div>`;
  body.prepend(banner);
  banner.querySelector("#closeBtn").addEventListener("click", () => window.close());
  $("submit").disabled = true;
  $("sub").textContent = `Score ${result.correct}/${result.total}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

(async function start() {
  const pending = await F.getPendingTest();
  if (pending) renderTest(pending);
  else renderEmpty(await F.getConfig());
})();
