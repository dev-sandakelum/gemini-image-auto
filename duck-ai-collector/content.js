/* Duck.ai Product Image Collector — content.js
   ─────────────────────────────────────────────────────────────────────────────
   Workflow per image entry (4 shots per product: main, angle, context, with-packaging):
     1. Click "New Image" button
     2. Wait for prompt input to appear
     3. Attach the brand logo PNG (read from extension's brand-logos/ folder)
     4. Attach the generated front image (for every shot except main.jpg)
     5. Type the prompt and submit
     6. Poll for aria-label="Download image" button (image is ready)
     7. Register target filename → click Download → background renames the file
     8. Mark done, advance, repeat
   ─────────────────────────────────────────────────────────────────────────────
*/

(() => {
  "use strict";

  // ── Constants ────────────────────────────────────────────────────────────────
  const WIDGET_ID        = "dai-widget";
  const HUD_ID           = "dai-hud";
  const POLL_MS          = 600;
  const IMAGE_TIMEOUT_MS = 300_000;   // 5 min: from prompt input until the image is downloaded
  const MAX_IMAGE_RETRIES = 5;        // fresh redos of the same image before falling back to pause/watchdog
  const DOWNLOAD_TIMEOUT = IMAGE_TIMEOUT_MS + 30_000;   // safety net; the 5-min image timer fires first
  const SUBMIT_DELAY_MS  = 600;
  const WATCHDOG_MS      = 60_000;    // watchdog health-check cycle
  const DEFAULT_QUEUE_URL = "queue/images_part1.json";

  // Shots that are NOT generated any more (4 images per product are enough)
  const EXCLUDED_SHOTS = new Set(["detail.jpg"]);

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
    autoMode: false, // watchdog armed? true after Start/Resume, false after Stop/Pause
  };

  const loadState = () =>
    chrome.storage.local.get({
      images: [], index: 0, done: {}, running: false,
      paused: false, pos: null, brandMap: null, autoMode: false,
    }).then((s) => {
      state = { ...state, ...s };
      if (!state.brandMap) state.brandMap = { ...DEFAULT_BRAND_MAP };
      // The loop lives in this page's memory — after a reload it is NOT running,
      // whatever storage says. (autoMode survives, so the watchdog can restart it.)
      state.running = false;
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
    autoMode: state.autoMode,
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
    // Only 4 shots per product: main, angle, context, with-packaging (detail.jpg removed)
    return flat.filter((img) => img && (img.name || img.id) && !EXCLUDED_SHOTS.has(img.name));
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

  // ── Deterministic product identifiers ─────────────────────────────────────────
  // Serial / model / SKU / barcode values are derived from the product itself
  // (brand + product_id + name) so that EVERY shot of the same product receives
  // the exact same printed identifiers, run after run.
  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function productIdentifiers(img) {
    const brandRaw = (img?.brand || (img?.alt || "").split(/\s+/)[0] || "BRAND");
    const brand    = brandRaw.toUpperCase().replace(/[^A-Z0-9]/g, "") || "BRAND";
    const pid      = String(img?.product_id ?? "0");
    const name     = (img?.productName || (img?.alt || "").split(" — ")[0] || "").trim();
    const rng      = makeRng(hash32(`${brand}|${pid}|${name}`));

    const digits = (n) => Array.from({ length: n }, () => Math.floor(rng() * 10)).join("");
    const alnum  = (n, set = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789") =>
      Array.from({ length: n }, () => set[Math.floor(rng() * set.length)]).join("");

    const prefix = brand.slice(0, 3).padEnd(3, "X");
    const modelNo   = `${prefix}-${digits(4)}${alnum(1, "ABCDEFGHJKLMNPRSTUVWXYZ")}`;
    const partNo    = `P/N: ${prefix}${digits(2)}-${digits(5)}-${alnum(2, "ABCDEFGHJKLMNPRSTUVWXYZ")}`;
    const sku       = `SKU: ${prefix}-${digits(6)}`;
    const year      = 24 + Math.floor(rng() * 3);           // 24–26
    const week      = String(1 + Math.floor(rng() * 52)).padStart(2, "0");
    const serialNo  = `S/N: ${prefix}${year}${week}${alnum(8)}`;
    const batchNo   = `LOT: ${year}${week}-${alnum(4)}`;
    const mfgDate   = `MFG: 20${year}-${week}W`;

    // UPC-A barcode digits with a valid check digit
    const upcBody = digits(11);
    let odd = 0, even = 0;
    for (let i = 0; i < 11; i++) (i % 2 === 0 ? (odd += +upcBody[i]) : (even += +upcBody[i]));
    const check = (10 - ((odd * 3 + even) % 10)) % 10;
    const upc   = `${upcBody}${check}`;

    const fcc = `FCC ID: ${alnum(3, "ABCDEFGHJKLMNPRSTUVWXYZ")}${digits(3)}${alnum(3, "ABCDEFGHJKLMNPRSTUVWXYZ")}`;

    return { brand, modelNo, partNo, sku, serialNo, batchNo, mfgDate, upc, fcc };
  }

  // ── Prompt builder ────────────────────────────────────────────────────────────
  // Hard limit enforced by duck.ai. buildPrompt() trims the product description
  // (the only variable-length part) so the final prompt never exceeds this.
  const MAX_PROMPT_CHARS = 4200;

  // 4 shots per product: cover (main), angle, context, with-packaging.
  const SHOT_DESCRIPTIONS = {
    "main.jpg":           "FRONT VIEW — master reference image. Straight-on, perfectly centered, product fills ~80-85% of the frame, eye-level camera, no perspective distortion, edge-to-edge sharp so all printed text is crisp and legible.",
    "angle.jpg":          "ALTERNATE ANGLE. Same product from a 45-degree front-left angle, camera slightly above eye level, showing front face and left side. All visible labels and ports must match the approved front reference exactly.",
    "context.jpg":        "IN-USE CONTEXT. Same product in a realistic usage setting inside the ENVIRONMENT below, with a few tasteful complementary props. Product stays the fully visible hero; labels unchanged from the front reference.",
    // with-packaging.jpg is built per product by packagingShotDesc() (30 box themes, see below)
    "with-packaging.jpg": "WITH RETAIL PACKAGING. Same product beside or in front of its premium retail box. The box has a proper, complete cover showing the brand logo, product name, and the SAME model number and barcode digits as the product.",
  };

  // ── Packaging themes ──────────────────────────────────────────────────────────
  // 30 distinct premium retail-box designs. One is assigned per PRODUCT, seeded by
  // brand + product_id + name (same idea as environmentFor), so a retry of the same
  // product gets the same box while different products get different boxes.
  const PACKAGING_THEMES = [
    { name: "Black & electric purple",   text: "matte black box with a full-height purple side band of fine diagonal stripes, big bold white title on a purple bar, faint dark line-art silhouette on the cover." },
    { name: "Black/white diagonal",      text: "matte black top half and white bottom half split by a sharp diagonal, fine parallel-line graphic, bold oversized number, boxed logo in white." },
    { name: "Black & red angles",        text: "glossy black box with bold red angular corner panels, thin grey line-art drawing of the product, widely spaced white product-name letters." },
    { name: "White, red & navy cube",    text: "white box with a diagonal red stripe, navy side panels covered in white sketch-style line icons of product parts, red logo, small certification badges." },
    { name: "White, gold & grey facets", text: "matte white box with overlapping gold and grey triangular facets, logo inside an oval, soft paper texture, tagline under the logo." },
    { name: "Black & copper foil",       text: "soft-touch black box, copper hot-foil logo and thin copper border lines, very minimal text, premium unboxing feel." },
    { name: "Navy & silver foil",        text: "deep navy rigid box with embossed silver-foil logo, subtle geometric pattern, small white spec panel on one side." },
    { name: "Forest green & gold",       text: "dark forest-green box, gold-foil lettering, thin gold frame line around the cover, refined classic look." },
    { name: "Charcoal & orange wedge",   text: "charcoal box with a bright orange diagonal wedge across the cover, bold white type, small product outline graphic." },
    { name: "Teal wave gradient",        text: "teal-to-deep-blue gradient box with white flowing wave lines, glossy spot-UV logo, clean modern layout." },
    { name: "Bold red & black",          text: "saturated red box with black angular stripes, large white logo, product line-art on the cover, white spec bar at the bottom." },
    { name: "Kraft eco",                 text: "natural kraft-brown cardboard box, one-color black print, stamp-style logo, simple paper band, honest recycled-paper texture." },
    { name: "Pure white minimalist",     text: "premium white box with embossed logo, one thin accent-color stripe, tidy spec label, lots of clean empty space." },
    { name: "Midnight & neon cyan",      text: "midnight-blue box with printed neon-cyan circuit line art and crisp cyan edge accents (printed, not glowing), white title." },
    { name: "Magenta & dark grey",       text: "dark grey box with magenta angular banners, white sans-serif title, small icon row listing features." },
    { name: "Black & acid green",        text: "black box with acid-green diagonal slashes, hex-pattern texture, large bold white title." },
    { name: "Magnetic-flap gift box",    text: "matte black rigid gift box with magnetic flap lid, gold-foil logo centered on the cover, fabric pull-ribbon, thick luxurious walls." },
    { name: "Slipcase sleeve",           text: "white slipcase sleeve with a die-cut window, black inner tray partly slid out, silver logo on the sleeve." },
    { name: "Sunset gradient",           text: "glossy orange-to-purple gradient box, white bold type, simple geometric product icon, rounded corners printed on the graphic." },
    { name: "Carbon grey & red line",    text: "dark grey carbon-weave-pattern print box with one thin red accent line, sporty angular logo, gaming-style spec badges." },
    { name: "Corporate blue wave",       text: "white box with a blue wave band and sky-blue side panels, trustworthy corporate layout, generic quality-mark badges." },
    { name: "Black & gold deco",         text: "black box with gold art-deco geometric line pattern, gold-foil logo, luxury look." },
    { name: "Brushed silver",            text: "brushed-silver-effect box with black type and a thin blue stripe, sleek technical feel." },
    { name: "Pastel mint",               text: "soft mint box with dark grey type, a friendly row of rounded feature icons, fresh modern look." },
    { name: "Burgundy & cream",          text: "burgundy box with a cream cover panel, thin gold line, elegant serif-free type." },
    { name: "Black & yellow split",      text: "diagonally split black and bright-yellow box, bold condensed sans type, industrial strong look." },
    { name: "Isometric pattern",         text: "white box with an all-over thin isometric-cube pattern in blue-grey, a solid color band carrying the logo." },
    { name: "Holographic accent",        text: "black box with an iridescent holographic foil stripe and foil logo, subtle glossy-vs-matte contrast." },
    { name: "Light grey & orange tech",  text: "light-grey box with orange corner triangles and a printed column of feature icons, clean tech-spec layout." },
    { name: "Two-tone ocean",            text: "deep ocean-blue lower half and pale-blue upper half meeting in a soft curve, white logo, small wave-line texture." },
  ];

  function packagingFor(img) {
    const brandRaw = (img?.brand || (img?.alt || "").split(/\s+/)[0] || "brand").toLowerCase();
    const pid  = String(img?.product_id ?? "0");
    const name = (img?.productName || (img?.alt || "").split(" — ")[0] || "").trim().toLowerCase();
    let h = hash32(`pkg|${brandRaw}|${pid}|${name}`);
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;   // extra bit-mixing so all 30 themes get used evenly
    h = (h ^ (h >>> 13)) >>> 0;
    return PACKAGING_THEMES[h % PACKAGING_THEMES.length];
  }

  function packagingShotDesc(img) {
    const pkg = packagingFor(img);
    return (
      `WITH RETAIL PACKAGING. Same product beside or in front of its premium retail box. ` +
      `Ultra-realistic box with real cardboard/paper texture, crisp edges, clean folds, fine print quality, and a proper, complete cover fully visible. ` +
      `BOX DESIGN (${pkg.name}): ${pkg.text} ` +
      `The cover shows the brand logo, product name, and the SAME model number and barcode digits as the product. ` +
      `Box and product both sharp, uncropped and in focus; the product stays the hero.`
    );
  }

  const FORMAT_RULE = "OUTPUT: exactly ONE square 1:1 image (1024x1024). No borders, collage, split frames, captions or watermarks. Printed labels, engravings and stickers physically ON the product are fine and are not overlays.";

  const REALISM_RULE = "QUALITY: Ultra-realistic commercial product photo, full-frame camera, 85mm lens, razor-sharp, true-to-life materials and reflections, fine micro-detail. Must NOT look like a 3D render or AI art.";

  // ── Signature design touches ──────────────────────────────────────────────────
  // One touch per PRODUCT (seeded like the environment) so every shot of a product
  // shares it, while different products look distinct from each other.
  const SIGNATURE_TOUCHES = [
    "a thin contrasting accent line tracing one edge of the body",
    "a subtly textured panel (hex mesh, fine knurling or carbon weave) on one surface",
    "a small backlit emblem with a soft, tasteful glow",
    "a two-tone color-blocked finish with a crisp dividing seam",
    "chamfered, faceted edges that catch the light in sharp highlights",
    "a recessed inset groove or slot with a contrasting inner color",
    "a matte body paired with one polished-metal accent piece",
    "a distinctive angled cut or notch giving the silhouette a memorable shape",
    "a fine perforated or vented pattern forming a deliberate graphic",
    "a soft-touch coating with one bold colored pull-tab, button or ring",
    "a translucent smoked section revealing a hint of internals",
    "a tiny engraved geometric motif repeated as a subtle pattern",
  ];

  function signatureFor(img) {
    const brandRaw = (img?.brand || (img?.alt || "").split(/\s+/)[0] || "brand").toLowerCase();
    const pid  = String(img?.product_id ?? "0");
    const name = (img?.productName || (img?.alt || "").split(" — ")[0] || "").trim().toLowerCase();
    return SIGNATURE_TOUCHES[hash32(`sig|${brandRaw}|${pid}|${name}`) % SIGNATURE_TOUCHES.length];
  }

  const UNIQUE_RULE = "UNIQUE DESIGN: this is an original product with its own identity, not a copy of any real brand. Give it a distinctive silhouette and a deliberate color/material pairing that fit its product type, plus one signature touch (below), applied tastefully and identically in every shot.";

  // ── Environment themes ────────────────────────────────────────────────────────
  // One theme per PRODUCT (seeded by brand + product_id + name), shared by all 4
  // shots of that product. The background is never plain pure-white.
  const ENVIRONMENT_THEMES = [
    { name: "Light oak desk, daylight",
      text: "Clean light-oak desk in a bright modern workspace, soft window daylight from the side, blurred green plant and neutral wall behind, calm airy mood." },
    { name: "Dark slate tech surface",
      text: "Matte dark-slate surface, charcoal-to-navy gradient backdrop, cool blue rim light on the edges, faint blurred glowing light streaks, premium futuristic mood." },
    { name: "Amber gradient, glossy tabletop",
      text: "Dark glossy tabletop, warm amber-gold light beam across a navy-to-black gradient wall, soft reflection of the product, cinematic warm-cool contrast." },
    { name: "White marble tabletop",
      text: "White marble tabletop with soft grey veining, blurred warm-beige studio wall behind (not pure white), bright diffused light, elegant minimal luxury mood." },
    { name: "Concrete minimal",
      text: "Smooth light-grey micro-concrete surface, blurred mid-grey wall, soft diffused overhead light with a gentle directional shadow, modern industrial mood." },
    { name: "Gaming desk RGB bokeh",
      text: "Dark matte desk mat in a gaming room, blurred teal, purple and magenta RGB bokeh lights, subtle colored light spill on the edges, energetic tasteful mood." },
    { name: "Walnut desk, warm lamp",
      text: "Rich walnut desk, warm lamp light from one side, blurred bookshelf and monitor glow behind, cozy home-office mood." },
    { name: "Pastel gradient acrylic",
      text: "Glossy acrylic surface, soft pastel blue-to-lavender gradient backdrop (visibly colored, not white), gentle reflection, clean tech-launch mood." },
    { name: "Brushed metal, light streaks",
      text: "Dark brushed-aluminum surface, charcoal-to-black backdrop with soft diagonal light streaks, crisp edge highlights, dramatic premium hardware mood." },
    { name: "White desk, window, plant",
      text: "Clean white desk beside a bright window, soft cool ambient glow, blurred plant and grey accessories behind, fresh everyday-workspace mood (a real room, not a blank backdrop)." },
    { name: "Black reflective neon",
      text: "Black glossy reflective surface, dark backdrop lit by thin teal and magenta neon rim lights, mirror-like reflection beneath, sleek night-time tech mood." },
    { name: "Warm stone pedestal",
      text: "Matte warm-beige stone pedestal against a sand-colored studio wall, gentle side light with a long soft shadow, refined editorial mood." },
  ];

  function environmentFor(img) {
    const brandRaw = (img?.brand || (img?.alt || "").split(/\s+/)[0] || "brand").toLowerCase();
    const pid  = String(img?.product_id ?? "0");
    const name = (img?.productName || (img?.alt || "").split(" — ")[0] || "").trim().toLowerCase();
    const idx  = hash32(`env|${brandRaw}|${pid}|${name}`) % ENVIRONMENT_THEMES.length;
    return ENVIRONMENT_THEMES[idx];
  }

  const BACKGROUND_RULE = "BACKGROUND: avoid a plain blank or pure-white (#FFFFFF) backdrop; use a believable environment with depth, blurred surroundings and natural light (see ENVIRONMENT). Keep it uncluttered so the product stays the sharp hero.";

  const STUDIO_LIGHTING = "LIGHTING: soft key light with gentle fill, natural contact shadow, subtle surface reflection, shallow depth of field on the background only, premium catalog look.";

  const CONSISTENCY_RULE = "CONSISTENCY: all four images show the SAME physical product from different viewpoints. Treat the product description as the source of truth and keep shape, proportions, color, finish, materials and branding placement identical. Do not redesign or recolor it.";

  // Detail block for the front (main.jpg) master image. Details are OPTIONAL:
  // the model picks what suits the product and ignores the rest.
  function buildFrontDetailBlock(img, ids, hasLogo) {
    return (
      `FRONT IMAGE — DETAIL GUIDE: this is the master reference for the other angles, so make it rich in believable detail. You do NOT need to include everything below. Use only the items that make sense and look good for this product type, and silently ignore the rest. Prefer a few crisp, well-placed details over many cramped ones.\n` +
      `OPTIONAL PRINTED IDs (use the most useful, exact spelling, on a realistic label or engraved plate):\n` +
      `• Brand: ${img.brand || (img.alt || "").split(/\s+/)[0]}${hasLogo ? " with the attached logo (exact design, colors, proportions)" : ""}\n` +
      `• Product: ${(img.productName || (img.alt || "").split(" — ")[0]).trim()}\n` +
      `• Model ${ids.modelNo}, ${ids.serialNo}, UPC-A ${ids.upc} (digits under bars)\n` +
      `• Extras if space allows: ${ids.partNo}, ${ids.sku}, ${ids.batchNo}, ${ids.fcc}\n` +
      `If the description states its own serial/model/part number, use that instead.\n` +
      `OPTIONAL EXTRAS: a few small regulatory marks (CE, FCC, RoHS, WEEE), ratings, or "Designed by ${img.brand || "the brand"}"; real ports, buttons, LEDs, vents, seams and labels that this product would actually have (match the description's counts); true material micro-detail (grain, chamfers, mold texture, edge highlights).\n` +
      `TEXT ACCURACY: whatever text appears must be perfectly spelled and sharp, like factory printing. If text can't be rendered cleanly, leave it out rather than show gibberish.`
    );
  }

  // Consistency block for every NON-front shot.
  function buildIdentifierConsistencyBlock(img, ids) {
    return (
      `IDENTIFIERS: any label visible from this angle should match the front image (model ${ids.modelNo}, ${ids.serialNo}, ${ids.upc}). Don't invent new text; skip anything hidden by the angle.`
    );
  }

  function buildPrompt(img, hasLogo, hasFrontReference = false) {
    const alt         = (img.alt || "").trim();
    const productName = (img.productName || alt.split(" — ")[0]).trim();
    const shotDesc    = img.name === "with-packaging.jpg"
      ? packagingShotDesc(img)
      : (SHOT_DESCRIPTIONS[img.name] || `View of ${alt}`);
    const front       = isFrontImage(img);
    const ids         = productIdentifiers(img);
    const env         = environmentFor(img);
    const sig         = signatureFor(img);

    const logoLine = hasLogo
      ? "BRAND LOGO: the attached logo is the official brand logo. Place it on the product like a real manufacturer would (embossed, printed or labeled), keeping its design, colors, spelling and proportions."
      : "";

    const referenceLine = hasFrontReference
      ? "FRONT REFERENCE: one attached image is the approved FRONT VIEW of this exact product (not the logo). Match its shape, proportions, color, finish, materials, logo placement and visible details; change only the viewpoint."
      : "";

    const head = (
      `${FORMAT_RULE}\n\n` +
      `Product photography: ${productName}\n\n` +
      `${shotDesc}\n\n` +
      `ENVIRONMENT (${env.name}): ${env.text}${front ? "" : " Use the SAME environment, palette and lighting as the front reference."}\n\n` +
      `${STUDIO_LIGHTING}\n\n` +
      `${BACKGROUND_RULE}\n\n` +
      `${REALISM_RULE}\n\n` +
      `${UNIQUE_RULE} SIGNATURE TOUCH: ${sig}.\n\n` +
      (logoLine ? `${logoLine}\n\n` : "") +
      (referenceLine ? `${referenceLine}\n\n` : "") +
      (front ? `${buildFrontDetailBlock(img, ids, hasLogo)}\n\n` : `${buildIdentifierConsistencyBlock(img, ids)}\n\n`) +
      `${CONSISTENCY_RULE}\n\n`
    );

    const tail = `\n\nREMINDER: one 1:1 ultra-realistic, distinctive image in the described environment. Use the details that help, ignore the rest.`;

    // Fit the description into whatever room is left under the hard limit.
    const label = "Product description: ";
    const room  = MAX_PROMPT_CHARS - head.length - label.length - tail.length;
    let desc = (img.description || alt).trim();
    if (room <= 0) desc = "";
    else if (desc.length > room) desc = desc.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "") + "…";

    const prompt = head + (desc ? label + desc : "") + tail;
    return prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) : prompt;
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
    const candidates = [
      ...document.querySelectorAll('textarea[name="user-prompt"]'),
      ...document.querySelectorAll('[data-testid="duckai-chat-input"] textarea'),
      ...document.querySelectorAll('div[contenteditable="true"]'),
      ...document.querySelectorAll("textarea"),
    ];
    return candidates.find((input) => !input.disabled && input.getClientRects().length) || null;
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
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      document.execCommand("insertText", false, text);
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true, inputType: "insertText", data: text,
      }));
    }
    startImageTimer();   // prompt is in → (re)start the 5-min image countdown
    await sleep(SUBMIT_DELAY_MS);
  }

  async function submitPrompt() {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const btn = document.querySelector(SEL.submitBtn);
      if (btn && !btn.disabled) { btn.click(); return; }
      await sleep(100);
    }
    throw new Error("Duck.ai did not accept the prompt; Send remained disabled");
  }

  // ── Per-image 5-minute timer ──────────────────────────────────────────────────
  // Starts (and restarts) every time a prompt is typed into duck.ai. The image must be
  // downloaded before it reaches IMAGE_TIMEOUT_MS; otherwise a "retryable" error is
  // thrown and runLoop redoes the SAME image from scratch (new chat, same prompt).
  let imgTimerStart = null;   // ms timestamp, null = not running
  let imgTimerLast  = null;   // ms the last image took (shown when idle)
  let imgRetries    = 0;      // fresh redos used for the current image

  function startImageTimer() { imgTimerStart = Date.now(); }
  function stopImageTimer() {
    if (imgTimerStart !== null) imgTimerLast = Date.now() - imgTimerStart;
    imgTimerStart = null;
  }
  const imageTimerElapsed = () => (imgTimerStart === null ? 0 : Date.now() - imgTimerStart);
  const imageTimerExpired = () => imgTimerStart !== null && imageTimerElapsed() >= IMAGE_TIMEOUT_MS;
  function retryError(msg) { const e = new Error(msg); e.retryable = true; return e; }
  const fmtMs = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // ── Wait for duck.ai's native Download button ─────────────────────────────────
  async function waitForDownloadBtn(timeout = DOWNLOAD_TIMEOUT) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const btn = document.querySelector(SEL.downloadBtn);
      if (btn) return btn;
      if (automationAbort) throw new Error("Stopped by user");
      if (imageTimerExpired()) throw retryError(`Image not ready after ${fmtMs(IMAGE_TIMEOUT_MS)}`);
      await sleep(POLL_MS);
    }
    throw retryError("Timed out waiting for Download image button");
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
    stopImageTimer();   // downloaded in time → stop the 5-min countdown
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
  const isFrontImage = (img) => Boolean(img?.primary) || img?.name === "main.jpg";

  async function captureGeneratedFrontImage() {
    const images = [...document.querySelectorAll(
      'img[alt*="Selected generated image"], img[aria-label*="generated image"]'
    )];
    const source = images.at(-1)?.currentSrc || images.at(-1)?.src;
    if (!source) throw new Error("Could not capture the generated front image");
    const response = await fetch(source);
    if (!response.ok) throw new Error("Could not read the generated front image");
    const blob = await response.blob();
    return new File([blob], "front-reference.png", { type: blob.type || "image/png" });
  }

  async function createFrontReference(img, currentCount, downloadFront) {
    const frontImg = state.images.find((candidate) =>
      String(candidate.product_id) === String(img.product_id) && isFrontImage(candidate)
    );
    if (!frontImg) throw new Error("This product has no main.jpg entry for a front reference");

    const slug = brandSlugForImage(frontImg);
    const logoFile = await fetchLogoFile(slug);
    await clickNewImage();
    await sleep(1_500);
    try { await waitFor('[data-testid="duckai-chat-input"]', 8_000); }
    catch (_) { await sleep(2_000); }

    if (logoFile) {
      setStatus("Regenerating front reference…");
      await attachRequiredFile(logoFile, "Brand logo");
      await sleep(600);
    }

    await typePrompt(buildPrompt(frontImg, !!logoFile));
    await submitPrompt();
    setStatus("Generating front reference…");
    await waitForDownloadBtn(DOWNLOAD_TIMEOUT);
    await sleep(800);
    const file = await captureGeneratedFrontImage();
    if (!downloadFront) stopImageTimer();   // generated in time; this one is not downloaded
    const count = downloadFront
      ? await clickDownloadAndWaitForCount(currentCount + 1)
      : null;
    return { file, count, frontImg };
  }

  async function runOne(img, currentCount, frontReference = null) {
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
    if (!isFrontImage(img)) {
      if (!frontReference) throw new Error("Front view reference is unavailable. Start this product from main.jpg");
      setStatus("Attaching generated front view…");
      await attachRequiredFile(frontReference, "Front reference");
      await sleep(600);
    }

    // 5. Type prompt
    setStatus("Typing prompt…");
    await typePrompt(buildPrompt(img, !!logoFile, !!frontReference && !isFrontImage(img)));

    // 6. Submit
    setStatus("Submitting…");
    await submitPrompt();

    // 7. Wait for Download button (image generation complete)
    setStatus("Generating… (waiting for Download button)");
    await waitForDownloadBtn(DOWNLOAD_TIMEOUT);
    await sleep(800);

    const generatedFront = isFrontImage(img) ? await captureGeneratedFrontImage() : null;

    // 8. Click Download → sorter catches it → count-server count increments
    setStatus("Downloading… waiting for sorter");
    const newCount = await clickDownloadAndWaitForCount(currentCount + 1);
    setStatus(`✓ Done  (count: ${newCount ?? "offline"})`);
    return { count: newCount, generatedFront };
  }

  // ── Automation loop ───────────────────────────────────────────────────────────
  let automationAbort = false;
  let loopActive      = false;   // true only while runLoop() is executing in THIS page
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
    if (loopActive) { setStatus("Previous run is still stopping… try again in a moment", true); return; }
    loopActive      = true;
    state.running   = true;
    state.paused    = false;
    automationAbort = false;
    await saveState(); render(); renderHud();

    console.log(`[Duck.ai Collector] runLoop start — images: ${state.images.length}, index: ${state.index}`);

    try {
      // Initial sync: read count-server to know how many are already saved.
      // If count-server is offline, default to state.index (resume where we left off).
      let savedCount = (await fetchCount()) ?? state.index;
      const frontReferences = new Map();

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
          let frontReference = frontReferences.get(String(img.product_id));
          if (!isFrontImage(img) && !frontReference) {
            const frontImg = state.images.find((candidate) =>
              String(candidate.product_id) === String(img.product_id) && isFrontImage(candidate)
            );
            const frontIndex = state.images.indexOf(frontImg);
            const frontMissing = frontIndex >= savedCount;
            const reference = await createFrontReference(img, savedCount, frontMissing);
            frontReference = reference.file;
            if (frontMissing) {
              savedCount = reference.count != null ? reference.count : savedCount + 1;
              state.done[doneKey(reference.frontImg)] = {
                ts: new Date().toISOString(), savedCount,
              };
              await saveState();
            }
            frontReferences.set(String(img.product_id), frontReference);
          }
          const result = await runOne(img, savedCount, frontReference);
          if (result.generatedFront) frontReferences.set(String(img.product_id), result.generatedFront);

          // Update savedCount from what count-server confirmed
          // If count-server is offline, just assume +1
          savedCount = (result.count != null) ? result.count : savedCount + 1;

          // Mark done and advance index by 1 — never skip multiple entries
          state.done[doneKey(img)] = { ts: new Date().toISOString(), savedCount };
          state.index++;              // ← simple increment, not set to savedCount
          await saveState(); render();
          await sleep(1500);

        } catch (e) {
          if (automationAbort) { setStatus("Stopped."); break; }
          const msg = `Error on image ${state.index + 1}: ${e.message}`;
          console.error("[Duck.ai Collector] runOne failed:", e);
          // Pause and wait to be resumed (by the watchdog or the user) — don't end the loop
          state.paused = true;
          await saveState(); render(); renderHud();
          setStatus(state.autoMode ? `${msg} — watchdog will retry` : msg, true);
          while (state.paused && !automationAbort) await sleep(1000);
          if (automationAbort) break;
        }
      }

      if (state.index >= state.images.length && !automationAbort) {
        setStatus(`✅ All ${state.images.length} images done! Total saved: ${totalDone()}`);
      }
    } finally {
      loopActive      = false;
      state.running   = false;
      automationAbort = false;
      await saveState(); render(); renderHud();
    }
  }

  // ── Watchdog ──────────────────────────────────────────────────────────────────
  // Every WATCHDOG_MS (60 s) it checks whether the automation is running.
  // ONLY if it is NOT running (loop dead after a reload/crash, or paused by an
  // error) does it resume it. If it is running, it does nothing.
  //
  // Armed  : Start / Resume            (state.autoMode = true)
  // Disarmed: Stop / manual Pause       (state.autoMode = false) → never fights the user
  // ── Keep-alive audio loop ─────────────────────────────────────────────────────
  // Chrome does not throttle/freeze a tab that is playing audible sound, so while the
  // run is armed we loop song.mp3 (in the extension root). Stops on Stop / Pause / done.
  const AUDIO_FILE   = "song.mp3";
  const AUDIO_VOLUME = 0.3;          // must be > 0 and the track must not be silent
  let keepAudio = null;
  function syncAudio(shouldPlay) {
    try {
      if (!keepAudio) {
        keepAudio = new Audio(chrome.runtime.getURL(AUDIO_FILE));
        keepAudio.loop   = true;
        keepAudio.volume = AUDIO_VOLUME;
        keepAudio.addEventListener("error", () =>
          console.warn("[Duck.ai Collector] could not load", AUDIO_FILE, "- is it in the extension folder?"));
      }
      if (shouldPlay && keepAudio.paused)        keepAudio.play().catch(() => {});  // blocked until user gesture / autoplay flag
      else if (!shouldPlay && !keepAudio.paused) keepAudio.pause();
    } catch (e) { console.warn("[Duck.ai Collector] audio:", e); }
  }

  const WD_SECONDS = WATCHDOG_MS / 1000;
  const WD_CIRC    = 2 * Math.PI * 15;            // ring circumference (r = 15)
  let wdNextAt      = Date.now() + WATCHDOG_MS;   // deadline-based, so tab throttling can't skew it
  let wdResumeCount = 0;
  let wdOffReason   = "Press Start to arm it";

  const isFinished = () => state.images.length > 0 && state.index >= state.images.length;
  const isRunning  = () => loopActive && !state.paused && !automationAbort;

  // Everything the UI needs, computed in one place.
  function wdView() {
    let kind = "off";
    if (state.images.length && state.autoMode) {
      kind = isFinished() ? "done" : (isRunning() ? "ok" : "stalled");
    }
    const left    = Math.max(0, Math.min(WD_SECONDS, Math.ceil((wdNextAt - Date.now()) / 1000)));
    const resumed = wdResumeCount ? ` · resumed ${wdResumeCount}×` : "";
    const copy = {
      off:     { title: "Watchdog off",         sub: wdOffReason,                          num: "–",  hud: "🛡 off" },
      done:    { title: "Watchdog idle",        sub: `All images finished${resumed}`,      num: "✓",  hud: "🛡 done" },
      ok:      { title: "Watchdog · running ✓", sub: `Next check in ${left}s${resumed}`,   num: left, hud: `🛡 ${left}s` },
      stalled: { title: "Watchdog · stalled",   sub: `Auto-resume in ${left}s${resumed}`,  num: left, hud: `⚠ ${left}s` },
    }[kind];
    const active = kind === "ok" || kind === "stalled";
    return { kind, ...copy, offset: active ? WD_CIRC * (1 - left / WD_SECONDS) : 0 };
  }

  function watchdogHTML() {
    const v = wdView();
    return `
      <div id="dai-wd" class="dai-watchdog" data-wd="${v.kind}"
           title="Every 60 s: if the process is not running, resume it. Stop / Pause turn it off.">
        <div class="dai-wd-ring">
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle class="dai-wd-track" cx="18" cy="18" r="15"></circle>
            <circle id="dai-wd-arc" class="dai-wd-arc" cx="18" cy="18" r="15"
                    style="stroke-dashoffset:${v.offset.toFixed(2)}"></circle>
          </svg>
          <span id="dai-wd-num" class="dai-wd-num">${v.num}</span>
        </div>
        <div class="dai-wd-info">
          <div id="dai-wd-title" class="dai-wd-title">${esc(v.title)}</div>
          <div id="dai-wd-sub" class="dai-wd-sub">${esc(v.sub)}</div>
        </div>
      </div>`;
  }

  // Patches only the watchdog elements — no full re-render, so inputs/status survive.
  function updateWatchdogUI() {
    const v   = wdView();
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const box = document.getElementById("dai-wd");
    if (box) {
      box.dataset.wd = v.kind;
      const arc = document.getElementById("dai-wd-arc");
      if (arc) arc.style.strokeDashoffset = v.offset.toFixed(2);
      set("dai-wd-num", v.num);
      set("dai-wd-title", v.title);
      set("dai-wd-sub", v.sub);
    }
    const pill = document.getElementById("dai-hud-wd");
    if (pill) { pill.dataset.wd = v.kind; set("dai-hud-wd-text", v.hud); }
  }

  function wdResume() {
    wdResumeCount++;
    const t = new Date().toLocaleTimeString();
    console.warn(`[Duck.ai Collector] 🛡 watchdog: not running → auto-resume #${wdResumeCount} (${t})`);
    if (loopActive) {                       // loop is alive but paused (e.g. after an error)
      state.paused = false;
      saveState(); render(); renderHud();
      setStatus(`🛡 Watchdog auto-resumed at ${t}`);
    } else {                                // loop is gone (page reload / crash) → restart it
      runLoop().catch((e) => setStatus(`Watchdog restart failed: ${e.message}`, true));
    }
  }

  function wdTick() {
    const now   = Date.now();
    const armed = state.images.length > 0 && state.autoMode && !isFinished();
    if (!armed) {
      wdNextAt = now + WATCHDOG_MS;         // idle: keep the ring full, start a fresh 60 s once armed
    } else if (now >= wdNextAt) {
      wdNextAt = now + WATCHDOG_MS;
      if (!isRunning()) wdResume();         // ← acts ONLY when the process is not running
    }
    syncAudio(armed);
    updateWatchdogUI();
  }

  // ── User controls (shared by the panel buttons and the HUD) ────────────────────
  function startRun() {
    if (loopActive) { setStatus("Previous run is still stopping… try again in a moment", true); return; }
    state.autoMode = true;
    syncAudio(true);
    wdNextAt = Date.now() + WATCHDOG_MS;
    runLoop().catch((e) => setStatus(`Start failed: ${e.message}`, true));
  }
  function resumeRun() {
    state.paused   = false;
    state.autoMode = true;
    syncAudio(true);
    wdNextAt = Date.now() + WATCHDOG_MS;
    saveState(); render(); renderHud();
  }
  function pauseRun() {
    state.paused   = true;
    state.autoMode = false;                 // user pause → watchdog stays out of the way
    wdOffReason    = "Paused by you";
    syncAudio(false);
    saveState(); render(); renderHud();
  }
  function stopRun() {
    automationAbort = true;                 // (was being set to false by the old chained assignment)
    state.running   = false;
    state.paused    = false;
    state.autoMode  = false;                // user stop → watchdog off
    wdOffReason     = "Stopped by you";
    syncAudio(false);
    saveState(); render(); renderHud(); setStatus("Stopped.");
  }
  function toggleRun() {
    if (!state.images.length) { setStatus("Import product_images.json first", true); return; }
    if (!state.running)      startRun();
    else if (state.paused)   resumeRun();
    else                     pauseRun();
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
      ${watchdogHTML()}
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
    on("dai-run",  toggleRun);
    on("dai-stop", stopRun);
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
      state = { ...state, images: [], index: 0, done: {}, running: false, paused: false, autoMode: false };
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
      </button>
      <div id="dai-hud-wd" class="dai-pill dai-watchdog-pill" data-wd="${wdView().kind}"
           title="Watchdog: checks every 60 s and resumes only if the process is not running">
        <span id="dai-hud-wd-text">${esc(wdView().hud)}</span>
      </div>`;

    document.getElementById("dai-hud-start").addEventListener("click", toggleRun);
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

  // ── Alarm ping from background.js (chrome.alarms, every 30 s) ─────────────────
  // Page timers get throttled/frozen when hidden; the service-worker alarm does not.
  // wdTick() is deadline-based, so calling it here makes the watchdog fire on time
  // even if the setInterval(wdTick, 500) below is being throttled.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "alarm-ping") return false;
    wdTick();
    sendResponse({ ok: true, running: isRunning(), autoMode: state.autoMode });
    return false;
  });

  // ── Boot ──────────────────────────────────────────────────────────────────────
  loadState().then(async () => {
    if (!state.images.length) {
      try { await loadBundledQueue(); }
      catch (e) { console.error("[Duck.ai Collector] Bundled queue load failed:", e); }
    }
    render(); renderHud();
    setInterval(wdTick, 500);   // watchdog heartbeat + countdown refresh
  });
})();