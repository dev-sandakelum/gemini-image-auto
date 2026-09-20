/**
 * generate_product_images.mjs
 *
 * Reads products.json (100 fictional PC-parts products) and generates 5
 * e-commerce style product images per product using Puter.js image
 * generation (routed to Gemini's "Nano Banana" model via Puter's Gemini
 * provider — no Gemini API key needed, auth is via your free Puter.com
 * account token):
 *
 *     01-front.jpg      - clean studio front/hero shot (primary)
 *     02-alternate.jpg  - alternate 3/4 angle
 *     03-detail.jpg     - close-up on a distinguishing feature
 *     04-context.jpg    - product in a realistic in-use setting
 *     05-packaging.jpg  - retail box / packaging shot
 *
 * Images are written to:
 *     output/{id}-{slug}/01-front.jpg ... 05-packaging.jpg
 *
 * A progress log (progress.json) is kept so the script can be re-run
 * safely - already-generated images are skipped.
 *
 * IMPORTANT: This script edits products.json's `images` array IN PLACE for
 * each product as soon as all 5 of its images are generated (a backup of
 * the original is written once, on first run, to products.json.bak). A
 * separate image-mapping.json is also written as a plain record of
 * id -> paths.
 *
 * SETUP:
 *   npm install
 *   Get your Puter auth token from https://puter.com/dashboard#account
 *     (click "Create token")
 *
 * USAGE:
 *   PUTER_AUTH_TOKEN="your-token" node generate_product_images.mjs
 *   PUTER_AUTH_TOKEN="your-token" node generate_product_images.mjs --limit 5
 *   PUTER_AUTH_TOKEN="your-token" node generate_product_images.mjs --ids 0,1,2
 *   PUTER_AUTH_TOKEN="your-token" node generate_product_images.mjs --retry-failed
 */

import { init } from "@heyputer/puter.js/src/init.cjs";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

// ── Config ──────────────────────────────────────────────────────────────

const MODEL = "gemini-2.5-flash-image-preview"; // "Nano Banana" via Puter's Gemini provider (alias: "nano-banana")
const PRODUCTS_JSON = path.resolve("./products.json");
const PRODUCTS_JSON_BACKUP = path.resolve("./products.json.bak");
const OUTPUT_DIR = path.resolve("./output");
const PROGRESS_FILE = path.resolve("./progress.json");
const MAPPING_FILE = path.resolve("./image-mapping.json");

// Public path prefix used in the mapping / products.json urls
const PUBLIC_PATH_PREFIX = "/products";

// Delay between calls - polite pacing, avoids hammering the provider.
const REQUEST_DELAY_MS = 3000;

// Retry behavior for transient errors (rate limits, timeouts, 5xx)
const MAX_RETRIES = 4;
const RETRY_BACKOFF_BASE_MS = 8000; // doubles each retry

const IMAGE_SLOTS = ["front", "alternate", "detail", "context", "packaging"];

const ALT_TEXT_SUFFIX = {
  front: "front view",
  alternate: "alternate angle",
  detail: "close-up detail",
  context: "in use",
  packaging: "retail packaging",
};

// ── Prompt building ─────────────────────────────────────────────────────

