// Relay only: fetch image bytes from the signed URL and save under an exact name.
// No navigation, no clicking, no sending prompts — the human does all of that.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "save-image") return;

  (async () => {
    try {
      const res = await fetch(msg.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const id = await chrome.downloads.download({
        url: objUrl,
        filename: msg.filename, // "vertex-products/<id>-<slug>/01-main.jpg"
        saveAs: false,
        conflictAction: "uniquify",
      });
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);

      // Detect if uniquify renamed it (e.g. "01-main (1).jpg") so the
      // collector can flag strays.
      let finalName = msg.filename;
      try {
        const [item] = await chrome.downloads.search({ id });
        const m = item?.filename.replace(/\\/g, "/").match(/vertex-products\/.+$/);
        if (m) finalName = m[0];
      } catch (_) {}
      sendResponse({ ok: true, bytes: blob.size, finalName });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // keep the message channel open for the async reply
});