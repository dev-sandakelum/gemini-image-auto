// Vertex Collector — GPT + Gemini edition background service worker
// Relay only: fetch image bytes and save under a pipeline-correct filename.
// No navigation, no clicking, no sending prompts — the human does all of that.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── Read count from watcher's local HTTP server ────────────────
  if (msg.type === "count-images") {
    fetch("http://127.0.0.1:7843/count")
      .then((r) => r.json())
      .then((data) =>
        sendResponse({ count: typeof data.count === "number" ? data.count : 0 })
      )
      .catch(() =>
        sendResponse({ count: null, error: "count-server not running" })
      );
    return true; // async
  }

  if (msg.type !== "save-image") return;

  (async () => {
    try {
      let objUrl;

      if (msg.isBlob) {
        // Content script already converted blob → data URL; use it directly.
        objUrl = msg.url;
      } else {
        // ChatGPT images are served over HTTPS; fetch them from the background
        // worker which has the required host_permissions.
        // Gemini's googleusercontent URLs are also fetchable here.
        const res = await fetch(msg.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        objUrl = URL.createObjectURL(blob);
        setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
      }

      const id = await chrome.downloads.download({
        url:            objUrl,
        filename:       msg.filename, // "vertex-products/<id>-<slug>/<view>.png"
        saveAs:         false,
        conflictAction: "uniquify",
      });

      // Detect if uniquify renamed it (e.g. "main (1).png")
      let finalName = msg.filename;
      try {
        const [item] = await chrome.downloads.search({ id });
        const m = item?.filename.replace(/\\/g, "/").match(/vertex-products\/.+$/);
        if (m) finalName = m[0];
      } catch (_) {}

      sendResponse({ ok: true, finalName });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // keep message channel open for async reply
});
