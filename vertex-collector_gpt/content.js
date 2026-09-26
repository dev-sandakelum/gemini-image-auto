/* Vertex Image Collector — GPT edition
   Control panel for chatgpt.com.
   You paste prompts and click "generate" yourself;
   this panel tracks the slots and save buttons download
   results with correct pipeline filenames. */
(() => {
  "use strict";

  const SLOTS = [
    { file: "main",          view: "main",          label: "Main product shot" },
    { file: "angle",         view: "angle",          label: "Three-quarter angle view" },
    { file: "detail",        view: "detail",         label: "Close-up detail" },
    { file: "context",       view: "context",        label: "Product in use" },
    { file: "with-packaging",view: "with-packaging", label: "Retail packaging" },
  ];

  const CATEGORY_STYLES = {
    "laptop":      "modern laptop computer",
    "desktop":     "desktop PC tower",
    "gaming pc":   "gaming PC with glass panel",
    "monitor":     "slim-bezel computer monitor",
    "keyboard":    "mechanical keyboard",
    "mouse":       "ergonomic computer mouse",
    "headset":     "over-ear headset",
    "printer":     "office printer",
    "gpu":         "graphics card",
    "graphics":    "graphics card",
    "cpu":         "desktop CPU processor",
    "processor":   "desktop CPU processor",
    "ssd":         "solid-state drive",
    "storage":     "external storage drive",
    "router":      "wifi router",
    "networking":  "networking device",
    "accessories": "computer accessory",
    "peripherals": "computer peripheral",
  };

  const DEFAULT_STYLE =
    "premium commercial e-commerce product photography";

  const QUALITY_TAIL =
    "Photorealistic, ultra-detailed, premium studio photography, " +
    "accurate real-world materials, physically realistic proportions, " +
    "precise edges, realistic reflections, realistic shadows, " +
    "sharp product details, controlled highlights, professional color accuracy, " +
    "clean composition, premium catalog quality, " +
    "single exact product, no duplicate product, no extra objects, " +
    "no text overlays, no watermark, no logos added by the generator, " +
    "no invented accessories, no invented features, no design changes, " +
    "square 1:1 composition, 720p.";

  const PRODUCT_IDENTITY =
    "PRODUCT IDENTITY MUST REMAIN EXACTLY CONSISTENT ACROSS ALL FIVE IMAGES. " +
    "Treat the provided product description as the authoritative source of truth. " +
    "Preserve the exact product model, shape, dimensions, proportions, " +
    "color, finish, materials, buttons, ports, vents, seams, controls, " +
    "screen shape, camera placement, branding placement, and every visible physical feature. " +
    "Do not redesign, simplify, beautify, recolor, reinterpret, or invent any part of the product. " +
    "Every image must depict the SAME physical product photographed from a different camera/viewpoint.";

  const VIEW_MODIFIERS = {
    main:
      "PRIMARY CATALOG IMAGE. " +
      "Straight-on front-facing view of the product, perfectly centered and fully visible. " +
      "Product occupies approximately 70-80% of the frame. " +
      "Camera positioned at product eye level with minimal perspective distortion. " +
      "Pure seamless white background (#FFFFFF), professional high-key studio lighting, " +
      "large softbox lighting from both sides, subtle controlled fill light, " +
      "natural soft contact shadow directly underneath, " +
      "clean premium Amazon/Apple-style product catalog presentation. " +
      "No dramatic perspective, no environmental elements.",

    angle:
      "PREMIUM THREE-QUARTER CATALOG VIEW. " +
      "Show the exact same product from approximately 40 degrees horizontally rotated from the front. " +
      "Keep the product's proportions, geometry, color, materials, and every physical feature identical to the main image. " +
      "Reveal useful side depth and construction details without hiding the primary face. " +
      "Product centered and fully visible, occupying approximately 70-80% of the frame. " +
      "Seamless pure white studio background, identical lighting character to the main image, " +
      "soft realistic contact shadow, controlled reflections, premium commercial photography.",

    detail:
      "PRECISION DETAIL PHOTOGRAPH. " +
      "Create a highly realistic macro close-up of the single most distinctive physical feature of this exact product. " +
      "Choose a feature that genuinely exists on the product rather than inventing one. " +
      "Show authentic material texture, machining, surface finish, buttons, ports, stitching, " +
      "display details, or other distinctive construction detail as appropriate. " +
      "Use shallow depth of field while keeping the selected feature extremely sharp. " +
      "Soft neutral studio background with subtle blur. " +
      "Premium macro product photography, realistic optical characteristics, " +
      "controlled highlights and reflections. " +
      "Do not show another product or unrelated accessory.",

    context:
      "REALISTIC LIFESTYLE PRODUCT PHOTOGRAPH. " +
      "Show the exact same product naturally being used for its intended purpose " +
      "in a realistic, modern, tidy environment appropriate to the product category. " +
      "The environment must support the product rather than compete with it. " +
      "Product remains the dominant visual subject, fully recognizable and sharply focused. " +
      "Use realistic natural lighting combined with subtle professional fill lighting. " +
      "Authentic materials, realistic scale, believable perspective, " +
      "premium editorial commercial photography. " +
      "Do not add accessories unless they are logically required for the described use. " +
      "Do not alter the product in any way.",

    "with-packaging":
      "PRODUCT + PACKAGING CATALOG PHOTOGRAPH. " +
      "Show the exact same product standing naturally beside its retail packaging. " +
      "The product itself must remain fully visible and identical to the other four images. " +
      "Packaging should be realistic, clean, premium, minimal and physically believable. " +
      "The box must be closed and structurally appropriate for the product. " +
      "Do not invent readable product specifications, fake certifications, fake brand names, " +
      "or random typography. If branding is not explicitly provided, keep packaging graphics minimal and non-readable. " +
      "Clean neutral studio surface, soft professional lighting, subtle realistic shadows, " +
      "premium e-commerce photography.",
  };

  // ── state ────────────────────────────────────────────────────────
  let state = {
    products: [], index: 0, slot: 0,
    done: {}, pos: null, lastImageCount: 0,
  };

  const loadState = () =>
    chrome.storage.local
      .get({ products: [], index: 0, slot: 0, done: {}, pos: null, lastImageCount: 0 })
      .then((s) => { state = s; });

  const saveState = () => chrome.storage.local.set(state);

  const curProduct = () => state.products[state.index] || null;
  const curSlot    = () => SLOTS[state.slot];
  const doneKey    = (p, s) => `${p.id}|${s.file}`;
  const isDone     = (p, s) => Boolean(state.done[doneKey(p, s)]);
  const folderOf   = (p) => `${p.id}-${p.slug}`;
  const totalDone  = () => Object.keys(state.done).length;
  const totalSlots = () => state.products.length * SLOTS.length;

  // ── prompts ──────────────────────────────────────────────────────
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

  // ── helpers ──────────────────────────────────────────────────────
  const escapeHtml = (s) =>
    (s || "").replace(/[&<>"]/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  let statusTimer = null;
  function flashStatus(text, el) {
    if (!el) return;
    el.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.textContent = ""; }, 3200);
  }

  function advance() {
    state.slot += 1;
    if (state.slot >= SLOTS.length) {
      state.slot = 0;
      state.index = (state.index + 1) % state.products.length;
    }
  }

  // ================================================================
  //  HUD — bottom-centre pill bar
  // ================================================================
  let hud = null;

  function mountHud() {
    if (hud) return;
    hud = document.createElement("div");
    hud.id = "vx-hud";
    document.body.appendChild(hud);
  }

  function fetchImageCount(callback) {
    chrome.runtime.sendMessage({ type: "count-images" }, (res) => {
      if (res && typeof res.count === "number") callback(res.count);
      else callback(null);
    });
  }

  function currentOverallSlot() {
    return state.index * SLOTS.length + state.slot + 1;
  }

  function applyCountAndAutoAdvance(count, refreshBtn) {
    const p = curProduct();
    state.lastImageCount = count;
    if (p) {
      while (curProduct() && count >= currentOverallSlot()) advance();
      saveState();
      render();
    }
    if (refreshBtn) {
      const s = curSlot();
      const posLabel = p
        ? `${state.index + 1}/${state.products.length} · ${s.file}`
        : "no data";
      const lbl = refreshBtn.querySelector(".vx-pill-label");
      if (lbl) lbl.textContent = `${count} · ${posLabel}`;
      refreshBtn.disabled = false;
      refreshBtn.title = `Images saved: ${count}`;
    }
  }

  function renderHud() {
    mountHud();
    const p = curProduct();
    const s = curSlot();
    const posLabel = !p
      ? "no data"
      : `${state.lastImageCount} · ${state.index + 1}/${state.products.length} · ${s.file}`;

    hud.innerHTML = `
      <button id="vx-hud-copy-name" class="vx-pill vx-pill-name" title="Copy image filename">
        <span class="vx-pill-icon">📋</span>
        <span class="vx-pill-label">Copy Name</span>
      </button>
      <button id="vx-hud-copy-prompt" class="vx-pill vx-pill-prompt" title="Copy prompt">
        <span class="vx-pill-icon">✏️</span>
        <span class="vx-pill-label">Copy Prompt</span>
      </button>
      <button id="vx-hud-refresh" class="vx-pill vx-pill-refresh" title="Refresh image count from downloads">
        <span class="vx-pill-icon">🔄</span>
        <span class="vx-pill-label">${escapeHtml(posLabel)}</span>
      </button>
    `;

    document.getElementById("vx-hud-copy-name").addEventListener("click", () => {
      if (!p) return;
      const name = `${curSlot().file}.jpg`;
      navigator.clipboard.writeText(name).catch(() => {});
    });

    document.getElementById("vx-hud-copy-prompt").addEventListener("click", () => {
      if (!p) return;
      navigator.clipboard.writeText(buildPrompt(p, curSlot().view)).catch(() => {});
    });

    const refreshBtn = document.getElementById("vx-hud-refresh");
    refreshBtn.addEventListener("click", () => {
      if (refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      const lbl = refreshBtn.querySelector(".vx-pill-label");
      if (lbl) lbl.textContent = "reading…";
      fetchImageCount((count) => {
        if (count === null) {
          if (lbl) lbl.textContent = "⚠ watcher offline";
          refreshBtn.disabled = false;
          return;
        }
        applyCountAndAutoAdvance(count, document.getElementById("vx-hud-refresh"));
        renderHud();
      });
    });
  }

  // ================================================================
  //  MAIN PANEL (draggable widget)
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
      Object.assign(root.style, {
        top: `${state.pos.top}px`, left: `${state.pos.left}px`,
        right: "auto", bottom: "auto",
      });
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
      const top  = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - drag.dy));
      const left = Math.max(0, Math.min(window.innerWidth  - 120, e.clientX - drag.dx));
      Object.assign(root.style, { top: `${top}px`, left: `${left}px`, right: "auto", bottom: "auto" });
      state.pos = { top, left };
    });
    document.addEventListener("pointerup", () => { if (drag) { drag = null; saveState(); } });
  }

  // ── slot progress bar ────────────────────────────────────────────
  function slotBar(p) {
    return SLOTS.map((sl, i) => {
      const done = isDone(p, sl);
      const cur  = i === state.slot;
      const cls  = [
        "vx-slot",
        done ? "vx-slot-done" : "",
        cur  ? "vx-slot-cur"  : "",
      ].join(" ").trim();
      return `<div class="${cls}" data-i="${i}" title="${sl.label}">
        <span class="vx-slot-dot"></span>
        <span class="vx-slot-label">${sl.file}</span>
      </div>`;
    }).join("");
  }

  function progressPct() {
    if (!totalSlots()) return 0;
    return Math.round((totalDone() / totalSlots()) * 100);
  }

  function panelHTML() {
    const p = curProduct(), s = curSlot();
    const pct = progressPct();
    const options = state.products.map((prod, i) =>
      `<option value="${i}" ${i === state.index ? "selected" : ""}>${escapeHtml(prod.name)}</option>`
    ).join("");

    return `
      <div class="vx-head" id="vx-head">
        <div class="vx-head-title">
          <span class="vx-logo">⚡</span>
          <span>Vertex Collector</span>
        </div>
        <span class="vx-count">${totalDone()}/${totalSlots()}</span>
      </div>

      <div class="vx-progress-track">
        <div class="vx-progress-bar" style="width:${pct}%"></div>
      </div>

      <div class="vx-body">
        <select id="vx-select">${options}</select>

        <div class="vx-product-row">
          <button id="vx-prev-p" class="vx-nav-btn" title="Previous product">‹</button>
          <div class="vx-product-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
          <button id="vx-next-p" class="vx-nav-btn" title="Next product">›</button>
        </div>
        <div class="vx-product-idx">${state.index + 1} / ${state.products.length}</div>

        <div class="vx-slots-row">
          ${slotBar(p)}
        </div>

        <div class="vx-slot-info">
          <span class="vx-slot-badge">${s.file}</span>
          <span class="vx-slot-desc">${s.label}</span>
        </div>

        <textarea id="vx-prompt" readonly rows="4">${escapeHtml(buildPrompt(p, s.view))}</textarea>

        <div class="vx-filename">
          <span class="vx-filename-prefix">save as</span>
          <code>${escapeHtml(folderOf(p))}/<b>${s.file}.jpg</b></code>
        </div>

        <div class="vx-actions">
          <button id="vx-copy" class="vx-btn vx-btn-primary">
            <span>✏️</span> Copy Prompt
          </button>
          <div class="vx-slot-nav">
            <button id="vx-prev-s" class="vx-btn vx-btn-ghost" title="Previous slot">◀</button>
            <button id="vx-next-s" class="vx-btn vx-btn-ghost" title="Next slot">▶</button>
          </div>
        </div>

        <div id="vx-status"></div>

        <div class="vx-foot">
          <label class="vx-filebtn">
            <span>📂</span> Import JSON
            <input type="file" id="vx-import" accept=".json">
          </label>
          <button id="vx-clear" class="vx-reset-btn">Reset</button>
        </div>
      </div>`;
  }

  function importerHTML() {
    return `
      <div class="vx-head" id="vx-head">
        <div class="vx-head-title">
          <span class="vx-logo">⚡</span>
          <span>Vertex Collector</span>
        </div>
      </div>
      <div class="vx-body vx-body-import">
        <div class="vx-import-icon">📦</div>
        <p class="vx-import-title">Get started</p>
        <p class="vx-import-desc">
          Import <strong>products.json</strong> to begin.<br>
          For each slot: copy the prompt, generate in ChatGPT yourself,
          then click ⬇ on the result — it saves with the exact filename the pipeline expects.
        </p>
        <label class="vx-filebtn vx-filebtn-big">
          <span>📂</span> Import products.json
          <input type="file" id="vx-import" accept=".json">
        </label>
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
        if (!Array.isArray(data) || !data.length)
          throw new Error("expected a non-empty JSON array");
        state.products = data.map((p, i) => {
          const id   = String(p.id ?? i + 1);
          const name = p.name || `product-${id}`;
          return { id, name, category: p.category || "", slug: p.slug || slugify(name) };
        });
        state.index = 0; state.slot = 0;
        return saveState().then(() => { render(); renderHud(); });
      }).catch((err) => alert(`Import failed: ${err.message}`));
    });

    const sel = document.getElementById("vx-select");
    if (sel) sel.addEventListener("change", () => {
      state.index = Number(sel.value); state.slot = 0;
      saveState(); render(); renderHud();
    });

    const panelStatus = () => document.getElementById("vx-status");
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };

    on("vx-copy", () => {
      const p = curProduct(); if (!p) return;
      const prompt = buildPrompt(p, curSlot().view);
      navigator.clipboard.writeText(prompt)
        .then(() => flashStatus("✓ Prompt copied — paste it into ChatGPT", panelStatus()))
        .catch(() => {
          const ta = document.getElementById("vx-prompt");
          ta.select(); document.execCommand("copy");
          flashStatus("✓ Prompt copied", panelStatus());
        });
    });

    on("vx-prev-s", () => {
      state.slot = (state.slot + SLOTS.length - 1) % SLOTS.length;
      saveState(); render(); renderHud();
    });
    on("vx-next-s", () => {
      advance(); saveState(); render(); renderHud();
    });
    on("vx-prev-p", () => {
      state.index = (state.index + state.products.length - 1) % state.products.length;
      state.slot = 0; saveState(); render(); renderHud();
    });
    on("vx-next-p", () => {
      state.index = (state.index + 1) % state.products.length;
      state.slot = 0; saveState(); render(); renderHud();
    });
    on("vx-clear", () => {
      if (confirm("Forget imported products AND saved-slot history?")) {
        state = { products: [], index: 0, slot: 0, done: {}, pos: state.pos, lastImageCount: 0 };
        saveState(); render(); renderHud();
      }
    });

    document.querySelectorAll(".vx-slot[data-i]").forEach((el) =>
      el.addEventListener("click", () => {
        state.slot = Number(el.dataset.i);
        saveState(); render(); renderHud();
      })
    );
  }

  // ================================================================
  //  SAVE OVERLAY — hover button on generated images
  // ================================================================
  let saveBtn = null, hoverImg = null;

  // ChatGPT image src patterns
  const isChatGptImage = (src) =>
    /oaiusercontent\.com|oaistatic\.com|openai\.com/.test(src || "");

  function isProductImage(el) {
    if (!el || el.tagName !== "IMG") return false;
    const big = Math.max(el.clientWidth, el.naturalWidth || 0) >= 380;
    return big && isChatGptImage(el.src);
  }

  function hideSaveBtn() {
    if (saveBtn) { saveBtn.remove(); saveBtn = null; hoverImg = null; }
  }

  function showSaveBtn(img) {
    hideSaveBtn();
    hoverImg = img;
    const r = img.getBoundingClientRect();
    const p = curProduct(), s = curSlot();
    saveBtn = document.createElement("button");
    saveBtn.id = "vertex-save-overlay";
    saveBtn.innerHTML = p
      ? `<span class="vx-save-icon">⬇</span><span>Save as <b>${s.file}.jpg</b></span>`
      : `<span class="vx-save-icon">⬇</span><span>Import products.json first</span>`;
    saveBtn.style.top  = `${Math.max(r.top + window.scrollY, 0) + 6}px`;
    saveBtn.style.left = `${r.left + window.scrollX + r.width - 6}px`;
    saveBtn.addEventListener("click", onSaveClick);
    document.body.appendChild(saveBtn);
  }

  function onSaveClick() {
    const p = curProduct(), s = curSlot();
    if (!p || !hoverImg) return;
    const filename = `vertex-products/${folderOf(p)}/${s.file}.jpg`;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="vx-save-icon">⏳</span><span>Saving…</span>`;
    chrome.runtime.sendMessage({ type: "save-image", url: hoverImg.src, filename }, (res) => {
      const err = chrome.runtime.lastError;
      if (err || !res || !res.ok) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<span class="vx-save-icon">⚠</span><span>Failed — try again</span>`;
        return;
      }
      state.done[doneKey(p, s)] = { ts: new Date().toISOString(), filename: res.finalName };
      advance();
      saveState();
      render();
      renderHud();
      const st = document.getElementById("vx-status");
      flashStatus(
        `✓ Saved ${s.file}.jpg — next: ${curSlot().file} for ${curProduct()?.name}`,
        st
      );
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
