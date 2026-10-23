"use strict";
/**
 * src/logo-sorter.js
 *
 * Variant of sorter.js for brand LOGO images.
 *
 * Watches data/temp/ for new image files, reads the logo manifest
 * (product_images_rearranged.json in the 'new/' folder), and moves
 * each incoming image to:
 *
 *   data/output-img/brand-logos/<brand-slug>/logo.png
 *
 * One brand per entry — no 5-image slots, just a single logo.png.
 *
 * Usage:
 *   node src/logo-sorter.js
 *   node src/logo-sorter.js --temp  data/temp
 *                           --manifest  ../new/product_images_rearranged.json
 *                           --outroot   data/output-img/brand-logos
 */

const fs   = require("fs");
const path = require("path");
const log  = require("./logger");

const IMG_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".bmp", ".tiff", ".tif",
]);

// ── arg parse ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function isImageFile(filename) {
  return IMG_EXTS.has(path.extname(filename).toLowerCase());
}

function countImages(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return count;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory())  count += countImages(path.join(dir, entry.name));
    else if (entry.isFile() && isImageFile(entry.name)) count++;
  }
  return count;
}

function listTempImages(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => {
      try { return isImageFile(f) && fs.statSync(path.join(dir, f)).isFile(); }
      catch { return false; }
    });
  } catch { return []; }
}

function loadManifest(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (err) { throw new Error(`Cannot read manifest "${file}": ${err.message}`); }
}

/**
 * Flatten the logo manifest.
 *
 * Each entry in product_images_rearranged.json has:
 *   { id, path, images: [{ id, name, alt, product_id, path }] }
 *
 * We flatten to a single-image list — one row per brand logo.
 */
function flattenManifest(raw) {
  if (!Array.isArray(raw)) throw new Error("Manifest must be a JSON array");
  // Each entry has an images array with exactly one item (logo.png)
  if (raw.length > 0 && Array.isArray(raw[0].images)) {
    return raw.flatMap((p) => p.images);
  }
  // Flat already
  return raw;
}

