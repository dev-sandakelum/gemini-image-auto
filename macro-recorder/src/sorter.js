"use strict";
/**
 * src/sorter.js
 * Temp-folder image sorter.
 *
 * Watches data/temp/ for new image files, reads the manifest,
 * and moves each incoming image to its correct output path.
 *
 * Usage:
 *   node src/sorter.js
 *   node src/sorter.js --temp data/temp
 *                      --manifest data/product_images.json
 *                      --outroot data/output-img
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
      const val =
        argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function isImageFile(filename) {
  return IMG_EXTS.has(path.extname(filename).toLowerCase());
}

function countImages(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return count;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countImages(path.join(dir, entry.name));
    else if (entry.isFile() && isImageFile(entry.name)) count++;
  }
  return count;
}

function listTempImages(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => {
      try {
        return isImageFile(f) && fs.statSync(path.join(dir, f)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function loadManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Cannot read manifest "${file}": ${err.message}`);
  }
}

function flattenManifest(raw) {
  if (!Array.isArray(raw))
    throw new Error("product_images.json must be a JSON array");
  if (raw.length > 0 && Array.isArray(raw[0].images)) {
    return raw.flatMap((p) => p.images);
  }
  return raw;
}

// ── core ─────────────────────────────────────────────────────────────────────
function processImage(srcFile, outRoot, manifestPath) {
  const idx      = countImages(outRoot);
  const manifest = flattenManifest(loadManifest(manifestPath));

  if (idx >= manifest.length) {
    log.warn(`index=${idx} exceeds manifest (${manifest.length}). All done?`);
    return false;
  }

  const entry = manifest[idx];

  const stripped = entry.path
    .replace(/\\/g, "/")
    .replace(/\/$/, "")
    .replace(/^\/data\/output-img/, "")
    .replace(/^\//, "");

  const destDir  = path.join(outRoot, stripped);
  const destFile = path.join(destDir, entry.name);

  // Compact relative display paths
  const relSrc  = path.relative(path.join(outRoot, "..", ".."), srcFile)
                    .replace(/\\/g, "/");
  const relDest = path.join(stripped, entry.name).replace(/\\/g, "/");

  log.divider(`IMAGE #${idx + 1}`);
  log.info(
    `${log.paint(log.C.bwhite + log.C.bold, entry.name)}` +
    `  [${log.paint(log.C.byellow, String(idx + 1))}/${manifest.length}]` +
    `  ${log.progressBar(idx + 1, manifest.length)}`
  );
  log.info(`  src : ${log.paint(log.C.gray,  relSrc)}`);
  log.info(`  dest: ${log.paint(log.C.bblue, relDest)}`);

  fs.mkdirSync(destDir, { recursive: true });

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

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  const ROOT = path.join(__dirname, "..");

  const tempDir      = path.resolve(args.temp     || path.join(ROOT, "data", "temp"));
  const manifestPath = path.resolve(args.manifest || path.join(ROOT, "data", "product_images.json"));
  const outRoot      = path.resolve(args.outroot  || path.join(ROOT, "data", "output-img"));
  const pollMs       = parseInt(args.poll || "500", 10);

  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(outRoot, { recursive: true });

  log.banner("IMAGE SORTER", "Watches temp/ → routes to output-img/");
  log.info(`Watching : ${log.paint(log.C.bwhite, "data/temp")}`);
  log.info(`Manifest : ${log.paint(log.C.bwhite, path.relative(ROOT, manifestPath))}`);
  log.info(`Out root : ${log.paint(log.C.bwhite, "data/output-img")}`);
  log.info(`Poll     : ${log.paint(log.C.byellow, pollMs + "ms")}  (fallback)`);
  log.divider();

  const currentCount = countImages(outRoot);
  let manifest;
  try {
    manifest = flattenManifest(loadManifest(manifestPath));
    log.info(
      `Manifest: ${log.paint(log.C.bgreen, String(manifest.length))} entries` +
      `  done=${log.paint(log.C.byellow, String(currentCount))}` +
      `  left=${log.paint(log.C.bcyan, String(Math.max(0, manifest.length - currentCount)))}`
    );
  } catch (err) {
    log.error(err.message);
  }

  log.divider();
  log.info(`Waiting for images...  ${log.paint(log.C.gray, "(Ctrl+C to stop)")}`);
  process.stdout.write("\n"); // reserve spinner line

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
      // Erase spinner line before printing file info
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
        process.stdout.write("\n"); // re-reserve spinner line
      }
    }, 300);
  }

  // Idle status spinner — rewrites same line
  let spinTick = 0;
  setInterval(() => {
    if (processing.size > 0) return;
    spinTick++;
    const cnt = countImages(outRoot);
    process.stdout.write(
      log.CURSOR.eraseLine + log.CURSOR.col0 +
      `  ${log.spinnerFrame()} ` +
      `${log.paint(log.C.gray, "waiting")}` +
      `  out=${log.paint(log.C.bgreen, String(cnt).padStart(3))}` +
      `  done=${log.paint(log.C.bcyan, String(fileCount).padStart(3))}`
    );
  }, 300);

  try {
    fs.watch(tempDir, { persistent: true }, (eventType, filename) => {
      if (eventType === "rename") handleFile(filename);
    });
    log.info(
      `Using ${log.paint(log.C.bgreen, "fs.watch")} ` +
      log.paint(log.C.gray, "(instant detection)")
    );
  } catch (err) {
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
