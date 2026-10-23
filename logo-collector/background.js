// background.js — fetch image bytes from signed URL and save with exact brand filename
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── Read image count from macro-recorder's count-server ─────────────────────
  if (msg.type === "count-images") {
    fetch("http://127.0.0.1:7843/count")
      .then((r) => r.json())
      .then((data) => sendResponse({ count: typeof data.count === "number" ? data.count : 0 }))
      .catch(() => sendResponse({ count: null, error: "count-server not running" }));
    return true; // keep channel open for async reply
  }

  if (msg.type !== "save-logo") return;

  (async () => {
    try {
      const res = await fetch(msg.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);

      const id = await chrome.downloads.download({
        url: objUrl,
        filename: msg.filename,   // e.g. "brand-logos/vulcanis/logo.png"
        saveAs: false,
        conflictAction: "uniquify",
      });

      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);

      // Detect if uniquify renamed it
      let finalName = msg.filename;
      try {
        const [item] = await chrome.downloads.search({ id });
        const m = item?.filename.replace(/\\/g, "/").match(/brand-logos\/.+$/);
        if (m) finalName = m[0];
      } catch (_) {}

      sendResponse({ ok: true, bytes: blob.size, finalName });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // keep channel open for async reply
});
