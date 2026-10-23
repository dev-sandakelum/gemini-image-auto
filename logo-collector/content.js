/* Logo Collector — brand logo generator assistant for gemini.google.com
   Reads tech_brands.json, generates one logo per brand,
   copies prompts to clipboard, and saves images as brand-logos/<slug>/logo.png */
(() => {
  "use strict";

  // ── Prompt template ─────────────────────────────────────────────────────────
  // Maps category keywords → logo style personality
  const CATEGORY_PERSONALITY = {
    "cpu":             "precise, engineered, technical — circuit-grid or silicon-wafer motif",
    "gpu":             "powerful, high-performance — angular speed lines or pixel-burst motif",
    "apu":             "dual-nature, balanced — split or fused shape motif",
    "motherboard":     "interconnected, structural — circuit trace or grid motif",
    "ram":             "fast, modular — parallel lines or stack motif",
    "ssd":             "sleek, fast, minimal — flash-bolt or chip motif",
    "storage":         "reliable, layered — concentric rings or stack motif",
    "psu":             "powerful, charged — lightning bolt or coil motif",
    "cooling":         "cool, flowing — wave, snowflake or fin motif",
    "cases":           "structural, protective — frame or shell motif",
    "case":            "structural, protective — frame or shell motif",
    "monitor":         "display, clarity — screen-frame or lens motif",
    "display":         "display, clarity — screen-frame or lens motif",
    "peripheral":      "precise, tactile — hexagonal grid or dot motif",
    "keyboard":        "tactile, mechanical — key-cap or switch motif",
    "mouse":           "ergonomic, fast — smooth curve or crosshair motif",
    "gaming":          "aggressive, bold — angular claw or shield motif",
    "networking":      "connected, radial — signal wave or node motif",
    "laptop":          "mobile, modern — slim diagonal or wing motif",
    "desktop":         "powerful, grounded — cube or tower motif",
    "audio":           "rich, resonant — waveform or note motif",
    "webcam":          "focused, sharp — aperture or eye motif",
    "streaming":       "live, broadcast — play-button or antenna motif",
    "charging":        "energetic, portable — battery or bolt motif",
    "mobile":          "light, wireless — arc or wave motif",
    "cable":           "connector, bridge — link-chain or plug motif",
    "dock":            "hub, versatile — sunburst or port motif",
    "hub":             "central, radial — node-ring motif",
    "tablet":          "creative, stylus — pen-nib or canvas motif",
    "controller":      "grip, precision — d-pad or joystick motif",
    "phone":           "sleek, modern — rounded rectangle motif",
    "thermal":         "heat-dissipation — heat-fins or flame motif",
    "oem":             "neutral, clean — minimal geometric mark",
  };

  const DEFAULT_PERSONALITY = "professional, technical — clean geometric mark";

  function resolvePersonality(category) {
    const c = (category || "").toLowerCase();
    for (const [k, v] of Object.entries(CATEGORY_PERSONALITY)) {
      if (c.includes(k)) return v;
    }
    return DEFAULT_PERSONALITY;
  }

  // Maps mythological origin keywords → visual flavour
  const MYTH_FLAVOUR = {
    "roman":     "Roman classical marble and iron aesthetic",
    "greek":     "Greek classical geometry and golden-ratio aesthetics",
    "norse":     "Norse runic angular forms and iron-age craftsmanship",
    "arthurian": "Medieval Arthurian heraldic shield aesthetic",
    "alchemy":   "Alchemical symbol aesthetic — circles and triangles",
    "fantasy":   "modern fantasy brand — clean and bold",
    "folklore":  "folklore-inspired organic natural shapes",
    "fairy":     "fairy tale soft organic curves",
    "mythical":  "mythical creature-inspired bold silhouette",
  };

  function resolveFlavour(origin) {
    const o = (origin || "").toLowerCase();
    for (const [k, v] of Object.entries(MYTH_FLAVOUR)) {
      if (o.includes(k)) return v;
    }
    return "modern tech brand aesthetic";
  }

  // ── Style / font / color variety ────────────────────────────────────────────
  // These give each brand a distinct, deterministic (same brand → same result)
  // combination instead of every logo defaulting to the same layout.

  const LOGO_CONSTRUCTIONS = [
    "abstract geometric emblem — the icon built from simple overlapping shapes (circles, triangles, hexagons)",
    "lettermark monogram — a stylised single or double initial standing in as the icon",
    "badge / crest emblem — icon and name contained inside a rounded shield or circular badge frame",
    "linework icon mark — a single-weight continuous-line icon paired with the wordmark",
    "negative-space icon — the motif formed using negative space within a simple container shape",
    "pictorial icon mark — a simplified, iconic representation of the brand's motif rendered as a solid silhouette",
    "dynamic angled mark — the icon built from diagonal, motion-implying slashes or chevrons",
  ];

  const FONT_STYLES = [
    "a tight geometric sans-serif (think Century Gothic / Poppins energy), all-caps, evenly spaced",
    "a bold condensed sans-serif with slightly squared letterforms, all-caps, tightly tracked",
    "a technical grotesk sans-serif with a couple of cut or angled corners on select letters",
    "a modern slab-serif with confident, blocky strokes for a grounded, premium feel",
    "a semi-monospaced technical typeface evoking circuit-board silkscreen labelling",
    "a sleek thin-to-medium weight sans-serif with generous letter-spacing for a premium minimal feel",
    "a sharp italic-leaning sans-serif that suggests speed and motion",
  ];

  const COLOR_PALETTES = [
    "electric blue (#2563EB) and graphite black (#1A1A1A), with a single white accent",
    "crimson red (#DC2626) and charcoal grey (#262626), high contrast",
    "emerald green (#10B981) and deep slate (#1E293B)",
    "violet-purple (#7C3AED) and near-black (#18181B), with a soft neon glow accent",
    "burnt orange (#EA580C) and graphite (#27272A), rugged and energetic",
    "cyan (#06B6D4) and midnight navy (#0F172A), cool and futuristic",
    "gold/amber (#D97706) and matte black (#1C1917), premium and bold",
    "monochrome silver-grey (#9CA3AF) on black (#111111), industrial and understated",
  ];

  // small deterministic string hash so the same brand always gets the same
  // construction/font/palette across re-generations, but different brands vary
  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function pick(list, seed, offset) {
    const h = hashString(seed + ":" + offset);
    return list[h % list.length];
  }

  /**
   * Build the full logo generation prompt for a brand.
   * @param {{ name: string, category: string, origin: string, slug?: string }} brand
   */
  function buildPrompt(brand) {
    const name        = (brand.name     || "").trim();
    const category    = (brand.category || "").trim();
    const origin      = (brand.origin   || "").trim();
    const personality = resolvePersonality(category);
    const flavour     = resolveFlavour(origin);

    const seed        = brand._styleSeed || brand.slug || slugify(name);
    const construction = pick(LOGO_CONSTRUCTIONS, seed, 1);
    const font          = pick(FONT_STYLES, seed, 2);
    const palette       = pick(COLOR_PALETTES, seed, 3);

    return (
      `Create a professional brand logo for a tech company called "${name}". ` +

      `BRAND PERSONALITY: ${personality}. ` +
      `VISUAL INSPIRATION: ${flavour}. ` +
      `PRODUCT CATEGORY: ${category} manufacturer. ` +

      `LOGO CONSTRUCTION: ${construction}. ` +
      `TYPOGRAPHY: Set the brand name in ${font}. ` +
      `COLOR PALETTE: ${palette}. Use these as the only colors in the mark — no rainbow gradients. ` +

      `LOGO REQUIREMENTS: ` +
      `Design a clean, modern, memorable logo mark combining a distinctive icon/symbol ` +
      `with the brand name "${name}" in the specified typeface. ` +
      `The icon should be unique to the brand's personality and mythological inspiration, ` +
      `and should visually echo one detail from the product category (e.g. a subtle nod to ` +
      `circuitry, airflow, speed, or structure depending on what the brand makes). ` +

      `STYLE: Flat vector style, scalable, suitable for use on product packaging, ` +
      `website headers, and product stickers. ` +
      `Professional tech company logo quality (think ASUS, Corsair, NZXT, or AMD level). ` +
      `Clean, sharp linework. Flat color fills only — no gradients, no drop shadows, no bevels. ` +
      `No decorative borders or frames around the logo unless the construction style calls for a badge/crest. ` +

      `COMPOSITION: Icon to the left of the brand name, or icon above the brand name — ` +
      `whichever suits the construction style best. ` +
      `Logo centered on a pure white background (#FFFFFF). ` +
      `Generous, even padding around the logo mark. ` +
      `Square 1:1 canvas, 720p. ` +

      `STRICT RULES: ` +
      `The exact brand name "${name}" must appear clearly and legibly in the logo, ` +
      `set in the specified typeface. ` +
      `No other text, taglines, or made-up product names. ` +
      `No photorealistic elements — vector/graphic design only. ` +
      `No watermarks, no additional logos, no extra symbols. ` +
      `Single logo mark only — do not show multiple logo variations.`
    );
  }

  // ── Slugify ──────────────────────────────────────────────────────────────────
  function slugify(name) {
    return (name || "")
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .slice(0, 60) || "brand";
  }

  // ── State (persisted in chrome.storage.local) ────────────────────────────────
  let state = {
    brands: [],   // imported array of { name, category, origin, slug }
    index: 0,     // current brand index
    done: {},     // { slug: { ts, finalName } }
    pos: null,    // draggable widget position
  };

  const loadState  = () =>
    chrome.storage.local.get({ brands: [], index: 0, done: {}, pos: null })
      .then((s) => { state = s; });
  const saveState  = () => chrome.storage.local.set(state);

  const curBrand   = () => state.brands[state.index] || null;
  const isDone     = (b) => Boolean(b && state.done[b.slug]);
  const totalDone  = () => Object.keys(state.done).length;

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function esc(s) {
    return (s || "").replace(/[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  let statusTimer = null;
  function flash(text, el) {
    if (!el) return;
    el.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { if (el) el.textContent = ""; }, 3500);
  }

  // ── Main panel ────────────────────────────────────────────────────────────────
  let root = null;

  function mount() {
    if (!root) {
      root = document.createElement("div");
      root.id = "logo-widget";
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
      if (!e.target.closest("#lg-head")) return;
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

  // ── Panel HTML ────────────────────────────────────────────────────────────────
  function panelHTML() {
    const b = curBrand();
    const progress  = `${totalDone()} / ${state.brands.length}`;
    const promptTxt = b ? buildPrompt(b) : "";
    const filename  = b ? `brand-logos/${b.slug}/logo.png` : "";

    // Mini brand list — show current ± 2 neighbours
    const listItems = state.brands
      .slice(Math.max(0, state.index - 2), state.index + 5)
      .map((br, relIdx) => {
        const absIdx = Math.max(0, state.index - 2) + relIdx;
        const active = absIdx === state.index;
        const done   = isDone(br);
        return `<div class="lg-list-item ${active ? "lg-active" : ""} ${done ? "lg-done" : ""}"
                     data-idx="${absIdx}" title="${esc(br.category)}">
                  ${done ? "✓ " : ""}${esc(br.name)}
                </div>`;
      }).join("");

    return `
      <div class="lg-head" id="lg-head">
        <span>Logo Collector</span>
        <span class="lg-count">${progress} done</span>
      </div>
      <div class="lg-body">

        <div class="lg-brand-name">${esc(b ? b.name : "—")}</div>
        <div class="lg-meta">${esc(b ? b.category : "")} · ${esc(b ? b.origin : "")}</div>

        <div class="lg-list">${listItems}</div>

        <textarea id="lg-prompt" readonly rows="5">${esc(promptTxt)}</textarea>
        <div class="lg-file">save as: <b>${esc(filename)}</b></div>

        <div class="lg-row">
          <button id="lg-copy" class="lg-primary">📋 Copy Prompt</button>
          <button id="lg-reroll" title="Re-roll style/font/color for this brand">🎲 reroll</button>
        </div>
        <div class="lg-row">
          <button id="lg-prev">◀ prev</button>
          <button id="lg-skip" title="Skip this brand (mark done without saving)">⏩ skip</button>
          <button id="lg-next">next ▶</button>
        </div>

        <div id="lg-status"></div>

        <div class="lg-foot">
          <label class="lg-filebtn">
            Import tech_brands.json
            <input type="file" id="lg-import" accept=".json">
          </label>
          <button id="lg-clear">reset</button>
        </div>
      </div>`;
  }

  function importerHTML() {
    return `
      <div class="lg-head" id="lg-head"><span>Logo Collector</span></div>
      <div class="lg-body">
        <p>Import <b>tech_brands.json</b> to begin.<br>
        For each brand: copy the prompt → paste into Gemini → generate →
        click ⬇ on the result to save it with the correct filename.<br>
        Not liking the look? Hit 🎲 reroll for a different style/font/color mix.</p>
        <label class="lg-filebtn lg-filebtn-big">
          Import tech_brands.json
          <input type="file" id="lg-import" accept=".json">
        </label>
        <div id="lg-status"></div>
      </div>`;
  }

  function render() {
    mount().innerHTML = state.brands.length ? panelHTML() : importerHTML();
    bindEvents();
  }

  function bindEvents() {
    // Import file
    const fileInput = document.getElementById("lg-import");
    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        const f = e.target.files[0];
        if (!f) return;
        f.text().then((txt) => {
          const data = JSON.parse(txt);
          // Accept { brands: [...] } or a raw array
          const arr = Array.isArray(data) ? data
                    : Array.isArray(data.brands) ? data.brands
                    : null;
          if (!arr || arr.length === 0) throw new Error("Expected a non-empty brands array");
          state.brands = arr.map((b) => ({
            name:     (b.name     || "").trim(),
            category: (b.category || "").trim(),
            origin:   (b.origin   || "").trim(),
            slug:     slugify(b.name),
            reroll:   0,
          }));
          state.index = 0;
          return saveState().then(() => { render(); renderHud(); });
        }).catch((err) => alert(`Import failed: ${err.message}`));
      });
    }

    const st = () => document.getElementById("lg-status");

    // Copy prompt
    const copyBtn = document.getElementById("lg-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const b = curBrand(); if (!b) return;
        const prompt = buildPrompt(b);
        navigator.clipboard.writeText(prompt)
          .then(() => flash("Prompt copied — paste into Gemini ✓", st()))
          .catch(() => {
            const ta = document.getElementById("lg-prompt");
            ta.select(); document.execCommand("copy");
            flash("Prompt copied ✓", st());
          });
      });
    }

    // Navigation
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };

    // Re-roll style/font/color for the current brand — the filename slug
    // stays put, only the style seed (and therefore the picked construction/
    // font/palette) changes, so you get a different look to try.
    on("lg-reroll", () => {
      const b = curBrand(); if (!b) return;
      b.reroll = (b.reroll || 0) + 1;
      b._styleSeed = `${b.slug}#${b.reroll}`;
      saveState(); render();
    });

    on("lg-prev", () => {
      state.index = (state.index - 1 + state.brands.length) % state.brands.length;
      saveState(); render(); renderHud();
    });
    on("lg-next", () => {
      state.index = (state.index + 1) % state.brands.length;
      saveState(); render(); renderHud();
    });
    on("lg-skip", () => {
      const b = curBrand(); if (!b) return;
      state.done[b.slug] = { ts: new Date().toISOString(), finalName: "skipped" };
      state.index = Math.min(state.index + 1, state.brands.length - 1);
      saveState(); render(); renderHud();
    });
    on("lg-clear", () => {
      if (confirm("Reset all imported brands and saved progress?")) {
        state = { brands: [], index: 0, done: {}, pos: state.pos };
        saveState(); render(); renderHud();
      }
    });

    // Click a brand in the mini list
    document.querySelectorAll(".lg-list-item[data-idx]").forEach((el) => {
      el.addEventListener("click", () => {
        state.index = parseInt(el.dataset.idx, 10);
        saveState(); render(); renderHud();
      });
    });
  }

  // ── HUD (bottom-centre pills) ─────────────────────────────────────────────────
  let hud = null;

  // ── Image counter — asks background for the real count from count-server ──────
  function fetchImageCount(callback) {
    chrome.runtime.sendMessage({ type: "count-images" }, (res) => {
      if (res && typeof res.count === "number") callback(res.count);
      else callback(null); // count-server not running
    });
  }

  function renderHud() {
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "lg-hud";
      document.body.appendChild(hud);
    }

    const b = curBrand();
    const posLabel = b
      ? `${state.index + 1}/${state.brands.length} · ${b.slug}`
      : "no data";

    hud.innerHTML = `
      <button id="lg-hud-copy" class="lg-pill lg-pill-copy" title="Copy prompt for current brand">
        <span class="lg-pill-icon">📋</span>
        <span class="lg-pill-label">Copy Prompt</span>
      </button>
      <button id="lg-hud-refresh" class="lg-pill lg-pill-refresh" title="Refresh image count from count-server">
        <span class="lg-pill-icon">🔄</span>
        <span class="lg-pill-label">${esc(posLabel)}</span>
      </button>
      <button id="lg-hud-next" class="lg-pill lg-pill-next" title="Advance to next brand">
        <span class="lg-pill-icon">▶</span>
        <span class="lg-pill-label">Next Brand</span>
      </button>
    `;

    document.getElementById("lg-hud-copy").addEventListener("click", () => {
      const br = curBrand(); if (!br) return;
      navigator.clipboard.writeText(buildPrompt(br)).catch(() => {});
    });

    // Refresh: fetch count → set index to count-1 (count=1 → brand[0], count=2 → brand[1], …)
    // Works forward AND backward — just set count-server to the image number you want.
    const refreshBtn = document.getElementById("lg-hud-refresh");
    refreshBtn.addEventListener("click", () => {
      if (refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      const labelEl = refreshBtn.querySelector(".lg-pill-label");
      if (labelEl) labelEl.textContent = "reading…";
      fetchImageCount((count) => {
        if (count === null) {
          if (labelEl) labelEl.textContent = "⚠ server offline";
          refreshBtn.disabled = false;
          return;
        }
        // count is the number of images saved; brand index = count (count=1 → brand[1] = 2nd)
        const newIndex = Math.max(0, Math.min(state.brands.length - 1, count));
        state.index = newIndex;
        saveState();
        render();
        renderHud();  // re-render so label reflects new position
        // update label after re-render
        const btn = document.getElementById("lg-hud-refresh");
        if (btn) {
          const br = curBrand();
          const pos = br ? `${state.index + 1}/${state.brands.length} · ${br.slug}` : "no data";
          const lbl = btn.querySelector(".lg-pill-label");
          if (lbl) lbl.textContent = `${count} → ${pos}`;
          btn.title = `Synced to image count ${count}`;
        }
      });
    });

    document.getElementById("lg-hud-next").addEventListener("click", () => {
      state.index = (state.index + 1) % state.brands.length;
      saveState(); render(); renderHud();
    });
  }

  // ── Save overlay on generated images ─────────────────────────────────────────
  let saveBtn = null, hoverImg = null;

  const fullResSrc = (src) => src.replace(/=[a-z]\d+.*$/, "=s0");

  function isGeneratedImage(el) {
    if (!el || el.tagName !== "IMG") return false;
    const big = Math.max(el.clientWidth, el.naturalWidth || 0) >= 380;
    return big && /googleusercontent|googleapis\.com/.test(el.src || "");
  }

  function hideSaveBtn() {
    if (saveBtn) { saveBtn.remove(); saveBtn = null; hoverImg = null; }
  }

  function showSaveBtn(img) {
    hideSaveBtn();
    hoverImg = img;
    const r = img.getBoundingClientRect();
    const b = curBrand();
    saveBtn = document.createElement("button");
    saveBtn.id = "logo-save-overlay";
    saveBtn.textContent = b
      ? `⬇ Save logo — ${b.slug}/logo.png`
      : "⬇ Import tech_brands.json first";
    saveBtn.style.top  = `${Math.max(r.top + window.scrollY, 0) + 6}px`;
    saveBtn.style.left = `${r.left + window.scrollX + r.width - 6}px`;
    saveBtn.addEventListener("click", onSaveClick);
    document.body.appendChild(saveBtn);
  }

  function onSaveClick() {
    const b = curBrand();
    if (!b || !hoverImg) return;
    const filename = `brand-logos/${b.slug}/logo.png`;
    saveBtn.disabled    = true;
    saveBtn.textContent = "Saving…";

    chrome.runtime.sendMessage(
      { type: "save-logo", url: fullResSrc(hoverImg.src), filename },
      (res) => {
        const err = chrome.runtime.lastError;
        if (err || !res || !res.ok) {
          saveBtn.disabled    = false;
          saveBtn.textContent = "Failed — try again";
          return;
        }
        // Mark brand as done
        state.done[b.slug] = { ts: new Date().toISOString(), finalName: res.finalName };
        // Auto-advance to next brand
        state.index = Math.min(state.index + 1, state.brands.length - 1);
        saveState();
        render();
        renderHud();
        hideSaveBtn();
      }
    );
  }

  document.addEventListener("mouseover", (e) => {
    if (saveBtn && saveBtn.contains(e.target)) return;
    if (hoverImg && hoverImg.contains(e.target)) return;
    if (isGeneratedImage(e.target)) showSaveBtn(e.target);
    else hideSaveBtn();
  }, true);

  // ── Boot ──────────────────────────────────────────────────────────────────────
  loadState().then(() => { render(); renderHud(); });
})();