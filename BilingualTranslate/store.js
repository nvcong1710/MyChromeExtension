// store.js — shared data layer for FuFu Bilingual.
//
// Loaded in three contexts: the service worker (importScripts), the content
// script (manifest content_scripts, before content.js), and extension pages
// (popup/options/review/test via <script src>). It only touches chrome.storage
// and pure logic — no DOM — so it is safe everywhere. Everything hangs off
// self.FuFu.
//
// Storage keys:
//   fufuConfig  — settings object (languages, goal, reminder, test schedule)
//   fufuVocab   — array of saved word objects (with SM-2 fields)
//   fufuHosts   — { hostname: true } sites with auto-translate on
//   fufuTest    — the current/last test (pending until the user completes it)
//   fufuLastReminder — date string of the last daily reminder shown

(() => {
  const DAY = 86400000;

  const DEFAULT_CONFIG = {
    src: "en",
    tgt: "vi",
    dailyGoal: 10, // words/day target (progress display)
    reminderEnabled: true,
    reminderHour: 20, // 24h; daily review nudge + test creation hour
    testEnabled: true,
    testFreq: "weekly", // daily | every3 | weekly | biweekly
    testWeekday: 0, // 0=Sun … 6=Sat (used for weekly/biweekly)
    testQuestionCount: 10, // 10 | 20 | 30
    testType: "mixed", // mcq | typing | mixed
    lastTestAt: 0,
    nextTestAt: 0,
    mascotEnabled: true, // show the Vimi mascot on pages
  };

  const now = () => Date.now();
  const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 8);

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── Config ──────────────────────────────────────────────────────────
  async function getConfig() {
    const { fufuConfig } = await chrome.storage.local.get("fufuConfig");
    return Object.assign({}, DEFAULT_CONFIG, fufuConfig || {});
  }
  async function setConfig(patch) {
    const next = Object.assign(await getConfig(), patch);
    await chrome.storage.local.set({ fufuConfig: next });
    return next;
  }

  // ── Per-site auto-translate hosts ───────────────────────────────────
  async function getHosts() {
    const { fufuHosts } = await chrome.storage.local.get("fufuHosts");
    return fufuHosts && typeof fufuHosts === "object" ? fufuHosts : {};
  }
  async function setHostEnabled(host, on) {
    const hosts = await getHosts();
    if (on) hosts[host] = true;
    else delete hosts[host];
    await chrome.storage.local.set({ fufuHosts: hosts });
    return hosts;
  }

  // ── Vocabulary ──────────────────────────────────────────────────────
  async function getVocab() {
    const { fufuVocab } = await chrome.storage.local.get("fufuVocab");
    return Array.isArray(fufuVocab) ? fufuVocab : [];
  }
  async function setVocab(list) {
    await chrome.storage.local.set({ fufuVocab: list });
  }

  async function addWord({ term, translation, src, tgt, context, url }) {
    term = (term || "").trim();
    if (!term) return null;
    const cfg = await getConfig();
    src = src || cfg.src;
    tgt = tgt || cfg.tgt;
    const list = await getVocab();
    const existing = list.find(
      (w) => w.term.toLowerCase() === term.toLowerCase() && w.tgt === tgt
    );
    if (existing) {
      if (!existing.translation && translation) existing.translation = translation;
      if (!existing.context && context) existing.context = context;
      await setVocab(list);
      return existing;
    }
    const w = {
      id: uid(),
      term,
      translation: (translation || "").trim(),
      src,
      tgt,
      context: context || "",
      url: url || "",
      createdAt: now(),
      ease: 2.5,
      interval: 0,
      reps: 0,
      lapses: 0,
      due: now(), // due immediately so it enters review today
      status: "new",
    };
    list.push(w);
    await setVocab(list);
    await recordActivity("added");
    return w;
  }

  async function deleteWord(id) {
    const list = (await getVocab()).filter((w) => w.id !== id);
    await setVocab(list);
  }
  async function updateWord(id, patch) {
    const list = await getVocab();
    const w = list.find((x) => x.id === id);
    if (w) Object.assign(w, patch);
    await setVocab(list);
  }

  // ── Flashcard decks ─────────────────────────────────────────────────
  // A deck is a named set of word ids the user groups for focused study.
  async function getDecks() {
    const { fufuDecks } = await chrome.storage.local.get("fufuDecks");
    return Array.isArray(fufuDecks) ? fufuDecks : [];
  }
  async function setDecks(list) {
    await chrome.storage.local.set({ fufuDecks: list });
  }
  async function createDeck(name, wordIds) {
    const decks = await getDecks();
    const deck = {
      id: uid(),
      name: (name || "Untitled deck").trim(),
      wordIds: Array.from(new Set(wordIds || [])),
      createdAt: now(),
    };
    decks.push(deck);
    await setDecks(decks);
    return deck;
  }
  async function updateDeck(id, patch) {
    const decks = await getDecks();
    const d = decks.find((x) => x.id === id);
    if (d) Object.assign(d, patch);
    await setDecks(decks);
  }
  async function deleteDeck(id) {
    await setDecks((await getDecks()).filter((d) => d.id !== id));
  }
  async function getDeckWords(id) {
    const decks = await getDecks();
    const deck = decks.find((d) => d.id === id);
    if (!deck) return [];
    const vocab = await getVocab();
    const byId = new Map(vocab.map((w) => [w.id, w]));
    return deck.wordIds.map((wid) => byId.get(wid)).filter(Boolean);
  }

  // ── SM-2 spaced repetition ──────────────────────────────────────────
  // grade: 'again' | 'hard' | 'good' | 'easy'
  function applyGrade(w, grade) {
    const q = { again: 1, hard: 3, good: 4, easy: 5 }[grade] ?? 4;
    if (q < 3) {
      w.reps = 0;
      w.interval = 1;
      w.lapses = (w.lapses || 0) + 1;
      w.status = "learning";
    } else {
      w.reps = (w.reps || 0) + 1;
      if (w.reps === 1) w.interval = 1;
      else if (w.reps === 2) w.interval = 6;
      else w.interval = Math.round((w.interval || 1) * (w.ease || 2.5));
      w.status = w.interval >= 21 ? "mastered" : "learning";
    }
    const ease = (w.ease || 2.5) + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    w.ease = Math.max(1.3, ease);
    w.due = now() + w.interval * DAY;
    w.lastReview = now();
    return w;
  }
  async function review(id, grade) {
    const list = await getVocab();
    const w = list.find((x) => x.id === id);
    if (!w) return;
    applyGrade(w, grade);
    await setVocab(list);
    await recordActivity("review");
  }
  async function dueWords() {
    const t = now();
    return (await getVocab()).filter((w) => (w.due || 0) <= t);
  }
  async function dueCount() {
    return (await dueWords()).length;
  }
  async function learnedSince(ts) {
    return (await getVocab()).filter((w) => (w.createdAt || 0) >= ts);
  }

  // ── Activity / streak / stats ───────────────────────────────────────
  const DAYMS = 86400000;
  function toDayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  async function getActivity() {
    const { fufuActivity } = await chrome.storage.local.get("fufuActivity");
    return fufuActivity && typeof fufuActivity === "object" ? fufuActivity : {};
  }
  async function recordActivity(kind) {
    const a = await getActivity();
    const k = toDayKey(now());
    a[k] = a[k] || { reviews: 0, added: 0 };
    if (kind === "review") a[k].reviews++;
    else if (kind === "added") a[k].added++;
    await chrome.storage.local.set({ fufuActivity: a });
  }
  function activeOn(a, key) {
    const e = a[key];
    return !!(e && (e.reviews || 0) + (e.added || 0) > 0);
  }
  // Current streak: consecutive active days ending today (or yesterday, so a
  // streak isn't shown as broken until a full day is actually missed).
  function streakFrom(a) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    let t = start.getTime();
    if (!activeOn(a, toDayKey(t))) {
      t -= DAYMS;
      if (!activeOn(a, toDayKey(t))) return 0;
    }
    let streak = 0;
    while (activeOn(a, toDayKey(t))) { streak++; t -= DAYMS; }
    return streak;
  }
  function bestStreakFrom(a) {
    const days = Object.keys(a).filter((k) => activeOn(a, k)).sort();
    let best = 0, run = 0, prev = null;
    for (const k of days) {
      const t = new Date(k + "T00:00:00").getTime();
      run = prev !== null && t - prev === DAYMS ? run + 1 : 1;
      best = Math.max(best, run);
      prev = t;
    }
    return best;
  }
  async function getStreak() { return streakFrom(await getActivity()); }
  async function getStats() {
    const vocab = await getVocab();
    const a = await getActivity();
    const cfg = await getConfig();
    const t = now();
    const byStatus = { new: 0, learning: 0, mastered: 0 };
    vocab.forEach((w) => { const s = w.status || "new"; if (byStatus[s] !== undefined) byStatus[s]++; });
    const todayA = a[toDayKey(t)] || { reviews: 0, added: 0 };
    let reviewsTotal = 0;
    Object.values(a).forEach((e) => (reviewsTotal += e.reviews || 0));
    const last14 = [];
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const dk = toDayKey(d0.getTime() - i * DAYMS);
      const e = a[dk] || {};
      last14.push({ day: dk, count: (e.reviews || 0) + (e.added || 0) });
    }
    return {
      total: vocab.length, byStatus,
      due: vocab.filter((w) => (w.due || 0) <= t).length,
      reviewsToday: todayA.reviews || 0, addedToday: todayA.added || 0, reviewsTotal,
      streak: streakFrom(a), best: bestStreakFrom(a),
      last14, dailyGoal: cfg.dailyGoal, nextTestAt: cfg.nextTestAt,
    };
  }

  // ── Test scheduling ─────────────────────────────────────────────────
  function computeNextTest(from, cfg) {
    const d = new Date(from);
    d.setHours(cfg.reminderHour || 20, 0, 0, 0);
    if (cfg.testFreq === "daily") return d.getTime() + DAY;
    if (cfg.testFreq === "every3") return d.getTime() + 3 * DAY;
    const span = cfg.testFreq === "biweekly" ? 14 : 7;
    let add = ((cfg.testWeekday - d.getDay()) + 7) % 7;
    if (add === 0) add = span; // not today — push to the next cycle
    return d.getTime() + add * DAY;
  }
  async function ensureSchedule() {
    const cfg = await getConfig();
    if (!cfg.nextTestAt) {
      await setConfig({ nextTestAt: computeNextTest(now(), cfg) });
    }
  }

  // ── Test generation / lifecycle ─────────────────────────────────────
  async function getTest() {
    const { fufuTest } = await chrome.storage.local.get("fufuTest");
    return fufuTest || null;
  }
  async function getPendingTest() {
    const t = await getTest();
    return t && t.status === "pending" ? t : null;
  }
  async function setTest(t) {
    await chrome.storage.local.set({ fufuTest: t });
  }

  function buildQuestions(words, allWords, count, type) {
    const pool = shuffle(words.filter((w) => w.translation && w.term));
    const picked = pool.slice(0, count);
    const distract = allWords.filter((w) => w.translation && w.term);
    return picked.map((w, i) => {
      const t2m = i % 2 === 0; // alternate direction
      const typing =
        type === "typing" || (type === "mixed" && i % 2 === 1);
      const answer = t2m ? w.translation : w.term;
      const q = {
        id: w.id,
        prompt: t2m ? w.term : w.translation,
        answer,
        direction: t2m ? "t2m" : "m2t",
        type: typing ? "typing" : "mcq",
      };
      if (!typing) {
        const others = shuffle(distract.filter((x) => x.id !== w.id))
          .map((x) => (t2m ? x.translation : x.term))
          .filter((v) => v && v !== answer);
        q.options = shuffle([answer, ...others.slice(0, 3)]);
      }
      return q;
    });
  }

  // Create a test from words learned since the last test. Falls back to all
  // vocab if nothing new was added in the period.
  async function createTestNow() {
    const cfg = await getConfig();
    const all = await getVocab();
    const since = cfg.lastTestAt || now() - 7 * DAY;
    let learned = all.filter((w) => (w.createdAt || 0) >= since);
    if (learned.length < 1) learned = all;
    const questions = buildQuestions(
      learned,
      all,
      cfg.testQuestionCount,
      cfg.testType
    );
    if (!questions.length) return null;
    const t = {
      id: uid(),
      createdAt: now(),
      status: "pending",
      count: questions.length,
      questions,
      src: cfg.src,
      tgt: cfg.tgt,
    };
    await setTest(t);
    return t;
  }

  // Grade the answers and reschedule the next test.
  async function completeTest(answers) {
    const t = await getTest();
    if (!t) return null;
    let correct = 0;
    const norm = (s) => (s || "").trim().toLowerCase();
    for (const q of t.questions) {
      q.given = answers[q.id] || "";
      q.correct = norm(q.given) === norm(q.answer);
      if (q.correct) correct++;
    }
    t.status = "done";
    t.score = correct;
    t.doneAt = now();
    await setTest(t);
    const cfg = await getConfig();
    await setConfig({
      lastTestAt: now(),
      nextTestAt: computeNextTest(now(), cfg),
    });
    await chrome.storage.local.set({ fufuCelebrate: now() }); // mascot cheer
    return { correct, total: t.questions.length };
  }

  self.FuFu = {
    DAY,
    now,
    uid,
    shuffle,
    getConfig,
    setConfig,
    getHosts,
    setHostEnabled,
    getVocab,
    setVocab,
    addWord,
    deleteWord,
    updateWord,
    getDecks,
    createDeck,
    updateDeck,
    deleteDeck,
    getDeckWords,
    applyGrade,
    review,
    dueWords,
    dueCount,
    learnedSince,
    recordActivity,
    getActivity,
    getStreak,
    getStats,
    computeNextTest,
    ensureSchedule,
    getTest,
    getPendingTest,
    setTest,
    buildQuestions,
    createTestNow,
    completeTest,
  };
})();
