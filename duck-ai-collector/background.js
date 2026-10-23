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
