/* Vertex Image Collector — control panel for gemini.google.com.
   You paste prompts and click "generate" yourself; this panel tracks the
   slots and the save buttons download results with correct filenames. */
(() => {
  "use strict";

  const SLOTS = [
    { file: "01-main", view: "main", label: "main product shot" },
    { file: "02-angle", view: "angle", label: "three-quarter angle view" },
    { file: "03-detail", view: "detail", label: "close-up detail" },
    { file: "04-context", view: "context", label: "product in use" },
    { file: "05-packaging", view: "packaging", label: "retail packaging" },
  ];

  const CATEGORY_STYLES = {
    "laptop": "modern laptop computer", "desktop": "desktop PC tower",
    "gaming pc": "gaming PC with glass panel", "monitor": "slim-bezel computer monitor",
    "keyboard": "mechanical keyboard", "mouse": "ergonomic computer mouse",
    "headset": "over-ear headset", "printer": "office printer",
    "gpu": "graphics card", "graphics": "graphics card",
    "cpu": "desktop CPU processor", "processor": "desktop CPU processor",
    "ssd": "solid-state drive", "storage": "external storage drive",
    "router": "wifi router", "networking": "networking device",
    "accessories": "computer accessory", "peripherals": "computer peripheral",
  };
  const DEFAULT_STYLE = "computer product";
  const QUALITY_TAIL =
    "high detail, sharp focus, professional commercial product photography, " +
    "you need to think about how it good as product image and view now we genarating , give most good product image based on that product and is view"+
    "single product only, no text, no watermark, no extra props, 1:1 aspect ratio, 720p image size";

  const VIEW_MODIFIERS = {
    "main": "[this is a new product ] front-facing product shot, centered on a seamless pure white studio background, e-commerce catalog style, even soft diffused lighting, subtle soft shadow directly beneath the product",
    "angle": "three-quarter angle view turned 35-45 degrees from front, same seamless white studio background and lighting as the main shot, e-commerce catalog style, soft shadow beneath product",
    "detail": "extreme close-up macro shot isolating the product's single most distinctive feature, shallow depth of field with soft blurred background, no full product visible, studio lighting that reveals texture and material",
    "context": "shown in active real-world use in a realistic, tidy everyday setting, natural ambient lighting, lifestyle photo style, product remains the clear focal point and fully in focus",
    "with-packaging": "displayed standing beside its closed retail packaging box, both clearly visible, on a clean neutral studio surface, soft studio lighting, simple minimal box design with no readable fake text",
  };
  // ---------------- state ----------------
  let state = { products: [], index: 0, slot: 0, done: {}, pos: null, lastImageCount: 0 };

  const loadState = () =>
    chrome.storage.local.get({ products: [], index: 0, slot: 0, done: {}, pos: null, lastImageCount: 0 })
      .then((s) => { state = s; });
  const saveState = () => chrome.storage.local.set(state);

  const curProduct = () => state.products[state.index] || null;
  const curSlot = () => SLOTS[state.slot];
  const doneKey = (p, s) => `${p.id}|${s.file}`;
  const isDone = (p, s) => Boolean(state.done[doneKey(p, s)]);
  const folderOf = (p) => `${p.id}-${p.slug}`;
  const totalDone = () => Object.keys(state.done).length;
  const totalSlots = () => state.products.length * SLOTS.length;

  // ---------------- prompts ----------------
  const slugify = (t) =>
    ((t || "").toLowerCase().replace(/[^\w\s-]/g, "").trim()
      .replace(/[\s_-]+/g, "-").slice(0, 60)) || "product";

  function resolveStyle(category) {
    const c = (category || "").trim().toLowerCase();
    if (CATEGORY_STYLES[c]) return CATEGORY_STYLES[c];
    for (const [k, v] of Object.entries(CATEGORY_STYLES))
      if (c.includes(k)) return v;
    return DEFAULT_STYLE;
  }

  const buildPrompt = (p, view) =>
    `Professional product photo of ${(p.name || "generic product").trim()} ` +
    `(${resolveStyle(p.category)}), ${VIEW_MODIFIERS[view]}, ${QUALITY_TAIL}`;

  // ---------------- helpers ----------------
  const escapeHtml = (s) => (s || "").replace(/[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  let statusTimer = null;
  function flashStatus(text, el) {
    if (!el) return;
    el.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.textContent = ""; }, 3000);
  }

  // ================================================================
  //  FIXED PILL BUTTONS (bottom-centre HUD)
  // ================================================================
  let hud = null;

  function mountHud() {
    if (hud) return;
    hud = document.createElement("div");
    hud.id = "vx-hud";
    document.body.appendChild(hud);
  }

  // ----------------------------------------------------------------
  //  Image counter — asks background for the real download count
  // ----------------------------------------------------------------
  function fetchImageCount(callback) {
    chrome.runtime.sendMessage({ type: "count-images" }, (res) => {
      if (res && typeof res.count === "number") {
        callback(res.count);
      } else {
        // watcher not running — keep last known count, show error hint
        callback(null);
      }
    });
  }

  // Auto-advance logic:
  // The HUD "position" is 1-based overall slot number (e.g. image 22 = slot index 21).
  // If the image count from disk equals or exceeds the current overall slot position,
  // that means the current image was already saved → advance to the next slot.
  function currentOverallSlot() {
    // product index × SLOTS.length + slot index + 1  (1-based)
    return state.index * SLOTS.length + state.slot + 1;
  }

  function applyCountAndAutoAdvance(count, refreshBtn) {
    const p = curProduct();
    state.lastImageCount = count;

    // Advance as many slots as the count has moved ahead
    // e.g. if count=22 and we're on slot 21, advance once
    if (p) {
      while (curProduct() && count >= currentOverallSlot()) {
        advance();
      }
      saveState();
      render();
    }

    // Update the label on the refresh button
    if (refreshBtn) {
      const newS = curSlot();
      const posLabel = p
        ? `${state.index + 1}/${state.products.length} · ${newS.file}`
        : "no data";
      const labelEl = refreshBtn.querySelector(".vx-pill-label");
      if (labelEl) labelEl.textContent = `${count} · ${posLabel}`;
      refreshBtn.disabled = false;
      refreshBtn.title = `Images saved: ${count}`;
    }
  }

  function renderHud() {
    mountHud();
    const p = curProduct();
    const s = curSlot();
    const noData = !p;

    // Label: "savedCount · index/total · slotFile"
    const posLabel = noData
      ? "no data"
      : `${state.lastImageCount} · ${state.index + 1}/${state.products.length} · ${s.file}`;

    hud.innerHTML = `
      <button id="vx-hud-copy-name" class="vx-pill vx-pill-name" title="Copy image filename">
        <span class="vx-pill-icon">📋</span>
        <span class="vx-pill-label">Copy Name</span>
      </button>
      <button id="vx-hud-copy-prompt" class="vx-pill vx-pill-prompt" title="Copy prompt">
        <span class="vx-pill-icon">📝</span>
        <span class="vx-pill-label">Copy Prompt</span>
      </button>
      <button id="vx-hud-refresh" class="vx-pill vx-pill-refresh" title="Refresh image count from downloads">
        <span class="vx-pill-icon">🔄</span>
        <span class="vx-pill-label">${escapeHtml(posLabel)}</span>
      </button>
    `;

    // Copy image filename (e.g. "01-main.jpg")
    document.getElementById("vx-hud-copy-name").addEventListener("click", () => {
      if (!p) return;
      const name = `${s.file}.jpg`;
      navigator.clipboard.writeText(name).catch(() => { });
    });

    // Copy prompt
    document.getElementById("vx-hud-copy-prompt").addEventListener("click", () => {
      if (!p) return;
      const prompt = buildPrompt(p, s.view);
      navigator.clipboard.writeText(prompt).catch(() => { });
    });

    // Refresh: count images → auto-advance if count moved forward
    const refreshBtn = document.getElementById("vx-hud-refresh");
    refreshBtn.addEventListener("click", () => {
      if (refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      const labelEl = refreshBtn.querySelector(".vx-pill-label");
      if (labelEl) labelEl.textContent = "reading…";
      fetchImageCount((count) => {
        if (count === null) {
          // watcher not running
          if (labelEl) labelEl.textContent = "⚠ watcher offline";
          refreshBtn.disabled = false;
          return;
        }
        applyCountAndAutoAdvance(count, document.getElementById("vx-hud-refresh"));
        renderHud(); // re-render with fresh state
      });
    });
  }

  // ================================================================
  //  MAIN PANEL (draggable widget, unchanged behaviour)
  // ================================================================
  let root = null;

  function mount() {
    if (!root) {
      root = document.createElement("div");
      root.id = "vertex-widget";
      document.body.appendChild(root);
      makeDraggable();
    }
    if (state.pos) {
      Object.assign(root.style, { top: `${state.pos.top}px`, left: `${state.pos.left}px`, right: "auto", bottom: "auto" });
    }
    return root;
  }

  function makeDraggable() {
    let drag = null;
    root.addEventListener("pointerdown", (e) => {
      if (!e.target.closest("#vx-head")) return;
      const r = root.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    document.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const top = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - drag.dy));
      const left = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.dx));
      Object.assign(root.style, { top: `${top}px`, left: `${left}px`, right: "auto", bottom: "auto" });
      state.pos = { top, left };
    });
    document.addEventListener("pointerup", () => { if (drag) { drag = null; saveState(); } });
  }

  function panelHTML() {
    const p = curProduct(), s = curSlot();
    const chips = SLOTS.map((sl, i) =>
      `<span class="vx-chip ${isDone(p, sl) ? "vx-done" : ""} ${i === state.slot ? "vx-cur" : ""}"
             data-i="${i}" title="${sl.label}">${sl.file}</span>`).join("");
    const options = state.products.map((prod, i) =>
      `<option value="${i}" ${i === state.index ? "selected" : ""}>${escapeHtml(prod.name)}</option>`).join("");
    return `
      <div class="vx-head" id="vx-head"><span>Vertex Collector</span>
        <span class="vx-count">${totalDone()}/${totalSlots()} saved</span></div>
      <div class="vx-body">
        <select id="vx-select">${options}</select>
        <div class="vx-product">${state.index + 1}/${state.products.length}: ${escapeHtml(p.name)}</div>
        <div class="vx-chips">${chips}</div>
        <textarea id="vx-prompt" readonly rows="3">${escapeHtml(buildPrompt(p, s.view))}</textarea>
        <div class="vx-file">next file: <b>${folderOf(p)}/${s.file}.jpg</b></div>
        <div class="vx-row">
          <button id="vx-copy">Copy prompt</button>
          <button id="vx-prev-s" title="previous slot">◀</button>
          <button id="vx-next-s" title="next slot">▶</button>
        </div>
        <div class="vx-row">
          <button id="vx-prev-p">◀ product</button>
          <button id="vx-next-p">product ▶</button>
        </div>
        <div id="vx-status"></div>
        <div class="vx-foot">
          <label class="vx-filebtn">re-import products.json<input type="file" id="vx-import" accept=".json"></label>
          <button id="vx-clear">reset all</button>
        </div>
      </div>`;
  }

  function importerHTML() {
    return `
      <div class="vx-head" id="vx-head"><span>Vertex Collector</span></div>
      <div class="vx-body">
        <p>Import <b>products.json</b> to begin. For each slot: copy the prompt,
        generate it here in Gemini yourself, then click the ⬇ button on the
        result — it saves with the exact filename the pipeline expects.
        Progress persists across restarts.</p>
        <label class="vx-filebtn big">Import products.json
          <input type="file" id="vx-import" accept=".json"></label>
        <div id="vx-status"></div>
      </div>`;
  }

  function render() {
    mount().innerHTML = state.products.length ? panelHTML() : importerHTML();
    bindEvents();
  }

  function bindEvents() {
    const fileInput = document.getElementById("vx-import");
    if (fileInput) fileInput.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((txt) => {
        const data = JSON.parse(txt);
        if (!Array.isArray(data) || !data.length) throw new Error("expected a non-empty JSON array");
        state.products = data.map((p, i) => {
          const id = String(p.id ?? i + 1);
          const name = p.name || `product-${id}`;
          return { id, name, category: p.category || "", slug: p.slug || slugify(name) };
        });
        state.index = 0; state.slot = 0;
        return saveState().then(() => { render(); renderHud(); });
      }).catch((err) => alert(`Import failed: ${err.message}`));
    });

    const sel = document.getElementById("vx-select");
    if (sel) sel.addEventListener("change", () => {
      state.index = Number(sel.value); state.slot = 0; saveState(); render(); renderHud();
    });

    const panelStatus = () => document.getElementById("vx-status");
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };

    on("vx-copy", () => {
      const p = curProduct(); if (!p) return;
      const prompt = buildPrompt(p, curSlot().view);
      navigator.clipboard.writeText(prompt)
        .then(() => flashStatus("Prompt copied — paste it into Gemini", panelStatus()))
        .catch(() => {
          const ta = document.getElementById("vx-prompt");
          ta.select(); document.execCommand("copy");
          flashStatus("Prompt copied", panelStatus());
        });
    });
    on("vx-prev-s", () => { state.slot = (state.slot + SLOTS.length - 1) % SLOTS.length; saveState(); render(); renderHud(); });
    on("vx-next-s", () => { advance(); saveState(); render(); renderHud(); });
    on("vx-prev-p", () => { state.index = (state.index + state.products.length - 1) % state.products.length; state.slot = 0; saveState(); render(); renderHud(); });
    on("vx-next-p", () => { state.index = (state.index + 1) % state.products.length; state.slot = 0; saveState(); render(); renderHud(); });
    on("vx-clear", () => {
      if (confirm("Forget imported products AND saved-slot history?")) {
        state = { products: [], index: 0, slot: 0, done: {}, pos: state.pos };
        saveState(); render(); renderHud();
      }
    });
    document.querySelectorAll(".vx-chip").forEach((chip) =>
      chip.addEventListener("click", () => { state.slot = Number(chip.dataset.i); saveState(); render(); renderHud(); }));
  }

  function advance() {
    state.slot += 1;
    if (state.slot >= SLOTS.length) {
      state.slot = 0;
      state.index = (state.index + 1) % state.products.length;
    }
  }

  // ================================================================
  //  SAVE OVERLAY on generated images
  // ================================================================
  let saveBtn = null, hoverImg = null;

  const fullResSrc = (src) => src.replace(/=[a-z]\d+.*$/, "=s0");

  function isProductImage(el) {
    if (!el || el.tagName !== "IMG") return false;
    const big = Math.max(el.clientWidth, el.naturalWidth || 0) >= 380;
    return big && /googleusercontent|googleapis\.com/.test(el.src || "");
  }

  function hideSaveBtn() { if (saveBtn) { saveBtn.remove(); saveBtn = null; hoverImg = null; } }

  function showSaveBtn(img) {
    hideSaveBtn();
    hoverImg = img;
    const r = img.getBoundingClientRect();
    const p = curProduct(), s = curSlot();
    saveBtn = document.createElement("button");
    saveBtn.id = "vertex-save-overlay";
    saveBtn.textContent = p
      ? `⬇ Save as ${s.file}.jpg  (${folderOf(p)})`
      : "⬇ Import products.json first";
    saveBtn.style.top = `${Math.max(r.top + window.scrollY, 0) + 6}px`;
    saveBtn.style.left = `${r.left + window.scrollX + r.width - 6}px`;
    saveBtn.addEventListener("click", onSaveClick);
    document.body.appendChild(saveBtn);
  }

  function onSaveClick() {
    const p = curProduct(), s = curSlot();
    if (!p || !hoverImg) return;
    const filename = `vertex-products/${folderOf(p)}/${s.file}.jpg`;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    chrome.runtime.sendMessage({ type: "save-image", url: fullResSrc(hoverImg.src), filename }, (res) => {
      const err = chrome.runtime.lastError;
      if (err || !res || !res.ok) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Failed — try again";
        return;
      }
      state.done[doneKey(p, s)] = { ts: new Date().toISOString(), filename: res.finalName };
      advance();
      saveState();
      render();
      renderHud();
      const st = document.getElementById("vx-status");
      flashStatus(`Saved ${s.file}.jpg ✓ — next: ${curSlot().file} for ${curProduct().name}`, st);
      hideSaveBtn();
    });
  }

  document.addEventListener("mouseover", (e) => {
    if (saveBtn && saveBtn.contains(e.target)) return;
    if (hoverImg && hoverImg.contains(e.target)) return;
    if (isProductImage(e.target)) showSaveBtn(e.target);
    else hideSaveBtn();
  }, true);

  loadState().then(() => { render(); renderHud(); });
})();
