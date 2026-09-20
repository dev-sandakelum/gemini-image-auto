"use strict";
/**
 * src/watcher.js
 *
 * Full automation flow on each trigger:
 *
 *   poll tick
 *     → count images in output-img/       (e.g. 3)
 *     → read count.txt                    (e.g. 2)
 *     → 3 > 2
 *         → write 3 to count.txt          (before anything runs)
 *         → run  1.add_prompt.json
 *         → run  2.download_image.json
 *         → check data/queue/ for images
 *             ┌─ image found ──────────────────────────────┐
 *             │  move queue image → data/temp/             │
 *             │  run 3.next.json                           │
 *             │  → wait for next poll tick (done)          │
 *             └────────────────────────────────────────────┘
 *             ┌─ no image ─────────────────────────────────┐
 *             │  loop:                                      │
 *             │    run 4.exit.json                          │
 *             │    run 5.wait.json                          │
 *             │    run 2.download_image.json                │
 *             │    check queue again … repeat until found  │
 *             └────────────────────────────────────────────┘
 *
 * Usage:
 *   node src/watcher.js [--scale 1920x1080] [--speed 1]
 *                       [--interval 1000]
 *                       [--imgdir data/output-img]
 *                       [--count data/count.txt]
 */

const path = require("path");
const fs   = require("fs");

const Player = require("./player/player");
const log    = require("./logger");

// ── paths ────────────────────────────────────────────────────────────────────
const ROOT       = path.join(__dirname, "..");
const MACROS     = path.join(ROOT, "macros", "auto");
const M1         = path.join(MACROS, "1.add_prompt.json");
const M2         = path.join(MACROS, "2.download_image.json");
const M3         = path.join(MACROS, "3.next.json");
const M4         = path.join(MACROS, "4.exit.json");
const M5         = path.join(MACROS, "5.wait.json");
const QUEUE_DIR  = path.join(ROOT, "data", "queue");
const TEMP_DIR   = path.join(ROOT, "data", "temp");
const COUNT_FILE = path.join(ROOT, "data", "count.txt");
const IMG_DIR    = path.join(ROOT, "data", "output-img");
const IMG_EXTS   = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".bmp", ".tiff", ".tif", ".svg",
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
function countImages(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return count;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countImages(full);
    else if (
      entry.isFile() &&
      IMG_EXTS.has(path.extname(entry.name).toLowerCase())
    )
      count++;
  }
  return count;
}

