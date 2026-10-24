// background.js
// When content.js clicks duck.ai's "Download image" button, this intercepts
// the download BEFORE it hits disk and saves it as duck-ai-queue/<timestamp>.png
// The sorter.js watches that queue folder and moves/renames it to img/.

let pendingFilename = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === "set-next-filename") {
    // msg.filename is now just a temp name like "queue-1234567890.png"
    // We save it into a "duck-ai-queue" subfolder of Downloads
    pendingFilename = `duck-ai-queue/${msg.filename}`;
    console.log("[bg] queued filename →", pendingFilename);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "count-images") {
    fetch("http://127.0.0.1:7843/count", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => sendResponse({ count: typeof d.count === "number" ? d.count : 0 }))
      .catch(() => sendResponse({ count: null }));
    return true;
  }
});

// Intercept BEFORE the file is written — rename to duck-ai-queue/<timestamp>.png
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  console.log("[bg] onDeterminingFilename →", item.filename, "| pending →", pendingFilename);

  if (pendingFilename) {
    const target    = pendingFilename;
    pendingFilename = null;
    suggest({ filename: target, conflictAction: "uniquify" });
    chrome.storage.local.set({ lastSavedFilename: target, lastSavedTs: Date.now() });
    return false;
  }

  suggest({ filename: item.filename });
  return false;
});


// ── Keep-alive alarm ─────────────────────────────────────────────────────────
// Page timers (setInterval/setTimeout) get throttled or frozen when the window is
// hidden or the RDP session is disconnected. chrome.alarms is not affected, so every
// 30 s we ping the duck.ai tab; content.js answers by running its watchdog check.
// If the tab doesn't answer (content script dead / tab frozen) and the run is still
// armed, we reload the tab so the watchdog can restart the loop.
const ALARM_NAME         = "dai-keepalive";
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000;   // never reload more than once per 5 min

function ensureAlarm() {
  chrome.alarms.get(ALARM_NAME, (existing) => {
    if (!existing) chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();   // also runs whenever the service worker wakes up

async function recoverDeadTab(tab) {
  const s = await chrome.storage.local.get({ autoMode: false, index: 0, images: [], lastReloadTs: 0 });
  const unfinished = s.images.length > 0 && s.index < s.images.length;
  if (!s.autoMode || !unfinished) return;                          // user stopped it, or all done
  if (Date.now() - s.lastReloadTs < RELOAD_COOLDOWN_MS) return;    // avoid reload loops
  await chrome.storage.local.set({ lastReloadTs: Date.now() });
  console.warn("[bg] alarm: tab not responding, reloading", tab.id);
  chrome.tabs.reload(tab.id);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const tabs = await chrome.tabs.query({ url: "https://duck.ai/*" });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "alarm-ping" });
    } catch {
      await recoverDeadTab(tab);
    }
  }
});