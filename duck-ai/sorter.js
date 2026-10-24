"use strict";
/**
 * duck-ai/sorter.js
 *
 * Watches the Chrome Downloads queue folder for images dropped by the
 * duck-ai-collector extension, then routes each one to the correct output
 * path based on the active manifest (images_partN.json).
 *
 * The extension downloads every generated image to:
 *   C:\Users\<user>\Downloads\duck-ai-queue\queue-<timestamp>.png
 *
 * This sorter:
 *   1. Counts images already in img/
 *   2. Looks up that index in the flat manifest
 *   3. Renames & moves the file to img/<category>/<product-slug>/<name>
 *
 * The count-server broadcasts the img/ count so the extension knows
 * when to submit the next prompt.
 *
 * Usage:
 *   node sorter.js
 *   node sorter.js --manifest ../new/images/images_part2.json
 *   node sorter.js --queue C:\Users\<user>\Downloads\duck-ai-queue
 *                  --manifest ../new/images/images_part1.json
 *                  --outroot img
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"]);
const HERE     = __dirname;

// ── ANSI colours (no deps) ────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  gray: "\x1b[90m",    bwhite: "\x1b[97m",
  green: "\x1b[32m",   bgreen: "\x1b[92m",
  yellow: "\x1b[33m",  byellow: "\x1b[93m",
  blue: "\x1b[34m",    bblue: "\x1b[94m",
  cyan: "\x1b[36m",    bcyan: "\x1b[96m",
  red: "\x1b[31m",     bred: "\x1b[91m",
};
const p    = (col, s) => `${col}${s}${C.reset}`;
const ok   = (m) => console.log(`${C.bgreen}✔${C.reset} ${m}`);
const warn = (m) => console.log(`${C.byellow}⚠${C.reset}  ${m}`);
const fail = (m) => console.log(`${C.bred}✘${C.reset} ${m}`);
const info = (m) => console.log(`  ${m}`);
const div  = (l = "") => console.log(p(C.gray, "─".repeat(60) + (l ? " " + l : "")));
const ERASE = "\x1b[2K\r";
const SP    = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
let   spI   = 0;
const spin  = () => SP[spI++ % SP.length];

function bar(done, total, w = 24) {
  const f = total > 0 ? Math.round((done / total) * w) : 0;
  return `[${p(C.bgreen,"█".repeat(f))}${p(C.gray,"░".repeat(w-f))}] ${total > 0 ? Math.round((done/total)*100) : 0}%`;
}

// ── Arg parse ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      a[k] = (argv[i+1] && !argv[i+1].startsWith("--")) ? argv[++i] : true;
    }
  }
  return a;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const isImg   = (f) => IMG_EXTS.has(path.extname(f).toLowerCase());

function countImages(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return n;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countImages(path.join(dir, e.name));
    else if (e.isFile() && isImg(e.name)) n++;
  }
  return n;
}

function loadManifest(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(raw)) throw new Error("Manifest must be a JSON array");
  // Flatten nested format [{ product_id, images:[...] }]
  return (raw.length && Array.isArray(raw[0].images))
    ? raw.flatMap((p) => p.images)
    : raw;
}

// Strip the /data/output-img prefix the old JSON format uses
function stripPrefix(p) {
  return (p || "")
    .replace(/\\/g, "/")
    .replace(/\/$/, "")
    .replace(/^\/data\/output-img/, "")
    .replace(/^\//, "");
}

// ── Core: move one queued image to the right output path ──────────────────────
function processImage(srcFile, outRoot, manifest) {
  const idx = countImages(outRoot);   // # already saved = next slot

  if (idx >= manifest.length) {
    warn(`All ${manifest.length} images done. Nothing to sort.`);
    // Delete the stray queue file so it doesn't accumulate
    try { fs.unlinkSync(srcFile); } catch (_) {}
    return false;
  }

  const entry   = manifest[idx];
  const rel     = stripPrefix(entry.path);
  const destDir = path.join(outRoot, rel);
  const dest    = path.join(destDir, entry.name);

  div(`IMAGE #${idx + 1}`);
  info(`${p(C.bwhite + C.bold, entry.name)}  [${p(C.byellow, String(idx+1))}/${manifest.length}]  ${bar(idx+1, manifest.length)}`);
  info(`  alt : ${p(C.gray,  entry.alt  || "")}`);
  info(`  dest: ${p(C.bblue, path.join(rel, entry.name).replace(/\\/g,"/"))}`);

  fs.mkdirSync(destDir, { recursive: true });

  if (fs.existsSync(dest)) {
    const bak = `${dest}.bak-${Date.now()}`;
    fs.renameSync(dest, bak);
    warn(`Backed up existing → ${path.basename(bak)}`);
  }

  try {
    fs.renameSync(srcFile, dest);
  } catch {
    // Cross-drive move
    fs.copyFileSync(srcFile, dest);
    fs.unlinkSync(srcFile);
  }

  ok(
    `Saved  ${p(C.bgreen, String(idx+1))} / ${manifest.length}` +
    `  left: ${p(C.byellow, String(manifest.length - idx - 1))}`
  );
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);

  // Default queue: ./queue if it exists, else Downloads\duck-ai-queue
  const defaultQueue = fs.existsSync(path.join(HERE, "queue"))
    ? path.join(HERE, "queue")
    : path.join(os.homedir(), "Downloads", "duck-ai-queue");
  const queueDir     = path.resolve(args.queue    || defaultQueue);
  const manifestPath = path.resolve(args.manifest || path.join(HERE, "..", "new", "images", "images_part1.json"));
  const outRoot      = path.resolve(args.outroot  || path.join(HERE, "img"));
  const pollMs       = parseInt(args.poll || "500", 10);

  fs.mkdirSync(queueDir, { recursive: true });
  fs.mkdirSync(outRoot,  { recursive: true });

  // ── Banner ──────────────────────────────────────────────────────────────────
  console.log("");
  console.log(p(C.bwhite + C.bold, "  🦆 DUCK-AI IMAGE SORTER  v2"));
  div();
  info(`Queue    : ${p(C.bwhite, queueDir)}`);
  info(`Manifest : ${p(C.bwhite, path.relative(HERE, manifestPath))}`);
  info(`Out root : ${p(C.bwhite, path.relative(HERE, outRoot))}`);
  div();

  // Load manifest
  let manifest;
  try {
    if (!fs.existsSync(manifestPath)) {
      fail(`Manifest file not found: ${manifestPath}`);
      fail(`Make sure the ../new/images/ folder was copied alongside duck-ai/`);
      fail(`Valid parts are --part 1  through  --part 7`);
      process.exit(1);
    }
    manifest = loadManifest(manifestPath);
  } catch (e) {
    fail(`Cannot load manifest: ${e.message}`);
    process.exit(1);
  }

  if (manifest.length === 0) {
    fail(`Manifest loaded but contains 0 images: ${manifestPath}`);
    fail(`Check the file is a valid images_partN.json (parts are numbered 1–7, not 0)`);
    process.exit(1);
  }

  const done = countImages(outRoot);
  info(`Manifest : ${p(C.bgreen, String(manifest.length))} images`);
  info(`Done     : ${p(C.byellow, String(done))}`);
  info(`Left     : ${p(C.bcyan,   String(Math.max(0, manifest.length - done)))}`);

  if (done < manifest.length) {
    info(`Next     : ${p(C.bwhite, manifest[done].alt || manifest[done].name || "?")}`);
  }

  div();
  info(`Watching : ${p(C.bgreen, queueDir)}`);
  info(p(C.gray, "  (Ctrl+C to stop)"));
  console.log("");

  // ── File handler ────────────────────────────────────────────────────────────
  const processing = new Set();

  function handleFile(filename) {
    if (!filename || !isImg(filename)) return;
    if (processing.has(filename))      return;

    const src = path.join(queueDir, filename);

    // Debounce 400ms — wait for file write to complete
    setTimeout(() => {
      if (!fs.existsSync(src)) return;
      processing.add(filename);
      process.stdout.write(ERASE);
      info(`${p(C.byellow + C.bold, "⚡ NEW")}  ${p(C.bwhite, filename)}`);
      try {
        processImage(src, outRoot, manifest);
      } catch (e) {
        fail(`Sort failed: ${e.message}`);
        console.error(e);
      } finally {
        processing.delete(filename);
        console.log("");
      }
    }, 400);
  }

  // Process any files already sitting in queue (leftover from previous run)
  // knownFiles tracks what we've already seen — used by scanForNew() and the poll fallback
  let knownFiles = new Set();
  if (fs.existsSync(queueDir)) {
    const existing = fs.readdirSync(queueDir).filter(isImg);
    existing.forEach((f) => knownFiles.add(f));
    if (existing.length) {
      info(`Processing ${existing.length} leftover file(s) in queue…`);
      existing.forEach((f) => handleFile(f));
    }
  }

  function scanForNew() {
    if (!fs.existsSync(queueDir)) return;
    const cur = new Set(fs.readdirSync(queueDir).filter(isImg));
    for (const f of cur) if (!knownFiles.has(f)) handleFile(f);
    knownFiles = cur;
  }

  try {
    fs.watch(queueDir, { persistent: true }, (type, filename) => {
      if (type !== "rename") return;
      if (filename) {
        handleFile(filename);
      } else {
        // Windows can fire with filename=null — scan the folder to find what changed
        scanForNew();
      }
    });
    info(p(C.bgreen, `  fs.watch active`) + p(C.gray, " (instant)"));
  } catch {
    warn(`fs.watch unavailable — polling every ${pollMs}ms`);
    setInterval(scanForNew, pollMs);
  }

  // ── Idle spinner ──────────────────────────────────────────────────────────────
  setInterval(() => {
    if (processing.size > 0) return;
    const saved = countImages(outRoot);
    const q     = fs.existsSync(queueDir)
                    ? fs.readdirSync(queueDir).filter(isImg).length : 0;
    process.stdout.write(
      ERASE +
      `  ${spin()} ${p(C.gray,"waiting")}` +
      `  saved=${p(C.bgreen,  String(saved).padStart(4))}` +
      `  queue=${p(C.byellow, String(q).padStart(2))}` +
      `  left=${p(C.bcyan,   String(Math.max(0, manifest.length - saved)).padStart(4))}`
    );
  }, 300);
}

main();