function readCounter(file) {
  try {
    const n = parseInt(fs.readFileSync(file, "utf8").trim(), 10);
    return isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

function writeCounter(file, n) {
  fs.writeFileSync(file, String(n) + "\n", "utf8");
}

/** Return the first image filename found in dir, or null. */
function firstImageIn(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    if (IMG_EXTS.has(path.extname(f).toLowerCase())) {
      try {
        if (fs.statSync(path.join(dir, f)).isFile()) return f;
      } catch { /* skip */ }
    }
  }
  return null;
}

/** Move a file cross-drive safely (rename → fallback copy+delete). */
function moveFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args      = parseArgs(process.argv);
  const countFile = args.count  ? path.resolve(args.count)  : COUNT_FILE;
  const imgDir    = args.imgdir ? path.resolve(args.imgdir) : IMG_DIR;
  const interval  = parseInt(args.interval || "1000", 10);
  const speed     = parseFloat(args.speed  || "1");

  let scaleX = null, scaleY = null, scale = null;
  if (args.scalex && args.scaley) {
    scaleX = parseFloat(args.scalex);
    scaleY = parseFloat(args.scaley);
  } else if (args.scale && args.scale !== true) {
    scale = args.scale;
  }

  // Ensure dirs exist
  for (const dir of [imgDir, QUEUE_DIR, TEMP_DIR, path.dirname(countFile)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(countFile)) {
    writeCounter(countFile, 0);
    log.info("Created count.txt  →  0");
  }

  // Validate all macro files present
  for (const [name, p] of [
    ["1.add_prompt",    M1],
    ["2.download_image", M2],
    ["3.next",          M3],
    ["4.exit",          M4],
    ["5.wait",          M5],
  ]) {
    if (!fs.existsSync(p)) {
      log.error(`Missing macro: ${name}  →  ${p}`);
      process.exit(1);
    }
  }

  const playerOpts = { speedMultiplier: speed, scaleX, scaleY, scale };

  /** Run a single macro file and log step label. */
  async function runMacro(macroPath, label) {
    log.divider(label);
    const player = new Player(playerOpts);
    await player.play(macroPath);
  }

  log.banner("AUTO WATCHER", "output-img → prompt → download → next");
  log.info(`Images  : ${log.paint(log.C.bwhite, path.relative(ROOT, imgDir))}`);
  log.info(`Queue   : ${log.paint(log.C.bwhite, "data/queue")}`);
  log.info(`Temp    : ${log.paint(log.C.bwhite, "data/temp")}`);
  log.info(`Counter : ${log.paint(log.C.bwhite, path.relative(ROOT, countFile))}`);
  log.info(
    `Interval: ${log.paint(log.C.byellow, interval + "ms")}` +
    `   Speed: ${log.paint(log.C.byellow, speed + "x")}`
  );
  if (scale)           log.info(`Scale   : ${log.paint(log.C.bcyan, scale)}`);
  if (scaleX !== null) log.info(
    `Scale   : x=${log.paint(log.C.bcyan, String(scaleX))}` +
    `  y=${log.paint(log.C.bcyan, String(scaleY))}`
  );
  log.divider();

  let imgCount = countImages(imgDir);
  let counter  = readCounter(countFile);
  log.info(
    `State  images=${log.paint(log.C.bgreen, String(imgCount))}` +
    `  counter=${log.paint(log.C.gray, String(counter))}`
  );
  log.info(`Watching... ${log.paint(log.C.gray, "(Ctrl+C to stop)")}`);
  log.divider();
  process.stdout.write("\n"); // reserve spinner line

  let running     = false;
  let idleStopped = false;
  let tickCount   = 0;

  // ── idle spinner ───────────────────────────────────────────────────────────
  setInterval(() => {
    if (running || idleStopped) return;
    imgCount = countImages(imgDir);
    counter  = readCounter(countFile);
    tickCount++;
    const hasImg = firstImageIn(QUEUE_DIR) ? "HAS IMG" : "empty";
    process.stdout.write(
      log.CURSOR.eraseLine + log.CURSOR.col0 +
      `  ${log.spinnerFrame()} ` +
      `${log.paint(log.C.gray, "#" + String(tickCount).padStart(5))}` +
      `  img=${log.paint(log.C.bgreen, String(imgCount).padStart(4))}` +
      `  cnt=${log.paint(log.C.gray,   String(counter).padStart(4))}` +
      `  q=${log.paint(log.C.gray, hasImg)}`
    );
  }, Math.min(interval, 200));

  // ── main tick ──────────────────────────────────────────────────────────────
  const tick = async () => {
    if (running) return;

    imgCount = countImages(imgDir);
    counter  = readCounter(countFile);

    if (imgCount <= counter) return; // nothing new

    running     = true;
    idleStopped = true;
    process.stdout.write(log.CURSOR.eraseLine + log.CURSOR.col0);

    log.watcherTick(imgCount, counter, true);

    // 1. Write count BEFORE running anything
    writeCounter(countFile, imgCount);
    log.info(
      `count.txt: ${log.paint(log.C.gray, String(counter))}` +
      ` → ${log.paint(log.C.bgreen, String(imgCount))}` +
      log.paint(log.C.gray, "  (before run)")
    );

    /** Delete all image files inside the queue folder. */
    function clearQueue() {
      if (!fs.existsSync(QUEUE_DIR)) return;
      let removed = 0;
      for (const f of fs.readdirSync(QUEUE_DIR)) {
        if (IMG_EXTS.has(path.extname(f).toLowerCase())) {
          try {
            fs.unlinkSync(path.join(QUEUE_DIR, f));
            removed++;
          } catch (e) {
            log.warn(`Cannot delete queue/${f}  (${e.message})`);
          }
        }
      }
      if (removed > 0)
        log.info(`Queue cleared — ${log.paint(log.C.byellow, String(removed))} file(s) removed`);
      else
        log.info("Queue already empty");
    }

    try {
      // ── Clean queue BEFORE add_prompt ──────────────────────────────────
      log.divider("CLEAN QUEUE");
      clearQueue();

      // ── Step 1: add prompt ─────────────────────────────────────────────
      await runMacro(M1, "STEP 1 · add_prompt");

      // ── Step 2: download image ─────────────────────────────────────────
      await runMacro(M2, "STEP 2 · download_image");

      // ── Step 3: check queue, retry loop if empty ───────────────────────
      const QUEUE_POLL_INTERVAL = 1000;  // check every 1s
      const QUEUE_POLL_TIMEOUT  = 3000;  // give up after 3s

      let attempt = 0;
      while (true) {

        // ── Poll-with-retry: wait for an image to appear in queue/ ────────
        let queueFile  = null;
        const pollStart = Date.now();
        let   pollTick  = 0;

        log.divider("QUEUE POLL");
        log.info(
          `Waiting for queue image` +
          `  (every ${QUEUE_POLL_INTERVAL / 1000}s` +
          `  timeout ${QUEUE_POLL_TIMEOUT / 1000}s)`
        );
        process.stdout.write("\n"); // reserve poll status line

        while (Date.now() - pollStart < QUEUE_POLL_TIMEOUT) {
          queueFile = firstImageIn(QUEUE_DIR);
          if (queueFile) break;

          pollTick++;
          const elapsed   = ((Date.now() - pollStart) / 1000).toFixed(1);
          const remaining = (
            (QUEUE_POLL_TIMEOUT - (Date.now() - pollStart)) / 1000
          ).toFixed(1);
          const pct    = Math.min(1, (Date.now() - pollStart) / QUEUE_POLL_TIMEOUT);
          const barW   = 14;
          const filled = Math.round(pct * barW);
          const bar    =
            log.paint(log.C.bblue, "▓".repeat(filled)) +
            log.paint(log.C.gray,  "░".repeat(barW - filled));
          process.stdout.write(
            log.CURSOR.eraseLine + log.CURSOR.col0 +
            `  ${log.spinnerFrame()} ` +
            `${log.paint(log.C.gray, "#" + String(pollTick).padStart(3))}` +
            `  [${bar}]` +
            `  ${log.paint(log.C.byellow, remaining)}s` +
            `  ${log.paint(log.C.gray, elapsed + "s elapsed")}`
          );
          await new Promise((r) => setTimeout(r, QUEUE_POLL_INTERVAL));
        }

        // erase poll line
        process.stdout.write(log.CURSOR.eraseLine + log.CURSOR.col0);

        if (queueFile) {
          // ── Image found in queue ─────────────────────────────────────
          const src  = path.join(QUEUE_DIR, queueFile);
          const dest = path.join(TEMP_DIR,  queueFile);
          log.ok(`Queue: ${log.paint(log.C.bwhite, queueFile)} → temp/`);
          moveFile(src, dest);
          log.ok(`Moved → ${log.paint(log.C.bblue, "data/temp/" + queueFile)}`);

          await runMacro(M3, "STEP 3 · next");
          break; // done — wait for next poll trigger

        } else {
          // ── Timed out — run retry loop ───────────────────────────────
          attempt++;
          log.warn(
            `Queue empty after ${QUEUE_POLL_TIMEOUT / 1000}s` +
            `  (attempt ${attempt}) — retry`
          );

          await runMacro(M4, `RETRY ${attempt} · exit`);
          await runMacro(M5, `RETRY ${attempt} · wait`);
          await runMacro(M2, `RETRY ${attempt} · download`);
        }
      }

      log.ok(
        `Cycle done  count.txt=` +
        log.paint(log.C.bgreen, String(imgCount))
      );
      log.divider("CYCLE DONE");

    } catch (err) {
      log.error(`Cycle error: ${err.message}`);
      log.divider("CYCLE FAILED");
    } finally {
      running     = false;
      idleStopped = false;
      log.info(`Watching... ${log.paint(log.C.gray, "(Ctrl+C to stop)")}`);
      process.stdout.write("\n"); // re-reserve spinner line
    }
  };

  await tick();
  setInterval(tick, interval);
}

main().catch((err) => {
  log.error(`[Fatal] ${err.message}`);
  process.exit(1);
});
