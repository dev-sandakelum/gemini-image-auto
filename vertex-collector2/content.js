/* Vertex Image Collector — control panel for gemini.google.com.
   You paste prompts and click "generate" yourself; this panel tracks the
   slots and the save buttons download results with correct filenames. */
(() => {
  "use strict";

  const SLOTS = [
    { file: "01-main",      view: "main",      label: "main product shot" },
    { file: "02-angle",     view: "angle",     label: "three-quarter angle view" },
    { file: "03-detail",    view: "detail",    label: "close-up detail" },
    { file: "04-context",   view: "context",   label: "product in use" },
    { file: "05-packaging", view: "packaging", label: "retail packaging" },
  ];

  // Mirrors the Python scripts' category styles / view modifiers.
  const CATEGORY_STYLES = {
    "laptop": "modern laptop computer",        "desktop": "desktop PC tower",
    "gaming pc": "gaming PC with glass panel", "monitor": "slim-bezel computer monitor",
    "keyboard": "mechanical keyboard",         "mouse": "ergonomic computer mouse",
    "headset": "over-ear headset",             "printer": "office printer",
    "gpu": "graphics card",                    "graphics": "graphics card",
    "cpu": "desktop CPU processor",            "processor": "desktop CPU processor",
    "ssd": "solid-state drive",                "storage": "external storage drive",
    "router": "wifi router",                   "networking": "networking device",
    "accessories": "computer accessory",       "peripherals": "computer peripheral",
  };
  const DEFAULT_STYLE = "computer product";
  const QUALITY_TAIL = "high detail, sharp focus, professional commercial product photography, 1:1 aspect ratio";
  const VIEW_MODIFIERS = {
    "main":      "centered on a plain white studio background, e-commerce catalog style, even lighting, soft shadow",
    "angle":     "dynamic three-quarter angle view on a plain white studio background, e-commerce catalog style",
    "detail":    "extreme close-up macro shot of its most distinctive feature, shallow depth of field",
    "context":   "shown in a realistic everyday setting while being used, natural lighting, lifestyle photo",
    "packaging": "displayed next to its retail box packaging, studio lighting, clean neutral background",
  };

  // ---------------- state ----------------
  let state = { products: [], index: 0, slot: 0, done: {}, pos: null };

  const loadState = () =>
    chrome.storage.local.get({ products: [], index: 0, slot: 0, done: {}, pos: null })
      .then((s) => { state = s; });
  const saveState = () => chrome.storage.local.set(state);

  const curProduct = () => state.products[state.index] || null;
  const curSlot = () => SLOTS[state.slot];
  const doneKey = (p, s) => `${p.id}|${s.file}`;
  const isDone = (p, s) => Boolean(state.done[doneKey(p, s)]);
  const folderOf = (p) => `${p.id}-${p.slug}`;
  const totalDone = () => Object.keys(state.done).length;
  const totalSlots = () => state.products.length * SLOTS.length;

  // ---------------- prompts (same logic as Python) ----------------
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

  // ---------------- widget ----------------
  let root = null;

  const escapeHtml = (s) => (s || "").replace(/[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

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

  let statusTimer = null;
  function status(text) {
    const el = document.getElementById("vx-status");
    if (!el) return;
    el.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.textContent = ""; }, 4000);
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
        return saveState().then(render);
      }).catch((err) => alert(`Import failed: ${err.message}`));
    });

    const sel = document.getElementById("vx-select");
    if (sel) sel.addEventListener("change", () => {
      state.index = Number(sel.value); state.slot = 0; saveState(); render();
    });

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
    on("vx-copy", () => {
      const p = curProduct(); if (!p) return;
      const prompt = buildPrompt(p, curSlot().view);
      navigator.clipboard.writeText(prompt)
        .then(() => status("Prompt copied — paste it into Gemini"))
        .catch(() => {
          const ta = document.getElementById("vx-prompt");
          ta.select(); document.execCommand("copy"); status("Prompt copied");
        });
    });
    on("vx-prev-s", () => { state.slot = (state.slot + SLOTS.length - 1) % SLOTS.length; saveState(); render(); });
    on("vx-next-s", () => { advance(); saveState(); render(); });
    on("vx-prev-p", () => { state.index = (state.index + state.products.length - 1) % state.products.length; state.slot = 0; saveState(); render(); });
    on("vx-next-p", () => { state.index = (state.index + 1) % state.products.length; state.slot = 0; saveState(); render(); });
    on("vx-clear", () => {
      if (confirm("Forget imported products AND saved-slot history?")) {
        state = { products: [], index: 0, slot: 0, done: {}, pos: state.pos };
        saveState(); render();
      }
    });
    document.querySelectorAll(".vx-chip").forEach((chip) =>
      chip.addEventListener("click", () => { state.slot = Number(chip.dataset.i); saveState(); render(); }));
  }

  function advance() {
    state.slot += 1;
    if (state.slot >= SLOTS.length) {
      state.slot = 0;
      state.index = (state.index + 1) % state.products.length;
    }
  }

  // ---------------- save overlay over generated images ----------------
  let saveBtn = null, hoverImg = null;

  // googleusercontent URLs accept size suffixes ("=w740-h740"); "=s0" = original.
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
    if (!p || !hoverImg) { status("Import products.json first"); return; }
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
      status(`Saved ${s.file}.jpg ✓ — next: ${curSlot().file} for ${curProduct().name}`);
      hideSaveBtn();
    });
  }

  document.addEventListener("mouseover", (e) => {
    if (saveBtn && saveBtn.contains(e.target)) return;   // keep alive while on the button
    if (hoverImg && hoverImg.contains(e.target)) return; // already shown
    if (isProductImage(e.target)) showSaveBtn(e.target);
    else hideSaveBtn();
  }, true);

  loadState().then(render);
})();