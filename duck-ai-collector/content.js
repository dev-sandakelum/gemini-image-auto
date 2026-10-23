/* Duck.ai Product Image Collector — content.js
   ─────────────────────────────────────────────────────────────────────────────
   Workflow per image entry:
     1. Click "New Image" button
     2. Wait for prompt input to appear
     3. Attach the brand logo PNG (read from extension's brand-logos/ folder)
     4. Type the prompt and submit
     5. Poll for aria-label="Download image" button (image is ready)
     6. Register target filename → click Download → background renames the file
     7. Mark done, advance, repeat
   ─────────────────────────────────────────────────────────────────────────────
*/

(() => {
  "use strict";

  // ── Constants ────────────────────────────────────────────────────────────────
  const WIDGET_ID        = "dai-widget";
  const HUD_ID           = "dai-hud";
  const POLL_MS          = 600;
  const DOWNLOAD_TIMEOUT = 180_000;   // 3 min max for GPT-Image-2
  const SUBMIT_DELAY_MS  = 600;
  const DEFAULT_QUEUE_URL = "queue/images_part1.json";

  const SEL = {
    newImageBtn: 'button[aria-label*="New Image"], button[aria-label*="Image"]',
    submitBtn:   'button[aria-label="Send message"], button[type="submit"]',
    downloadBtn: 'button[aria-label="Download image"]',
    // Exact selectors from live duck.ai DOM inspection:
    attachBtn:   '[data-testid="duckai-attach-button"], button[aria-label="Add images or PDFs"]',
    fileInput:   'input[type="file"][name="upload"], input[type="file"][accept*="image"]',
    chatInput:   '[data-testid="duckai-chat-input"]',
  };

  // ── Brand → logo filename mapping ─────────────────────────────────────────────
  // Key  = lowercase first word of product alt text (the brand name)
  // Value = filename inside brand-logos/ folder (without extension)
  // fetchLogoFile() tries .jpg first, then .png.
  const DEFAULT_BRAND_MAP = {
    // ── New images_partN.json brands ───────────────────────────────────────────
    "ashenfire":   "ashenfire-graphics",
    "bramblecore": "bramblecore-memory",
    "cerberus":    "cerberus-tech",
    "cindergate":  "cindergate-chassis",
    "colossuscore":"colossuscore",
    "copperfen":   "copperfen-tech",
    "copperthorn": "copperthorn-controllers",
    "direwood":    "direwood-boards",
    "dragonroot":  "dragonroot-capture",
    "duneshadow":  "duneshadow-optics",
    "duskrend":    "duskrend-mobile",
    "emberforge":  "emberforge-power",
    "excalibur":   "excalibur-peripherals",
    "fenriswolf":  "fenriswolf",
    "frostpine":   "frostpine-systems",
    "frostvane":   "frostvane-thermal",
    "griffinhold": "griffinhold",
    "hearthspire": "hearthspire-pcs",
    "hollowmere":  "hollowmere-drives",
    "hydra":       "hydra-systems",
    "ironvale":    "ironvale-modules",
    "ivory":       "ivory-spire",
    "kraken":      "kraken-cooling",
    "larkspur":    "larkspur-storage",
    "lorewood":    "lorewood-docks",
    "minotaur":    "minotaur-labs",
    "mistvale":    "mistvale-webcams",
    "nettlecross": "nettlecross-boards",
    "ninthgate":   "ninthgate-keys",
    "odinforge":   "odinforge",
    "palewind":    "palewind-displays",
    "phoenix":     "phoenix-circuit",
    "promethion":  "promethion",
    "quicksilver": "quicksilver-vault",
    "ragnarok":    "ragnarok-silicon",
    "sablewick":   "sablewick-cables",
    "shadowmere":  "shadowmere-pc",
    "sphinxware":  "sphinxware",
    "stonehelm":   "stonehelm-chips",
    "stormvane":   "stormvane-connect",
    "thornhollow": "thornhollow-hubs",
    "thornwood":   "thornwood-audio",
    "titanforge":  "titanforge",
    "valkyrie":    "valkyrie-gear",
    "vulcanis":    "vulcanis",
    "wolfsbane":   "wolfsbane-gaming",
    "wraithlink":  "wraithlink-networks",
    "wyrmforge":   "wyrmforge",
    "wyrmscale":   "wyrmscale-graphics",
    "ymir":        "ymir-core",
    // Missing brands → best available logo match
    "alabaster":   "glimmerdust-cases",
    "alderfrost":  "frostpine-systems",
    "ashfall":     "ashenfire-graphics",
    "banshee":     "wraithlink-networks",
    "direwatch":   "direwood-boards",
    "emberfall":   "emberforge-power",
    "emberlight":  "emberforge-power",
    "ferngully":   "larkspur-storage",
    "ironclad":    "ironvale-modules",
    "morrigan":    "fenriswolf",
    "nightjar":    "starling-wing",
    "ravenscar":   "ragnarok-silicon",
    "silverbrook":  "ivory-spire",
    "silverfang":  "fenriswolf",
    "siren":       "hydra-systems",
    "thistledown": "larkspur-storage",
    "windmere":    "stormvane-connect",
    "windrider":   "stormvane-connect",
    // ── Old product_images.json brands (kept for backward compat) ──────────────
    "nova":    "nova",
    "apex":    "apex",
    "bolt":    "bolt",
    "frost":   "frost",
    "surge":   "surge",
    "titan":   "titan",
    "volt":    "volt",
    "storm":   "storm",
    "pulse":   "pulse",
    "lens":    "lens",
    "wave":    "wave",
    "soundx":  "soundx",
    "boombox": "boombox",
  };

  // ── State ─────────────────────────────────────────────────────────────────────
  let state = {
    images:   [],
    index:    0,
    done:     {},
    running:  false,
    paused:   false,
    pos:      null,
    brandMap: null,  // loaded from storage or DEFAULT_BRAND_MAP
  };

  const loadState = () =>
    chrome.storage.local.get({
      images: [], index: 0, done: {}, running: false,
      paused: false, pos: null, brandMap: null,
    }).then((s) => {
      state = { ...state, ...s };
      if (!state.brandMap) state.brandMap = { ...DEFAULT_BRAND_MAP };
    });

  async function loadBundledQueue() {
    const url = chrome.runtime.getURL(DEFAULT_QUEUE_URL);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load bundled queue (${response.status})`);
    const raw = await response.json();
    const flat = normalizeQueue(raw);
    if (!flat.length) throw new Error("Bundled part1.json has no usable image entries");
    state.images = flat;
    state.index = 0;
    state.done = {};
    await saveState();
    console.log(`[Duck.ai Collector] Loaded bundled part1.json (${flat.length} images)`);
  }

  const saveState = () => chrome.storage.local.set({
    images:   state.images,
    index:    state.index,
    done:     state.done,
    running:  state.running,
    paused:   state.paused,
    pos:      state.pos,
    brandMap: state.brandMap,
  });

  const doneKey = (img) => {
    const p = (img?.path || "").trim();
    const product = img?.product_id ?? "unknown-product";
    const n = img?.name || `img_${img?.id ?? "unknown"}`;
    return `${p || `product_${product}/`}${n}`;
  };

  function normalizeQueue(raw) {
    let flat = [];
    if (Array.isArray(raw) && raw[0] && Array.isArray(raw[0].images)) {
      flat = raw.flatMap((product) => (product.images || []).map((img) => ({
        ...img,
        name: img.name || (img.url || "").split("/").pop() || "",
        path: img.path || product.path || (img.url || "").replace(/[^/]+$/, ""),
        product_id: img.product_id ?? product.product_id ?? product.id,
        brand: img.brand || product.brand || "",
        productName: img.productName || product.name || "",
        description: img.description || product.shortDescription || "",
      })));
    } else if (Array.isArray(raw)) {
      flat = raw.map((img) => ({ ...img, path: img?.path || "" }));
    } else if (Array.isArray(raw?.images)) {
      flat = raw.images.map((img) => ({ ...img, path: img?.path || "" }));
    }
    return flat.filter((img) => img && (img.name || img.id));
  }
  const isDone    = (img) => Boolean(img && state.done[doneKey(img)]);
  const curImage  = ()    => state.images[state.index] || null;
  const totalDone = ()    => Object.keys(state.done).length;

  // ── Brand logo resolution ─────────────────────────────────────────────────────
  // Extracts the brand name from the alt text ("Nova RTX 9090 …" → "nova")
  // then looks it up in brandMap → returns the logo slug or null.
  function brandSlugFromAlt(alt) {
    const first = (alt || "").split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    return (state.brandMap || {})[first] || null;
  }

  function brandSlugForImage(img) {
    const brand = (img?.brand || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    return (state.brandMap || {})[brand] || brandSlugFromAlt(img?.alt);
  }

  // Fetches the logo as a File object from the extension's brand-logos/ folder.
  // Tries .jpg first (the newly created logos), then falls back to .png.
  async function fetchLogoFile(slug) {
    if (!slug) return null;
    for (const ext of ["jpg", "png"]) {
      try {
        const url = chrome.runtime.getURL(`brand-logos/${slug}.${ext}`);
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        return new File([blob], `${slug}.${ext}`, { type: `image/${ext === "jpg" ? "jpeg" : "png"}` });
      } catch (_) {
        continue;
      }
    }
    console.warn(`[Duck.ai Collector] Logo file not found for slug: ${slug}`);
    return null;
  }

  // ── Prompt builder ────────────────────────────────────────────────────────────
  const SHOT_DESCRIPTIONS = {
    "main.jpg":           "PRIMARY CATALOG IMAGE. Straight-on front-facing view of the product, perfectly centered and fully visible. Product occupies approximately 70-80% of the frame. Camera positioned at product eye level with minimal perspective distortion.",
    "angle.jpg":          "ALTERNATE ANGLE VIEW. Product shown from a 45-degree front-left angle, elevated slightly above product eye-level, showing both the front face and left side simultaneously.",
    "detail.jpg":         "CLOSE-UP DETAIL SHOT. Extreme close-up macro photograph focusing on the most interesting or distinguishing feature of the product. Fills the frame edge-to-edge.",
    "context.jpg":        "IN-USE CONTEXT SHOT. Product shown in a realistic usage environment or paired with complementary accessories. Styled for lifestyle appeal while keeping product as hero.",
    "with-packaging.jpg": "WITH RETAIL PACKAGING. Product shown beside or in front of its retail box/packaging. Both product and packaging clearly visible and in focus.",
  };

  const UNIVERSAL_STUDIO = "Pure seamless white background (#FFFFFF), professional high-key studio lighting, large softbox lighting from both sides, subtle controlled fill light, natural soft contact shadow directly underneath, clean premium Amazon/Apple-style product catalog presentation. No dramatic perspective, no environmental elements.";

  const CONSISTENCY_RULE = "PRODUCT IDENTITY MUST REMAIN EXACTLY CONSISTENT ACROSS ALL FIVE IMAGES. Treat the provided product description as the authoritative source of truth. Preserve the exact product model, shape, dimensions, proportions, color, finish, materials, buttons, ports, vents, seams, controls, screen shape, camera placement, branding placement, and every visible physical feature. Do not redesign, simplify, beautify, recolor, reinterpret, or invent any part of the product. Every image must depict the SAME physical product photographed from a different camera/viewpoint.";

  function buildPrompt(img, hasLogo) {
    const alt         = (img.alt || "").trim();
    const productName = (img.productName || alt.split(" — ")[0]).trim();
    const shotDesc    = SHOT_DESCRIPTIONS[img.name] || `View of ${alt}`;
    const logoLine    = hasLogo
      ? `BRAND LOGO: The attached image is the official brand logo. Place it on the product exactly as a real manufacturer would — embossed, printed, or applied as a label. Do not alter the logo design, colors, or proportions.`
      : "";

    return (
      `Product photography for: ${productName}\n\n` +
      `${shotDesc} ${UNIVERSAL_STUDIO}\n\n` +
      (logoLine ? `${logoLine}\n\n` : "") +
      `${CONSISTENCY_RULE}\n\n` +
      `Full product description: ${img.description || alt}`
    );
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return (s || "").replace(/[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  const sleep   = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = (sel, timeout = 10_000) => new Promise((resolve, reject) => {
    const el = document.querySelector(sel);
    if (el) return resolve(el);
    const t = setTimeout(() => { ob.disconnect(); reject(new Error(`timeout: ${sel}`)); }, timeout);
    const ob = new MutationObserver(() => {
      const f = document.querySelector(sel);
      if (f) { clearTimeout(t); ob.disconnect(); resolve(f); }
    });
    ob.observe(document.body, { childList: true, subtree: true });
  });

  // ── Image attachment ──────────────────────────────────────────────────────────
  // Duck.ai has a hidden <input type="file" name="upload"> right next to the
  // attach button (data-testid="duckai-attach-button").
  // We inject the logo File via DataTransfer directly — no click needed.
  async function attachFile(file, label = "file") {
    if (!file) return false;

    // Duck.ai's file input: input[type="file"][name="upload"] hidden next to
    // data-testid="duckai-attach-button". It accepts image/png,jpeg,webp,gif.
    const input = document.querySelector('input[type="file"][name="upload"]')
               || document.querySelector('[data-testid="duckai-chat-input"] input[type="file"]')
               || document.querySelector('input[type="file"][accept*="image"]');

    if (!input) {
      console.warn("[Duck.ai Collector] File input not found — skipping logo");
      return false;
    }

    try {
      // Build a DataTransfer with our logo file
      const dt = new DataTransfer();
      dt.items.add(file);

      // The React-safe way: use the native HTMLInputElement files setter
      // (React tracks this descriptor to fire its synthetic onChange)
      const nativeFilesSetter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input), "files"
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "files"
      )?.set;

      if (nativeFilesSetter) {
        nativeFilesSetter.call(input, dt.files);
      } else {
        // Older fallback — works in non-React contexts
        Object.defineProperty(input, "files", {
          value: dt.files, configurable: true, writable: true,
        });
      }

      // Fire change + input events — React listens for both
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("input",  { bubbles: true, composed: true }));

      console.log(`[Duck.ai Collector] ${label} injected:`, file.name, file.size, "bytes");
    } catch (e) {
      console.warn(`[Duck.ai Collector] ${label} inject error:`, e.message);
      return false;
    }

    return true;
  }

  async function waitForAttachment(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(500);
      const attached = [...document.querySelectorAll("img")].some((img) =>
        img.src.startsWith("blob:") && img.getBoundingClientRect().width > 0
      ) || [...document.querySelectorAll("[data-testid]")].some((el) =>
        /attachment|file-preview|uploaded-file/i.test(el.getAttribute("data-testid") || "")
      );
      if (attached) return true;
    }
    return false;
  }

  async function attachRequiredFile(file, label) {
    const injected = await attachFile(file, label);
    if (!injected) throw new Error(`${label} could not be added to Duck.ai`);
    await sleep(1_500);
    return true;
  }

  // ── Prompt input helpers ──────────────────────────────────────────────────────
  function findPromptInput() {
    return document.querySelector('textarea[name="user-prompt"]')
        || document.querySelector('[data-testid="duckai-chat-input"] textarea')
        || document.querySelector('div[contenteditable="true"]')
        || document.querySelector("textarea");
  }

  async function typePrompt(text) {
    const input = findPromptInput();
    if (!input) throw new Error("Prompt input not found");
    input.focus();
    await sleep(200);
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, "value"
      )?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("Prompt input value setter not found");
      setter.call(input, text);
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true, inputType: "insertText", data: text,
      }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      document.execCommand("insertText", false, text);
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true, inputType: "insertText", data: text,
      }));
    }
    await sleep(SUBMIT_DELAY_MS);
  }

  async function submitPrompt() {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const btn = document.querySelector(SEL.submitBtn);
      if (btn && !btn.disabled) { btn.click(); return; }
      await sleep(100);
    }
    const input = findPromptInput();
    if (input) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup",   { key: "Enter", code: "Enter", bubbles: true }));
    }
  }

  // ── Wait for duck.ai's native Download button ─────────────────────────────────
  async function waitForDownloadBtn(timeout = DOWNLOAD_TIMEOUT) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const btn = document.querySelector(SEL.downloadBtn);
      if (btn) return btn;
      await sleep(POLL_MS);
    }
    throw new Error("Timed out waiting for Download image button");
  }

  // ── Click Download + wait for sorter to process it ───────────────────────────
  // Clicks the duck.ai Download button, then polls count-server until the
  // saved count increments (= sorter moved the file to img/).
  // If count-server is offline, returns null after a short wait.
  async function clickDownloadAndWaitForCount(expectedCount, timeoutMs = 90_000) {
    // Register temp filename with background so it saves to duck-ai-queue/
    const queueFilename = `queue-${Date.now()}.png`;
    await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "set-next-filename", filename: queueFilename },
        () => resolve()   // always resolve — don't block if bg fails
      );
    });

    // Click the Download button
    const btn = document.querySelector(SEL.downloadBtn);
    if (!btn) throw new Error("Download button disappeared before click");
    btn.click();
    console.log("[Duck.ai Collector] Download clicked, waiting for count ≥", expectedCount);

    // Poll count-server until count reaches expectedCount
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await sleep(1500);
      const count = await fetchCount();
      if (count === null) {
        // Server offline — just wait for the download to complete (2s) and move on
        console.warn("[Duck.ai Collector] count-server offline — advancing anyway");
        await sleep(2000);
        return null;
      }
      if (count >= expectedCount) {
        console.log("[Duck.ai Collector] Count reached:", count);
        return count;
      }
    }

    console.warn("[Duck.ai Collector] Timed out waiting for count increment — advancing anyway");
    return await fetchCount();   // return whatever we have
  }

  async function fetchCount() {
    try {
      const res = await fetch("http://127.0.0.1:7843/count", { cache: "no-store" });
      if (!res.ok) return null;
      const d = await res.json();
      return typeof d.count === "number" ? d.count : null;
    } catch (_) {
      return null;
    }
  }

  // ── New Image button ──────────────────────────────────────────────────────────
  async function clickNewImage() {
    const btn = document.querySelector(SEL.newImageBtn);
    if (btn) { btn.click(); await sleep(800); return; }
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "I", code: "KeyI", ctrlKey: true, shiftKey: true, bubbles: true
    }));
    await sleep(800);
  }

  // ── Run one image ─────────────────────────────────────────────────────────────
  async function runOne(img, currentCount) {
    setStatus(`Starting: ${img.alt}`);

    // 1. Fetch brand logo
    const slug     = brandSlugForImage(img);
    const logoFile = await fetchLogoFile(slug);
    if (slug  ) console.log(`[Duck.ai Collector] Logo: slug=${slug} found=${!!logoFile}`);

    // 2. Open fresh image generation chat
    await clickNewImage();
    await sleep(1500);

    // 3. Wait for the chat input AND the file input to appear in the DOM
    try { await waitFor('[data-testid="duckai-chat-input"]', 8000); }
    catch (_) { await sleep(2000); }

    // Extra wait for the file input specifically — duck.ai lazy-renders it
    let fileInputReady = false;
    for (let i = 0; i < 10; i++) {
      if (document.querySelector('input[type="file"][name="upload"]')) {
        fileInputReady = true; break;
      }
      await sleep(400);
    }
    if (!fileInputReady) console.warn("[Duck.ai Collector] File input not found after waiting");

    // 4. Attach brand logo BEFORE typing (order matters — duck.ai clears input on attach)
    if (logoFile) {
      setStatus("Attaching brand logo…");
      await attachRequiredFile(logoFile, "Brand logo");
      setStatus("Brand logo attached ✓");
      await sleep(600);
    }

    // 5. Type prompt
    setStatus("Typing prompt…");
    await typePrompt(buildPrompt(img, !!logoFile));

    // 6. Submit
    setStatus("Submitting…");
    await submitPrompt();

    // 7. Wait for Download button (image generation complete)
    setStatus("Generating… (waiting for Download button)");
    await waitForDownloadBtn(DOWNLOAD_TIMEOUT);
    await sleep(800);

    // 8. Click Download → sorter catches it → count-server count increments
    setStatus("Downloading… waiting for sorter");
    const newCount = await clickDownloadAndWaitForCount(currentCount + 1);
    setStatus(`✓ Done  (count: ${newCount ?? "offline"})`);
    return newCount;
  }

  // ── Automation loop ───────────────────────────────────────────────────────────
  let automationAbort = false;
  let statusEl        = null;

  function setStatus(msg, isError = false) {
    console[isError ? "error" : "log"]("[Duck.ai Collector]", msg);
    if (!statusEl) statusEl = document.getElementById("dai-status");
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.style.color = isError ? "#ff6b6b" : "#aaa";
    }
  }

  async function runLoop() {
    if (state.running) return;
    state.running   = true;
    automationAbort = false;
    await saveState(); render();

    console.log(`[Duck.ai Collector] runLoop start — images: ${state.images.length}, index: ${state.index}`);

    try {
      // Initial sync: read count-server to know how many are already saved.
      // If count-server is offline, default to state.index (resume where we left off).
      let savedCount = (await fetchCount()) ?? state.index;

      // Advance state.index forward if sorter already processed some images
      // (handles resume after a crash or restart)
      if (state.index < savedCount) {
        state.index = savedCount;
        await saveState(); render();
      }

      while (state.index < state.images.length) {
        if (automationAbort) { setStatus("Stopped."); break; }
        if (state.paused)    { setStatus("Paused — click Resume"); await sleep(1000); continue; }

        const img = curImage();
        if (!img) break;

        // Skip already-done entries
        if (isDone(img)) {
          state.index++;
          await saveState(); render();
          continue;
        }

        try {
          // Run generation + download for this image
          const newCount = await runOne(img, savedCount);

          // Update savedCount from what count-server confirmed
          // If count-server is offline, just assume +1
          savedCount = (newCount != null) ? newCount : savedCount + 1;

          // Mark done and advance index by 1 — never skip multiple entries
          state.done[doneKey(img)] = { ts: new Date().toISOString(), savedCount };
          state.index++;              // ← simple increment, not set to savedCount
          await saveState(); render();
          await sleep(1500);

        } catch (e) {
          setStatus(`Error on image ${state.index + 1}: ${e.message}`, true);
          console.error("[Duck.ai Collector] runOne failed:", e);
          // Pause and wait for user to resume — don't stop the whole loop
          state.paused = true;
          await saveState(); render();
          // Wait for resume
          while (state.paused && !automationAbort) await sleep(1000);
          if (automationAbort) break;
        }
      }

      if (state.index >= state.images.length && !automationAbort) {
        setStatus(`✅ All ${state.images.length} images done! Total saved: ${totalDone()}`);
      }
    } finally {
      state.running = false;
      await saveState(); render();
    }
  }

  // ── Widget UI ─────────────────────────────────────────────────────────────────
  let root = null;
  let activeTab = "main";  // "main" | "brands"

  function mount() {
    if (!root) {
      root = document.createElement("div");
      root.id = WIDGET_ID;
      document.body.appendChild(root);
      makeDraggable(root, "dai-head");
    }
    if (state.pos) {
      Object.assign(root.style, {
        top: `${state.pos.top}px`, left: `${state.pos.left}px`,
        right: "auto", bottom: "auto",
      });
    }
    return root;
  }

  function makeDraggable(el, handleId) {
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      const h = document.getElementById(handleId);
      if (!h || !h.contains(e.target)) return;
      const r = el.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    document.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const top  = Math.max(0, Math.min(window.innerHeight - 80,  e.clientY - drag.dy));
      const left = Math.max(0, Math.min(window.innerWidth  - 140, e.clientX - drag.dx));
      Object.assign(el.style, { top: `${top}px`, left: `${left}px`, right: "auto", bottom: "auto" });
      state.pos = { top, left };
    });
    document.addEventListener("pointerup", () => { if (drag) { drag = null; saveState(); } });
  }

  // ── Tab: Main ─────────────────────────────────────────────────────────────────
  function mainTabHTML() {
    const img      = curImage();
    const progress = `${totalDone()} / ${state.images.length}`;
    const slug     = img ? brandSlugForImage(img) : null;
    const logoInfo = slug ? `🖼 ${slug}.jpg` : "⚠ no logo mapped";

    const listItems = state.images
      .slice(Math.max(0, state.index - 2), state.index + 5)
      .map((im, rel) => {
        const abs    = Math.max(0, state.index - 2) + rel;
        const active = abs === state.index;
        const done   = isDone(im);
        return `<div class="dai-item ${active ? "dai-active" : ""} ${done ? "dai-done" : ""}"
                     data-idx="${abs}" title="${esc(im.alt)}">
                  ${done ? "✓ " : ""}${esc(im.name)} — ${esc((im.alt || "").split(" — ")[0])}
                </div>`;
      }).join("");

    const runLabel = state.running
      ? (state.paused ? "▶ Resume" : "⏸ Pause")
      : "▶ Start Auto";

    return `
      <div class="dai-img-name">${esc(img ? img.alt : "— no data —")}</div>
      <div class="dai-img-path">${esc(img ? img.path + img.name : "")}</div>
      <div class="dai-logo-info">${esc(logoInfo)}</div>
      <div class="dai-list">${listItems}</div>
      <div class="dai-row">
        <button id="dai-run">${esc(runLabel)}</button>
        <button id="dai-stop" ${state.running ? "" : "disabled"}>■ Stop</button>
      </div>
      <div class="dai-row">
        <button id="dai-prev">◀</button>
        <button id="dai-skip">⏩ Skip</button>
        <button id="dai-next">▶</button>
      </div>
      <div class="dai-row">
        <button id="dai-save-now" title="Click duck.ai Download → sorter handles naming">📥 Save Now</button>
        <button id="dai-sync" title="Sync index to count-server">🔄 Sync</button>
        <button id="dai-clear">reset</button>
      </div>
      <div id="dai-status" class="dai-status"></div>
      <div class="dai-foot">
        <label class="dai-filebtn">
          Import images_partN.json
          <input type="file" id="dai-import" accept=".json">
        </label>
      </div>`;
  }

  // ── Tab: Brand Map ────────────────────────────────────────────────────────────
  function brandTabHTML() {
    const rows = Object.entries(state.brandMap || {}).map(([brand, slug]) =>
      `<div class="dai-brow">
        <span class="dai-btag">${esc(brand)}</span>
        <span>→</span>
        <input class="dai-bval" data-brand="${esc(brand)}" value="${esc(slug)}" placeholder="logo-slug">
        <button class="dai-bdel" data-brand="${esc(brand)}" title="Remove">✕</button>
      </div>`
    ).join("");

    return `
      <div class="dai-brand-scroll">
        ${rows}
        <div class="dai-brow dai-badd">
          <input id="dai-bnew-brand" placeholder="brand (e.g. nova)" class="dai-bval">
          <span>→</span>
          <input id="dai-bnew-slug"  placeholder="slug  (e.g. vulcanis)" class="dai-bval">
          <button id="dai-badd-btn">＋</button>
        </div>
      </div>
      <div class="dai-row" style="margin-top:6px">
        <button id="dai-bsave">💾 Save Map</button>
        <button id="dai-breset">↺ Reset defaults</button>
      </div>
      <div id="dai-bstatus" class="dai-status"></div>
      <p class="dai-bhint">Brand = first word of product alt text (lowercase).<br>
      Slug = logo filename without .png from the brand-logos/ folder.</p>`;
  }

  // ── Full panel ────────────────────────────────────────────────────────────────
  function panelHTML() {
    const progress = `${totalDone()} / ${state.images.length}`;
    return `
      <div class="dai-head" id="dai-head">
        <span>🦆 Duck.ai Collector</span>
        <span class="dai-count">${progress}</span>
      </div>
      <div class="dai-tabs">
        <button class="dai-tab ${activeTab === "main"   ? "dai-tab-active" : ""}" data-tab="main">Queue</button>
        <button class="dai-tab ${activeTab === "brands" ? "dai-tab-active" : ""}" data-tab="brands">Brand Logos</button>
      </div>
      <div class="dai-body">
        ${activeTab === "main" ? mainTabHTML() : brandTabHTML()}
      </div>`;
  }

  function importerHTML() {
    return `
      <div class="dai-head" id="dai-head"><span>🦆 Duck.ai Collector</span></div>
      <div class="dai-body">
        <p>Import <b>product_images.json</b> to begin.<br>
        The extension will enter each image prompt into duck.ai, attach the brand logo,
        wait for the generated image, and download it with the correct filename.</p>
        <label class="dai-filebtn dai-filebtn-big">
          Import product_images.json
          <input type="file" id="dai-import" accept=".json">
        </label>
        <div id="dai-status" class="dai-status"></div>
      </div>`;
  }

  function render() {
    const panel = mount();
    panel.innerHTML = state.images.length ? panelHTML() : importerHTML();
    statusEl = document.getElementById("dai-status");
    bindEvents();
  }

  function bindEvents() {
    // Tab switching
    document.querySelectorAll(".dai-tab[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        render();
      });
    });

    // ── Main tab events ──────────────────────────────────────────────────────
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };

    // Import JSON
    const fi = document.getElementById("dai-import");
    if (fi) {
      fi.addEventListener("change", (e) => {
        const f = e.target.files[0]; if (!f) return;
        f.text().then((txt) => {
          const raw = JSON.parse(txt);
          const flat = normalizeQueue(raw);

          if (!flat.length) throw new Error("No valid image entries found in JSON");

          // Warn about any entries with undefined path
          const missingPath = flat.filter((img) => !img.path).length;
          if (missingPath > 0) {
            console.info(`[Duck.ai Collector] ${missingPath} entries lack a path; using product/name keys`);
          }

          state.images = flat;
          state.index  = 0;
          state.done   = {};
          console.log(`[Duck.ai Collector] Imported ${flat.length} images`);
          return saveState().then(() => render());
        }).catch((err) => alert(`Import failed: ${err.message}`));
      });
    }

    // Run / Pause / Resume
    const runBtn = document.getElementById("dai-run");
    if (runBtn) {
      runBtn.addEventListener("click", () => {
        if (!state.running)       runLoop();
        else if (state.paused)  { state.paused = false; saveState(); render(); }
        else                    { state.paused = true;  saveState(); render(); }
      });
    }

    on("dai-stop", () => {
      automationAbort = state.running = state.paused = false;
      saveState(); render(); setStatus("Stopped.");
    });
    on("dai-prev", () => { state.index = Math.max(0, state.index - 1); saveState(); render(); });
    on("dai-next", () => { state.index = Math.min(state.images.length - 1, state.index + 1); saveState(); render(); });
    on("dai-skip", () => {
      const img = curImage(); if (!img) return;
      state.done[doneKey(img)] = { ts: new Date().toISOString(), finalName: "skipped" };
      state.index = Math.min(state.index + 1, state.images.length - 1);
      saveState(); render();
    });
    on("dai-save-now", async () => {
      const img = curImage(); if (!img) { setStatus("No image selected", true); return; }
      const btn = document.querySelector(SEL.downloadBtn);
      if (!btn) { setStatus("No Download button on screen", true); return; }
      try {
        setStatus("Saving…");
        const count = (await fetchCount()) ?? state.index;
        await clickDownloadAndWaitForCount(count + 1, 30_000);
        state.done[doneKey(img)] = { ts: new Date().toISOString() };
        state.index = Math.min(state.index + 1, state.images.length - 1);
        saveState(); render(); setStatus("✓ Saved");
      } catch (e) { setStatus(e.message, true); }
    });

    on("dai-sync", async () => {
      const count = await fetchCount();
      if (count === null) { setStatus("⚠ count-server not running", true); return; }
      state.index = Math.min(count, state.images.length - 1);
      saveState(); render();
      setStatus(`Synced → index ${state.index} (saved: ${count})`);
    });
    on("dai-clear", () => {
      if (!confirm("Reset all data?")) return;
      state = { ...state, images: [], index: 0, done: {}, running: false, paused: false };
      automationAbort = true;
      saveState(); render();
    });
    document.querySelectorAll(".dai-item[data-idx]").forEach((el) => {
      el.addEventListener("click", () => { state.index = +el.dataset.idx; saveState(); render(); });
    });

    // ── Brand tab events ─────────────────────────────────────────────────────
    // Inline edit
    document.querySelectorAll(".dai-bval[data-brand]").forEach((inp) => {
      inp.addEventListener("input", () => {
        state.brandMap[inp.dataset.brand] = inp.value.trim();
      });
    });
    // Delete row
    document.querySelectorAll(".dai-bdel[data-brand]").forEach((btn) => {
      btn.addEventListener("click", () => {
        delete state.brandMap[btn.dataset.brand];
        saveState(); render();
      });
    });
    // Add row
    on("dai-badd-btn", () => {
      const bInp = document.getElementById("dai-bnew-brand");
      const sInp = document.getElementById("dai-bnew-slug");
      const brand = (bInp?.value || "").trim().toLowerCase();
      const slug  = (sInp?.value || "").trim();
      if (!brand || !slug) return;
      state.brandMap[brand] = slug;
      saveState(); render();
    });
    // Save map
    on("dai-bsave", () => {
      saveState();
      const s = document.getElementById("dai-bstatus");
      if (s) { s.textContent = "✓ Saved"; setTimeout(() => { if (s) s.textContent = ""; }, 2000); }
    });
    // Reset to defaults
    on("dai-breset", () => {
      if (!confirm("Reset brand map to defaults?")) return;
      state.brandMap = { ...DEFAULT_BRAND_MAP };
      saveState(); render();
    });
  }

  // ── HUD ───────────────────────────────────────────────────────────────────────
  let hud = null;
  function renderHud() {
    if (!hud) { hud = document.createElement("div"); hud.id = HUD_ID; document.body.appendChild(hud); }
    const img = curImage();
    const pos = img ? `${state.index + 1}/${state.images.length} · ${img.name}` : "no data";
    hud.innerHTML = `
      <button id="dai-hud-start" class="dai-pill">
        <span>${state.running && !state.paused ? "⏸" : "▶"}</span>
        <span>${state.running && !state.paused ? "Pause" : "Start"}</span>
      </button>
      <button id="dai-hud-pos" class="dai-pill" title="Sync to count-server">
        <span>📍</span><span class="dai-pill-label">${esc(pos)}</span>
      </button>
      <button id="dai-hud-save" class="dai-pill" title="Click Download button for current image">
        <span>📥</span><span>Save Now</span>
      </button>`;

    document.getElementById("dai-hud-start").addEventListener("click", () => {
      if (!state.images.length) { setStatus("Import product_images.json first", true); return; }
      if (!state.running)       runLoop();
      else if (state.paused)  { state.paused = false; saveState(); render(); renderHud(); }
      else                    { state.paused = true;  saveState(); render(); renderHud(); }
    });
    document.getElementById("dai-hud-pos").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "count-images" }, (res) => {
        if (res?.count != null) {
          state.index = Math.max(0, Math.min(state.images.length - 1, res.count));
          saveState(); render(); renderHud();
        }
      });
    });
    document.getElementById("dai-hud-save").addEventListener("click", async () => {
      const img = curImage(); if (!img) return;
      const btn = document.querySelector(SEL.downloadBtn);
      if (!btn) { setStatus("No Download button visible", true); return; }
      try {
        const count = (await fetchCount()) ?? state.index;
        await clickDownloadAndWaitForCount(count + 1, 30_000);
        state.done[doneKey(img)] = { ts: new Date().toISOString() };
        state.index = Math.min(state.index + 1, state.images.length - 1);
        saveState(); render(); renderHud(); setStatus("✓ Saved");
      } catch (e) { setStatus(e.message, true); }
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────────
  loadState().then(async () => {
    if (!state.images.length) {
      try { await loadBundledQueue(); }
      catch (e) { console.error("[Duck.ai Collector] Bundled queue load failed:", e); }
    }
    render(); renderHud();
  });
})();
