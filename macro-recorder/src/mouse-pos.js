"use strict";
/**
 * src/mouse-pos.js
 *
 * Shows the live mouse cursor position in the terminal, updating every 200ms.
 * Uses uiohook-napi (already installed) to read OS mouse-move events directly
 * — no HTTP requests, no async polling.
 *
 * Usage:
 *   node src/mouse-pos.js
 *   node src/mouse-pos.js --interval 100   (custom display refresh in ms)
 *
 * Press Ctrl+C to stop.
 */

const { UiohookMouse, uIOhook } = require("uiohook-napi");

// ── arg parse ────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const iFlag    = args.indexOf("--interval");
const interval = iFlag !== -1 && args[iFlag + 1] ? parseInt(args[iFlag + 1], 10) : 200;

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  gray:    "\x1b[90m",
  cyan:    "\x1b[96m",
  yellow:  "\x1b[93m",
  green:   "\x1b[92m",
  magenta: "\x1b[95m",
};
const paint = (c, t) => `${c}${t}${C.reset}`;
const ERASE = "\x1b[2K\r";   // erase current line + carriage return

// ── state ─────────────────────────────────────────────────────────────────────
let curX = 0, curY = 0;
let lastPrintX = null, lastPrintY = null;

// ── banner ────────────────────────────────────────────────────────────────────
console.log(paint(C.cyan,  "╔══════════════════════════════════╗"));
console.log(paint(C.cyan,  "║") +
            paint(C.bold + C.yellow, "    🖱  Mouse Position Tracker    ") +
            paint(C.cyan, "║"));
console.log(paint(C.cyan,  "╚══════════════════════════════════╝"));
console.log(
  paint(C.gray, "  Refresh  : ") + paint(C.green,  interval + "ms") +
  paint(C.gray, "   |   Ctrl+C to stop")
);
process.stdout.write("\n");   // reserve the live-update line

// ── uiohook: track every mouse move event ─────────────────────────────────────
uIOhook.on("mousemove", (e) => {
  curX = e.x;
  curY = e.y;
});

uIOhook.start();

// ── display timer: rewrite ONE line every interval ms ────────────────────────
let tick = 0;

const timer = setInterval(() => {
  tick++;

  const moved   = (curX !== lastPrintX || curY !== lastPrintY);
  const xStr    = paint(C.cyan    + C.bold, String(curX).padStart(5));
  const yStr    = paint(C.magenta + C.bold, String(curY).padStart(5));
  const tickStr = paint(C.gray, "#" + String(tick).padStart(6));
  const flag    = moved ? paint(C.yellow, "  ◀ moved") : "";

  process.stdout.write(
    ERASE +
    "  " + tickStr +
    paint(C.gray, "   X:") + " " + xStr +
    paint(C.gray, "   Y:") + " " + yStr +
    flag
  );

  lastPrintX = curX;
  lastPrintY = curY;
}, interval);

// ── clean exit ────────────────────────────────────────────────────────────────
function stop() {
  clearInterval(timer);
  uIOhook.stop();
  process.stdout.write(ERASE);
  console.log(
    paint(C.gray, "\n  Stopped.  Last: ") +
    paint(C.cyan,    "X=" + curX) + "  " +
    paint(C.magenta, "Y=" + curY)
  );
  process.exit(0);
}

process.on("SIGINT",  stop);
process.on("SIGTERM", stop);