// ── core ──────────────────────────────────────────────────────────────────────
function processImage(srcFile, outRoot, manifestPath) {
  const idx      = countImages(outRoot);
  const manifest = flattenManifest(loadManifest(manifestPath));

  if (idx >= manifest.length) {
    log.warn(`index=${idx} exceeds manifest (${manifest.length}). All logos done?`);
    return false;
  }

  const entry = manifest[idx];

  // entry.path may carry a stale prefix (old "data/brand-logos/..." etc).
  // We don't care about any of that — just take the last folder segment
  // as the brand slug and write a flat <slug>.png straight into outRoot.
  const segments = entry.path.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean);
  const slug     = segments[segments.length - 1] || "brand";

  const destFile = path.join(outRoot, `${slug}.png`);

  const relSrc  = path.relative(path.join(outRoot, "..", ".."), srcFile).replace(/\\/g, "/");
  const relDest = `${slug}.png`;

  log.divider(`LOGO #${idx + 1}`);
  log.info(
    `${log.paint(log.C.bwhite + log.C.bold, entry.name)}` +
    `  [${log.paint(log.C.byellow, String(idx + 1))}/${manifest.length}]` +
    `  ${log.progressBar(idx + 1, manifest.length)}`
  );
  log.info(`  brand : ${log.paint(log.C.bblue, entry.alt || slug)}`);
  log.info(`  src   : ${log.paint(log.C.gray, relSrc)}`);
  log.info(`  dest  : ${log.paint(log.C.bblue, relDest)}`);

  if (fs.existsSync(destFile)) {
    const backup = `${destFile}.bak-${Date.now()}`;
    fs.renameSync(destFile, backup);
    log.warn(`Backed up → ${log.paint(log.C.gray, path.basename(backup))}`);
  }

  try {
    fs.renameSync(srcFile, destFile);
    log.ok(
      `Moved  count=${log.paint(log.C.bgreen, String(idx + 1))}` +
      `  left=${log.paint(log.C.byellow, String(manifest.length - idx - 1))}`
    );
    return true;
  } catch {
    try {
      fs.copyFileSync(srcFile, destFile);
      fs.unlinkSync(srcFile);
      log.ok(`Copied  count=${log.paint(log.C.bgreen, String(idx + 1))}`);
      return true;
    } catch (err) {
      log.error(`Move failed: ${err.message}`);
      return false;
    }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  const ROOT = path.join(__dirname, "..");
  const NEW  = path.resolve(ROOT, "..", "new");

  const tempDir      = path.resolve(args.temp     || path.join(ROOT, "data", "temp"));
  const manifestPath = path.resolve(args.manifest || path.join(NEW,  "product_images_rearranged.json"));
  const outRoot      = path.resolve(args.outroot  || path.join(ROOT, "data", "output-img", "brand-logos"));
  const pollMs       = parseInt(args.poll || "500", 10);

  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(outRoot, { recursive: true });

  log.banner("LOGO SORTER", "Watches temp/ → output-img/brand-logos/");
  log.info(`Watching  : ${log.paint(log.C.bwhite, "data/temp")}`);
  log.info(`Manifest  : ${log.paint(log.C.bwhite, path.relative(ROOT, manifestPath))}`);
  log.info(`Out root  : ${log.paint(log.C.bwhite, path.relative(ROOT, outRoot))}`);
  log.info(`Poll      : ${log.paint(log.C.byellow, pollMs + "ms")}  (fallback)`);
  log.divider();

  const currentCount = countImages(outRoot);
  let manifest;
  try {
    manifest = flattenManifest(loadManifest(manifestPath));
    log.info(
      `Manifest: ${log.paint(log.C.bgreen, String(manifest.length))} brands` +
      `  done=${log.paint(log.C.byellow, String(currentCount))}` +
      `  left=${log.paint(log.C.bcyan, String(Math.max(0, manifest.length - currentCount)))}`
    );
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }

  log.divider();
  log.info(`Waiting for logo images...  ${log.paint(log.C.gray, "(Ctrl+C to stop)")}`);
  process.stdout.write("\n");

  const processing = new Set();
  let fileCount    = 0;

  function handleFile(filename) {
    if (!filename || !isImageFile(filename)) return;
    if (processing.has(filename)) return;

    const srcFile = path.join(tempDir, filename);
    if (!fs.existsSync(srcFile)) return;

    setTimeout(() => {
      if (!fs.existsSync(srcFile)) return;
      processing.add(filename);
      fileCount++;
      process.stdout.write(log.CURSOR.eraseLine + log.CURSOR.col0);
      log.info(
        `${log.paint(log.C.byellow + log.C.bold, "⚡ NEW")}` +
        `  ${log.paint(log.C.bwhite, filename)}` +
        `  (total: ${log.paint(log.C.bgreen, String(fileCount))})`
      );
      try {
        processImage(srcFile, outRoot, manifestPath);
      } catch (err) {
        log.error(err.message);
      } finally {
        processing.delete(filename);
        process.stdout.write("\n");
      }
    }, 300);
  }

  // Idle spinner
  let spinTick = 0;
  setInterval(() => {
    if (processing.size > 0) return;
    spinTick++;
    const cnt = countImages(outRoot);
    process.stdout.write(
      log.CURSOR.eraseLine + log.CURSOR.col0 +
      `  ${log.spinnerFrame()} ` +
      `${log.paint(log.C.gray, "waiting")}` +
      `  logos=${log.paint(log.C.bgreen, String(cnt).padStart(3))}` +
      `  done=${log.paint(log.C.bcyan, String(fileCount).padStart(3))}`
    );
  }, 300);

  // Watch temp/
  try {
    fs.watch(tempDir, { persistent: true }, (eventType, filename) => {
      if (eventType === "rename") handleFile(filename);
    });
    log.info(
      `Using ${log.paint(log.C.bgreen, "fs.watch")} ` +
      log.paint(log.C.gray, "(instant detection)")
    );
  } catch {
    log.warn(`fs.watch unavailable — polling every ${pollMs}ms`);
    let known = new Set(listTempImages(tempDir));
    setInterval(() => {
      const current = new Set(listTempImages(tempDir));
      for (const f of current) if (!known.has(f)) handleFile(f);
      known = current;
    }, pollMs);
  }
}

main();