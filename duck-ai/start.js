"use strict";
/**
 * duck-ai/start.js
 *
 * Starts both count-server and sorter in the same process.
 * Eliminates the need to open two terminals.
 *
 * Usage:
 *   node start.js
 *   node start.js --manifest ../new/images/images_part2.json
 *   node start.js --manifest ../new/images/images_part1.json --part 1
 *
 * Available image manifests:
 *   ../new/images/images_part1.json  (default)
 *   ../new/images/images_part2.json
 *   ../new/images/images_part3.json
 *   ../new/images/images_part4.json
 *   ../new/images/images_part5.json
 *   ../new/images/images_part6.json
 *   ../new/images/images_part7.json
 *
 * Shorthand: --part 3  is equivalent to  --manifest ../new/images/images_part3.json
 */

const { fork, spawn } = require("child_process");
const path = require("path");
const os   = require("os");
const fs   = require("fs");

// ── Arg parse ─────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return (i !== -1 && process.argv[i+1]) ? process.argv[i+1] : fallback;
}

const part = arg("part", null);
let   manifestPath;

if (arg("manifest", null)) {
  manifestPath = path.resolve(arg("manifest"));
} else if (part) {
  manifestPath = path.resolve(path.join(__dirname, "..", "new", "images", `images_part${part}.json`));
  if (!fs.existsSync(manifestPath)) {
    console.error(`\n  ✘ Manifest not found: ${manifestPath}`);
    console.error(`  Make sure the ../new/images/ folder was copied alongside duck-ai/\n`);
    process.exit(1);
  }
} else {
  // Auto-detect: find the first manifest that still has unfinished work
  const imgDir = path.resolve(path.join(__dirname, "img"));
  const IMG_EXTS = new Set([".jpg",".jpeg",".png",".gif",".webp",".bmp",".tiff",".tif"]);

  function countImages(dir) {
    let n = 0;
    if (!fs.existsSync(dir)) return n;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) n += countImages(path.join(dir, e.name));
      else if (e.isFile() && IMG_EXTS.has(path.extname(e.name).toLowerCase())) n++;
    }
    return n;
  }

  function loadManifest(f) {
    try {
      const raw = JSON.parse(fs.readFileSync(f, "utf8"));
      return Array.isArray(raw[0]?.images) ? raw.flatMap((p) => p.images) : raw;
    } catch { return []; }
  }

  const saved    = countImages(imgDir);
  let   running  = saved;   // images accounted for so far across parts
  manifestPath   = null;

  for (let n = 1; n <= 7; n++) {
    const f   = path.resolve(path.join(__dirname, "..", "new", "images", `images_part${n}.json`));
    if (!fs.existsSync(f)) continue;
    const len = loadManifest(f).length;
    if (running < len) {
      // This part still has unfinished images
      manifestPath = f;
      break;
    }
    running -= len;
  }

  if (!manifestPath) {
    console.log("✔  All images appear to be done across all parts.");
    manifestPath = path.resolve(path.join(__dirname, "..", "new", "images", "images_part1.json"));
  }
}

const queueDir = path.join(os.homedir(), "Downloads", "duck-ai-queue");
const outRoot  = path.resolve(path.join(__dirname, "img"));
const port     = arg("port", "7843");

console.log("\n  🦆 DUCK-AI  START");
console.log("  ─────────────────────────────────────");
console.log(`  manifest : ${path.relative(__dirname, manifestPath)}`);
console.log(`  queue    : ${queueDir}`);
console.log(`  img out  : ${path.relative(__dirname, outRoot)}`);
console.log(`  port     : ${port}`);
console.log("  ─────────────────────────────────────\n");

// ── Run count-server inline (same process, different module) ──────────────────
// Avoid spawning a child by just requiring and running it directly.
// We patch process.argv so count-server.js reads the right args.
const savedArgv = process.argv.slice();
process.argv = [
  process.argv[0], process.argv[1],
  "--port",   port,
  "--imgdir", outRoot,
];
require("./count-server.js");
process.argv = savedArgv;

// ── Run sorter inline ─────────────────────────────────────────────────────────
process.argv = [
  process.argv[0], process.argv[1],
  "--queue",    queueDir,
  "--manifest", manifestPath,
  "--outroot",  outRoot,
];
require("./sorter.js");
process.argv = savedArgv;
