// FuFu Bilingual — service worker.
//
// Responsibilities:
//  - Right-click "Add to FuFu vocab" → save the selected word (with auto
//    translation + context fetched from the page).
//  - Periodic tick (chrome.alarms): refresh the toolbar badge (# words due, or
//    "TEST" when a test is waiting), create the scheduled test when it comes
//    due, and show a daily review reminder.
//  - Alt+T command → toggle translation on the active tab.

importScripts("store.js");
const F = self.FuFu;

// ── Setup ───────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: "fufu-add",
    title: 'Add “%s” to Vimi vocab',
    contexts: ["selection"],
  });
  await F.ensureSchedule();
  scheduleTick();
  refresh();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleTick();
  refresh();
});

function scheduleTick() {
  chrome.alarms.create("fufu-tick", { periodInMinutes: 30 });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "fufu-tick") refresh();
});

// Keep the badge in sync when vocab or the test changes from any context.
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && (ch.fufuVocab || ch.fufuTest)) updateBadge();
});

// ── Periodic refresh ──────────────────────────────────────────────────────
async function refresh() {
  const cfg = await F.getConfig();
  if (cfg.testEnabled) {
    const pending = await F.getPendingTest();
    if (!pending && cfg.nextTestAt && F.now() >= cfg.nextTestAt) {
      const t = await F.createTestNow();
      if (t) {
        notify(
          "fufu-test",
          "Weekly test ready",
          `Your test with ${t.count} questions is waiting. Click to start.`
        );
      } else {
        // No vocab to test yet — just push the schedule forward.
        await F.setConfig({ nextTestAt: F.computeNextTest(F.now(), cfg) });
      }
    }
  }
  await updateBadge();
  await maybeRemind(cfg);
}

async function updateBadge() {
  const pending = await F.getPendingTest();
  if (pending) {
    chrome.action.setBadgeText({ text: "TEST" });
    chrome.action.setBadgeBackgroundColor({ color: "#e8710a" });
    return;
  }
  const due = await F.dueCount();
  chrome.action.setBadgeText({ text: due > 0 ? String(Math.min(due, 999)) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
}

async function maybeRemind(cfg) {
  if (!cfg.reminderEnabled) return;
  const d = new Date();
  if (d.getHours() < (cfg.reminderHour || 20)) return;
  const dayKey = d.toDateString();
  const { fufuLastReminder } = await chrome.storage.local.get("fufuLastReminder");
  if (fufuLastReminder === dayKey) return;
  const due = await F.dueCount();
  if (due > 0) {
    notify("fufu-review", "Time to review", `You have ${due} word(s) due today.`);
    // Only consume today's slot once we've actually notified — otherwise a
    // tick before any words are due would silently block the rest of the day.
    await chrome.storage.local.set({ fufuLastReminder: dayKey });
  }
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icon128.png",
    title,
    message,
  });
}

chrome.notifications.onClicked.addListener((id) => {
  const page = id === "fufu-test" ? "test.html" : "review.html";
  chrome.tabs.create({ url: chrome.runtime.getURL(page) });
  chrome.notifications.clear(id);
});

// ── Right-click save ──────────────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "fufu-add") return;
  const term = (info.selectionText || "").trim();
  if (!term) return;
  let meta = null;
  try {
    meta = await chrome.tabs.sendMessage(tab.id, { type: "FUFU_LOOKUP", term });
  } catch {
    // content script unavailable — save without translation/context
  }
  const cfg = await F.getConfig();
  await F.addWord({
    term,
    translation: meta?.translation || "",
    context: meta?.context || "",
    src: meta?.src || cfg.src,
    tgt: meta?.tgt || cfg.tgt,
    url: tab?.url || "",
  });
  await updateBadge();
});

// ── Mascot: open a page in a new tab ──────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "VIMI_OPEN" && msg.page) {
    chrome.tabs.create({ url: chrome.runtime.getURL(msg.page) });
  }
});

// ── Alt+T toggle ──────────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-translate") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "BT_TOGGLE" });
  } catch {
    // No content script on this page — ignore.
  }
});
