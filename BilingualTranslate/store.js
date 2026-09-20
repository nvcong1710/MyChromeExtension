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
    transColor: "", // custom translation text color ("" = theme default)
    // ── Reading aids (in-page, opt-in) ──
    highlightSaved: false, // underline words you've saved when you meet them again
    inlineLearn: false, // "sprinkle": swap a few saved words for their translation
    revealMode: false, // hide full-page translations until you hover the original
    // ── Video bilingual subtitles ──
    videoSubEnabled: true, // auto-detect video subtitles and show bilingual overlay
    videoSubLayout: "bilingual", // bilingual | transOnly | origOnly
    videoSubSize: "md", // sm | md | lg | xl
    videoSubAutoPause: false, // auto-pause video when hovering subtitle (study mode)
    videoSubHighlightVocab: true, // highlight saved vocabulary in subtitles
  };

  const POPULAR_LANGUAGES = [
    ["en", "English"],
    ["vi", "Vietnamese"],
    ["zh", "Chinese (Simplified)"],
    ["zh-TW", "Chinese (Traditional)"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["es", "Spanish"],
    ["fr", "French"],
    ["de", "German"],
    ["ru", "Russian"],
    ["pt", "Portuguese"],
    ["it", "Italian"],
    ["ar", "Arabic"],
    ["hi", "Hindi"],
    ["id", "Indonesian"],
    ["th", "Thai"],
  ];

  const LANGUAGES = [
    ["af", "Afrikaans"],
    ["sq", "Albanian"],
    ["am", "Amharic"],
    ["ar", "Arabic"],
    ["hy", "Armenian"],
    ["as", "Assamese"],
    ["ay", "Aymara"],
    ["az", "Azerbaijani"],
    ["bm", "Bambara"],
    ["eu", "Basque"],
    ["be", "Belarusian"],
    ["bn", "Bengali"],
    ["bho", "Bhojpuri"],
    ["bs", "Bosnian"],
    ["bg", "Bulgarian"],
    ["ca", "Catalan"],
    ["ceb", "Cebuano"],
    ["ny", "Chicheewa"],
    ["zh", "Chinese (Simplified)"],
    ["zh-TW", "Chinese (Traditional)"],
    ["co", "Corsican"],
    ["hr", "Croatian"],
    ["cs", "Czech"],
    ["da", "Danish"],
    ["dv", "Dhivehi"],
    ["doi", "Dogri"],
    ["nl", "Dutch"],
    ["en", "English"],
    ["eo", "Esperanto"],
    ["et", "Estonian"],
    ["ee", "Ewe"],
    ["tl", "Filipino (Tagalog)"],
    ["fi", "Finnish"],
    ["fr", "French"],
    ["fy", "Frisian"],
    ["gl", "Galician"],
    ["ka", "Georgian"],
    ["de", "German"],
    ["el", "Greek"],
    ["gn", "Guarani"],
    ["gu", "Gujarati"],
    ["ht", "Haitian Creole"],
    ["ha", "Hausa"],
    ["haw", "Hawaiian"],
    ["he", "Hebrew"],
    ["hi", "Hindi"],
    ["hmn", "Hmong"],
    ["hu", "Hungarian"],
    ["is", "Icelandic"],
    ["ig", "Igbo"],
    ["ilo", "Ilocano"],
    ["id", "Indonesian"],
    ["ga", "Irish"],
    ["it", "Italian"],
    ["ja", "Japanese"],
    ["jw", "Javanese"],
    ["kn", "Kannada"],
    ["kk", "Kazakh"],
    ["km", "Khmer"],
    ["rw", "Kinyarwanda"],
    ["gom", "Konkani"],
    ["ko", "Korean"],
    ["kri", "Krio"],
    ["ku", "Kurdish (Kurmanji)"],
    ["ckb", "Kurdish (Sorani)"],
    ["ky", "Kyrgyz"],
    ["lo", "Lao"],
    ["la", "Latin"],
    ["lv", "Latvian"],
    ["ln", "Lingala"],
    ["lt", "Lithuanian"],
    ["lg", "Luganda"],
    ["lb", "Luxembourgish"],
    ["mk", "Macedonian"],
    ["mai", "Maithili"],
    ["mg", "Malagasy"],
    ["ms", "Malay"],
    ["ml", "Malayalam"],
    ["mt", "Maltese"],
    ["mi", "Maori"],
    ["mr", "Marathi"],
    ["mni-Mtei", "Meiteilon (Manipuri)"],
    ["lus", "Mizo"],
    ["mn", "Mongolian"],
    ["my", "Myanmar (Burmese)"],
    ["ne", "Nepali"],
    ["no", "Norwegian"],
    ["or", "Odia (Oriya)"],
    ["om", "Oromo"],
    ["ps", "Pashto"],
    ["fa", "Persian"],
    ["pl", "Polish"],
    ["pt", "Portuguese"],
    ["pa", "Punjabi"],
    ["qu", "Quechua"],
    ["ro", "Romanian"],
    ["ru", "Russian"],
    ["sm", "Samoan"],
    ["sa", "Sanskrit"],
    ["gd", "Scots Gaelic"],
    ["nso", "Sepedi"],
    ["sr", "Serbian"],
    ["st", "Sesotho"],
    ["sn", "Shona"],
    ["sd", "Sindhi"],
    ["si", "Sinhala"],
    ["sk", "Slovak"],
    ["sl", "Slovenian"],
    ["so", "Somali"],
    ["es", "Spanish"],
    ["su", "Sundanese"],
    ["sw", "Swahili"],
    ["sv", "Swedish"],
    ["tg", "Tajik"],
    ["ta", "Tamil"],
    ["tt", "Tatar"],
    ["te", "Telugu"],
    ["th", "Thai"],
    ["ti", "Tigrinya"],
    ["ts", "Tsonga"],
    ["tr", "Turkish"],
    ["tk", "Turkmen"],
    ["ak", "Twi"],
    ["uk", "Ukrainian"],
    ["ur", "Urdu"],
    ["ug", "Uyghur"],
    ["uz", "Uzbek"],
    ["vi", "Vietnamese"],
    ["cy", "Welsh"],
    ["xh", "Xhosa"],
    ["yi", "Yiddish"],
    ["yo", "Yoruba"],
    ["zu", "Zulu"]
  ];

  const now = () => Date.now();
  const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 8);
  const escapeRegExp = (s) => (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── Safe storage helpers (guards against Extension context invalidated) ──
  function isExtensionValid() {
    return Boolean(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
  }

  async function storageGet(keys, fallback = {}) {
    if (!isExtensionValid()) return fallback;
    try {
      return (await chrome.storage.local.get(keys)) || fallback;
    } catch (err) {
      if (err && String(err.message || err).includes("Extension context invalidated")) {
        return fallback;
      }
      throw err;
    }
  }

  async function storageSet(items) {
    if (!isExtensionValid()) return;
    try {
      await chrome.storage.local.set(items);
    } catch (err) {
      if (err && String(err.message || err).includes("Extension context invalidated")) {
        return;
      }
      throw err;
    }
  }

  // ── Config ──────────────────────────────────────────────────────────
  async function getConfig() {
    const { fufuConfig } = await storageGet("fufuConfig");
    return Object.assign({}, DEFAULT_CONFIG, fufuConfig || {});
  }
  async function setConfig(patch) {
    const next = Object.assign(await getConfig(), patch);
    await storageSet({ fufuConfig: next });
    return next;
  }

  // ── Per-site auto-translate hosts ───────────────────────────────────
  async function getHosts() {
    const { fufuHosts } = await storageGet("fufuHosts");
    return fufuHosts && typeof fufuHosts === "object" ? fufuHosts : {};
  }
  async function setHostEnabled(host, on) {
    const hosts = await getHosts();
    if (on) hosts[host] = true;
    else delete hosts[host];
    await storageSet({ fufuHosts: hosts });
    return hosts;
  }

  // ── Vocabulary ──────────────────────────────────────────────────────
  async function getVocab() {
    const { fufuVocab } = await storageGet("fufuVocab");
    return Array.isArray(fufuVocab) ? fufuVocab : [];
  }
  async function setVocab(list) {
    await storageSet({ fufuVocab: list });
  }

  async function addWord({ term, translation, src, tgt, context, url, note }) {
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
      if (!existing.note && note) existing.note = note;
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
      note: (note || "").trim(), // user's own example / collocation / mnemonic
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
    const { fufuDecks } = await storageGet("fufuDecks");
    return Array.isArray(fufuDecks) ? fufuDecks : [];
  }
  async function setDecks(list) {
    await storageSet({ fufuDecks: list });
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
    const { fufuActivity } = await storageGet("fufuActivity");
    return fufuActivity && typeof fufuActivity === "object" ? fufuActivity : {};
  }
  async function recordActivity(kind) {
    const a = await getActivity();
    const k = toDayKey(now());
    a[k] = a[k] || { reviews: 0, added: 0 };
    if (kind === "review") a[k].reviews++;
    else if (kind === "added") a[k].added++;
    await storageSet({ fufuActivity: a });
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
    const { fufuTest } = await storageGet("fufuTest");
    return fufuTest || null;
  }
  async function getPendingTest() {
    const t = await getTest();
    return t && t.status === "pending" ? t : null;
  }
  async function setTest(t) {
    await storageSet({ fufuTest: t });
  }

  // Build a fill-in-the-blank prompt from a word's saved context sentence by
  // blanking out the term (whole word, case-insensitive). Returns null if the
  // word has no usable sentence containing it — the caller then falls back to
  // another question type.
  function clozePrompt(w) {
    const ctx = (w.context || "").trim();
    if (!ctx || ctx.length < w.term.length + 5) return null;
    const re = new RegExp(`(^|[^\\p{L}])(${escapeRegExp(w.term)})(?=[^\\p{L}]|$)`, "iu");
    if (!re.test(ctx)) return null;
    const blanked = ctx.replace(re, (_m, pre) => pre + "____");
    return blanked.length > 280 ? blanked.slice(0, 280) + "…" : blanked;
  }

  function buildQuestions(words, allWords, count, type) {
    const pool = shuffle(words.filter((w) => w.translation && w.term));
    const picked = pool.slice(0, count);
    const distract = allWords.filter((w) => w.translation && w.term);
    const cycle = ["mcq", "typing", "cloze"]; // for "mixed"
    return picked.map((w, i) => {
      let qtype = type === "mixed" ? cycle[i % cycle.length] : type;
      // Cloze needs a usable context sentence; fall back to typing if none.
      if (qtype === "cloze") {
        const prompt = clozePrompt(w);
        if (prompt) {
          return {
            id: w.id,
            prompt,
            answer: w.term,
            hint: w.translation, // shown as a meaning hint under the blank
            direction: "cloze",
            type: "cloze",
          };
        }
        qtype = "typing";
      }
      const t2m = i % 2 === 0; // alternate direction
      const typing = qtype === "typing";
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
    await storageSet({ fufuCelebrate: now() }); // mascot cheer
    return { correct, total: t.questions.length };
  }

  // ── Full backup / restore ───────────────────────────────────────────
  // Everything lives in chrome.storage.local, which is wiped if the extension
  // is removed or the user switches machines. These let the user keep a single
  // file with their entire learning history (settings, words, decks, streak).
  const BACKUP_KEYS = [
    "fufuConfig", "fufuVocab", "fufuHosts", "fufuDecks", "fufuTest", "fufuActivity",
  ];
  async function exportAll() {
    const data = await storageGet(BACKUP_KEYS);
    return { app: "vimi-bilingual", schema: 2, exportedAt: now(), data };
  }
  // Replace local data with a backup's contents. Only keys present in the
  // backup are written, so an older backup won't clobber newer unrelated keys.
  async function restoreAll(payload) {
    const data = payload && payload.data ? payload.data : null;
    if (!data || typeof data !== "object") throw new Error("Not a Vimi backup");
    const patch = {};
    for (const k of BACKUP_KEYS) if (k in data) patch[k] = data[k];
    if (!Object.keys(patch).length) throw new Error("Backup is empty");
    await storageSet(patch);
    return Object.keys(patch).length;
  }

  self.FuFu = {
    DAY,
    now,
    uid,
    shuffle,
    LANGUAGES,
    POPULAR_LANGUAGES,
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
    clozePrompt,
    createTestNow,
    completeTest,
    escapeRegExp,
    exportAll,
    restoreAll,
  };
})();