function topSpecs(specs, n = 4) {
  return Object.entries(specs || {})
    .slice(0, n)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

const CATEGORY_HINTS = {
  gpus: "a graphics card with visible cooling fans, heatsink fins, and a PCIe connector edge",
  cpus: "a processor chip, showing the top of the integrated heat spreader with pins or contact pads",
  motherboards: "a PC motherboard with chipset heatsinks, RAM slots, and expansion slots visible",
  ram: "a memory module (RAM stick) with a heat spreader, shown standing upright",
  psus: "a power supply unit, a matte metal box with a cooling fan grille and modular cable ports on one side",
  storage: "a solid state drive or M.2 NVMe drive, a small rectangular module",
  cooling: "a PC cooling product such as an AIO liquid cooler radiator and pump, or a large air cooler with heatsink fins",
  cases: "a PC case (computer tower) with a tempered glass side panel",
  peripherals: "a computer peripheral such as a keyboard, mouse, headset, or monitor",
};

const DETAIL_HINTS = {
  gpus: "an extreme close-up on the cooling fans and heatsink fins, showing texture and build quality",
  cpus: "an extreme close-up on the metal integrated heat spreader surface and corner notches",
  motherboards: "an extreme close-up on the CPU socket area and chipset heatsink",
  ram: "an extreme close-up on the heat spreader texture and top edge of the module",
  psus: "an extreme close-up on the modular cable ports and fan grille",
  storage: "an extreme close-up on the connector edge and label area of the drive",
  cooling: "an extreme close-up on the fan blades or pump top and tubing",
  cases: "an extreme close-up on the tempered glass panel edge and front I/O ports",
  peripherals: "an extreme close-up on key texture, switches, or the scroll wheel/buttons depending on the device",
};

const CONTEXT_HINTS = {
  gpus: "installed inside an open PC case with RGB lighting visible, other components softly out of focus",
  cpus: "resting on a motherboard socket, about to be installed, with a light bokeh PC-building scene in the background",
  motherboards: "laid inside an open PC case mid-build, cables and other components softly out of focus",
  ram: "installed in a motherboard's RAM slots inside an open PC case",
  psus: "installed at the bottom of an open PC case with cables routed neatly",
  storage: "installed on a motherboard M.2 slot or mounted in a case drive bay",
  cooling: "installed on top of a CPU inside an open PC case, other components softly out of focus",
  cases: "sitting on a desk in a modern gaming/office setup, powered on with subtle interior lighting glow",
  peripherals: "in use on a clean modern desk setup, alongside a keyboard/mouse/monitor as appropriate",
};

function buildPrompts(product) {
  const category = product.categorySlug || "";
  const specsStr = topSpecs(product.specs);
  // product.name already includes the brand (e.g. "Nova RTX 9090 16GB
  // Graphics Card") - don't prepend brand again.
  const fullName = (product.name || "").trim();

  const hint = CATEGORY_HINTS[category] || "a computer hardware component";
  const detailHint = DETAIL_HINTS[category] || "an extreme close-up on a distinctive part of the product";
  const contextHint = CONTEXT_HINTS[category] || "in a realistic use setting on a desk or inside a PC";

  const baseSubject =
    `a ${fullName}, ${hint}. Key specs for visual accuracy: ${specsStr}. ` +
    `The product is a fictional/generic brand design — do not reproduce any real ` +
    `manufacturer logos (no NVIDIA, AMD, Intel, Corsair, ASUS, etc. branding); ` +
    `use a plain, neutral, invented brand look instead.`;

  return {
    front:
      `A high-resolution, studio-lit e-commerce product photograph of ${baseSubject} ` +
      `Centered composition, plain white/light-grey seamless background, soft three-point ` +
      `softbox lighting, no harsh shadows, straight-on front angle. Ultra-realistic, sharp ` +
      `focus, professional product photography style. Square image, no text or watermarks.`,
    alternate:
      `A high-resolution, studio-lit e-commerce product photograph of ${baseSubject} ` +
      `Centered composition, plain white/light-grey seamless background, soft studio lighting, ` +
      `shown from a 3/4 rotated angle to reveal a different side and depth of the product. ` +
      `Ultra-realistic, sharp focus, professional product photography style. Square image, ` +
      `no text or watermarks.`,
    detail:
      `A high-resolution, studio-lit macro product photograph of ${baseSubject} ` +
      `The shot is ${detailHint}. Plain white/light-grey seamless background, soft studio ` +
      `lighting, shallow depth of field to emphasize texture and material quality. ` +
      `Ultra-realistic, sharp focus. Square image, no text or watermarks.`,
    context:
      `A high-resolution, realistic photograph of ${baseSubject} ` +
      `shown ${contextHint}. Natural but clean lighting, shallow depth of field with the ` +
      `product in sharp focus and the surroundings softly blurred. Ultra-realistic, ` +
      `professional product-in-context photography style. Square image, no text or watermarks.`,
    packaging:
      `A high-resolution, studio-lit product photograph of the retail packaging box for ` +
      `${baseSubject} The box design is clean and modern, showing a generic product ` +
      `illustration or window, with the product name '${fullName}' printed on the front in a ` +
      `clean sans-serif font. Plain white/light-grey seamless background, soft studio lighting, ` +
      `slight 3/4 angle to show box depth. Ultra-realistic, sharp focus. Square image, ` +
      `no watermarks.`,
  };
}

// ── Progress tracking ────────────────────────────────────────────────────

async function loadProgress() {
  try {
    const raw = await fs.readFile(PROGRESS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { completed: {}, failed: {} };
  }
}

async function saveProgress(progress) {
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function imageKey(productId, slot) {
  return `${productId}:${slot}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Image generation ─────────────────────────────────────────────────────

/** Decode a data URL ("data:image/png;base64,....") into a Buffer. */
function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) {
    throw new Error("Response was not a base64 data URL as expected");
  }
  return Buffer.from(match[2], "base64");
}

/** Fetch a plain http(s) URL and return its bytes as a Buffer. */
async function httpUrlToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download generated image: HTTP ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function generateOneImage(puter, prompt) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await puter.ai.txt2img(prompt, { model: MODEL });

      // The Node build resolves this to an Image-like polyfill object (or,
      // in some SDK versions, a plain string). Either way, .toString() /
      // String(result) gives the image src, which may be a data: URL or a
      // plain http(s) URL depending on SDK version - handle both.
      const src = typeof result === "string" ? result : String(result);

      if (src.startsWith("data:")) {
        return dataUrlToBuffer(src);
      } else if (src.startsWith("http://") || src.startsWith("https://")) {
        return await httpUrlToBuffer(src);
      } else {
        throw new Error(`Unrecognized image src format (first 50 chars): ${src.slice(0, 50)}`);
      }
    } catch (err) {
      const msg = extractErrorMessage(err);
      const isRateLimited = /429|rate.?limit|quota/i.test(msg);
      const isServerError = /5\d\d|timeout|ECONNRESET|ETIMEDOUT/i.test(msg);

      if ((isRateLimited || isServerError) && attempt < MAX_RETRIES) {
        const wait = RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1);
        console.log(`    transient error (${msg}), waiting ${wait / 1000}s (attempt ${attempt}/${MAX_RETRIES})...`);
        await sleep(wait);
        continue;
      }
      throw new Error(msg);
    }
  }
  throw new Error(`Failed after ${MAX_RETRIES} retries`);
}

/**
 * Puter.js (running its browser bundle inside a Node vm sandbox) sometimes
 * rejects with plain objects, nested error shapes, or objects whose
 * .message is itself an object - none of which stringify usefully by
 * default. Dig through common shapes to find something human-readable.
 */
function extractErrorMessage(err) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    if (typeof err.message === "string") return err.message;
    if (err.error && typeof err.error === "string") return err.error;
    if (err.error && typeof err.error.message === "string") return err.error.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

async function processProduct(puter, product, progress) {
  const pid = product.id;
  const slug = product.slug;
  const folderName = `${pid}-${slug}`;
  const outDir = path.join(OUTPUT_DIR, folderName);
  await fs.mkdir(outDir, { recursive: true });

  const prompts = buildPrompts(product);
  const resultPaths = {};

  for (let i = 0; i < IMAGE_SLOTS.length; i++) {
    const slot = IMAGE_SLOTS[i];
    const filename = `0${i + 1}-${slot}.jpg`;
    const filepath = path.join(outDir, filename);
    const key = imageKey(pid, slot);

    // Skip already-completed images (safe re-run / resume)
    if (progress.completed[key] && fsSync.existsSync(filepath)) {
      console.log(`  [${slot}] already done, skipping`);
      resultPaths[slot] = `${PUBLIC_PATH_PREFIX}/${folderName}/${filename}`;
      continue;
    }

    console.log(`  [${slot}] generating...`);
    try {
      const imageBuffer = await generateOneImage(puter, prompts[slot]);
      await fs.writeFile(filepath, imageBuffer);
      progress.completed[key] = `${PUBLIC_PATH_PREFIX}/${folderName}/${filename}`;
      delete progress.failed[key];
      resultPaths[slot] = progress.completed[key];
      console.log(`  [${slot}] saved -> ${filepath}`);
    } catch (err) {
      const msg = extractErrorMessage(err);
      console.log(`  [${slot}] FAILED: ${msg}`);
      progress.failed[key] = msg;
    } finally {
      await saveProgress(progress); // save after every single image
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return resultPaths;
}

function buildImagesArray(product, resultPaths) {
  const images = [];
  IMAGE_SLOTS.forEach((slot, i) => {
    if (!(slot in resultPaths)) return; // failed slot: omit rather than write broken entry
    images.push({
      id: i + 1,
      url: resultPaths[slot],
      alt: `${product.name} — ${ALT_TEXT_SUFFIX[slot]}`,
      primary: slot === "front",
    });
  });
  return images;
}

async function updateProductsJson(allProducts) {
  if (!fsSync.existsSync(PRODUCTS_JSON_BACKUP)) {
    await fs.copyFile(PRODUCTS_JSON, PRODUCTS_JSON_BACKUP);
    console.log(`(backed up original to ${PRODUCTS_JSON_BACKUP})`);
  }
  await fs.writeFile(PRODUCTS_JSON, JSON.stringify(allProducts, null, 2));
}

// ── CLI arg parsing ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { limit: null, ids: null, retryFailed: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (argv[i] === "--ids") args.ids = argv[++i].split(",").map((s) => parseInt(s.trim(), 10));
    else if (argv[i] === "--retry-failed") args.retryFailed = true;
  }
  return args;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const authToken = process.env.PUTER_AUTH_TOKEN;
  if (!authToken) {
    console.error("ERROR: Set the PUTER_AUTH_TOKEN environment variable first.");
    console.error('  PUTER_AUTH_TOKEN="your-token" node generate_product_images.mjs');
    console.error("  Get a token from https://puter.com/dashboard#account (Create token)");
    process.exit(1);
  }

  if (!fsSync.existsSync(PRODUCTS_JSON)) {
    console.error(`ERROR: ${PRODUCTS_JSON} not found. Put products.json next to this script,`);
    console.error("or edit PRODUCTS_JSON near the top of the file.");
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const puter = init(authToken);
  const progress = await loadProgress();

  const allProducts = JSON.parse(await fs.readFile(PRODUCTS_JSON, "utf-8"));
  const productsById = new Map(allProducts.map((p) => [p.id, p]));

  let targetProducts;
  if (args.ids) {
    const wanted = new Set(args.ids);
    targetProducts = allProducts.filter((p) => wanted.has(p.id));
  } else if (args.limit) {
    targetProducts = allProducts.slice(0, args.limit);
  } else {
    targetProducts = [...allProducts];
  }

  if (args.retryFailed) {
    const failedIds = new Set(Object.keys(progress.failed).map((k) => parseInt(k.split(":")[0], 10)));
    targetProducts = allProducts.filter((p) => failedIds.has(p.id));
    console.log(`Retrying ${targetProducts.length} product(s) with failed images...\n`);
  }

  console.log(`Processing ${targetProducts.length} product(s), ${targetProducts.length * IMAGE_SLOTS.length} image(s) total\n`);

  let mapping = {};
  if (fsSync.existsSync(MAPPING_FILE)) {
    mapping = JSON.parse(await fs.readFile(MAPPING_FILE, "utf-8"));
  }

  for (let idx = 0; idx < targetProducts.length; idx++) {
    const product = targetProducts[idx];
    console.log(`[${idx + 1}/${targetProducts.length}] ${product.name} (id=${product.id})`);
    const paths = await processProduct(puter, product, progress);

    mapping[String(product.id)] = {
      slug: product.slug,
      name: product.name,
      images: paths,
    };
    await fs.writeFile(MAPPING_FILE, JSON.stringify(mapping, null, 2));

    // Only rewrite this product's images[] if ALL 5 slots succeeded, so we
    // never leave a product with a partial/broken images array.
    if (Object.keys(paths).length === IMAGE_SLOTS.length) {
      productsById.get(product.id).images = buildImagesArray(product, paths);
      await updateProductsJson(allProducts);
      console.log("  -> products.json updated");
    } else {
      const missing = IMAGE_SLOTS.filter((s) => !(s in paths));
      console.log(`  -> products.json NOT updated for this product (missing: ${missing.join(", ")})`);
    }
    console.log("");
  }

  const totalDone = Object.keys(progress.completed).length;
  const totalFailed = Object.keys(progress.failed).length;
  console.log("=".repeat(50));
  console.log(`Done. ${totalDone} image(s) succeeded, ${totalFailed} failed.`);
  if (totalFailed) {
    console.log("Failed items logged in progress.json under 'failed'.");
    console.log("Re-run with --retry-failed to retry just those.");
  }
  console.log(`Mapping written to ${MAPPING_FILE}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
