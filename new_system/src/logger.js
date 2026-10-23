"use strict";
/**
 * src/logger.js
 *
 * Dual-mode logger — works in both plain Node CLI and Electron main process.
 *
 * In Electron, call logger.setWindow(mainWindow) once the BrowserWindow is
 * ready. Every log call will then also emit an IPC event so the renderer can
 * display it in the live log pane.
 *
 * IPC channel:  "log"
 * Payload:      { level, msg, ts }
 */

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const C = {
  reset:    "\x1b[0m",
  bold:     "\x1b[1m",
  dim:      "\x1b[2m",
  red:      "\x1b[31m",
  green:    "\x1b[32m",
  yellow:   "\x1b[33m",
  blue:     "\x1b[34m",
  magenta:  "\x1b[35m",
  cyan:     "\x1b[36m",
  white:    "\x1b[37m",
  gray:     "\x1b[90m",
  bred:     "\x1b[91m",
  bgreen:   "\x1b[92m",
  byellow:  "\x1b[93m",
  bblue:    "\x1b[94m",
  bmagenta: "\x1b[95m",
  bcyan:    "\x1b[96m",
  bwhite:   "\x1b[97m",
};

const paint = (color, text) => `${color}${text}${C.reset}`;

function ts() {
  const d  = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return paint(C.gray, `${hh}:${mm}:${ss}.${ms}`);
}

function tsRaw() {
  const d  = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}.${String(d.getMilliseconds()).padStart(3,"0")}`;
}

// Progress bar
function progressBar(done, total, width = 16) {
  if (total === 0) return paint(C.gray, "[" + "─".repeat(width) + "]");
  const pct    = done / total;
  const filled = Math.round(pct * width);
  const empty  = width - filled;
  const bar    = paint(C.bgreen, "█".repeat(filled)) + paint(C.gray, "░".repeat(empty));
  const label  = paint(C.bwhite, `${String(done).padStart(String(total).length)}/${total}`);
  const pctStr = paint(C.byellow, `${String(Math.round(pct * 100)).padStart(3)}%`);
  return `[${bar}] ${label} ${pctStr}`;
}

// Spinner
const SPINNER_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
let _spinnerIdx = 0;
function spinnerFrame() {
  return paint(C.bcyan, SPINNER_FRAMES[_spinnerIdx++ % SPINNER_FRAMES.length]);
}

// ANSI cursor helpers
const CURSOR = {
  up:        (n = 1) => `\x1b[${n}A`,
  eraseLine: "\x1b[2K",
  col0:      "\r",
};

function clearLine() {
  process.stdout.write(CURSOR.eraseLine + CURSOR.col0);
}

// Live countdown (overwrites same line)
async function liveCountdown(totalMs, label = "Waiting", tickMs = 50) {
  if (totalMs <= 0) return;
  const start = Date.now();
  process.stdout.write("\n");
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      const elapsed   = Date.now() - start;
      const remaining = Math.max(0, totalMs - elapsed);
      const pct       = Math.min(1, elapsed / totalMs);
      const barW      = 24;
      const filled    = Math.round(pct * barW);
      const bar       = paint(C.bblue, "▓".repeat(filled)) + paint(C.gray, "░".repeat(barW - filled));
      const remSec    = (remaining / 1000).toFixed(2);
      process.stdout.write(
        CURSOR.eraseLine + CURSOR.col0 +
        `  ${paint(C.cyan, "⏱")} ${paint(C.bwhite, label.padEnd(16))}` +
        ` [${bar}] ${paint(C.byellow + C.bold, remSec.padStart(6))}s`
      );
      if (remaining <= 0) {
        clearInterval(iv);
        process.stdout.write(CURSOR.eraseLine + CURSOR.col0);
        resolve();
      }
    }, tickMs);
  });
}

function divider(label = "") {
  if (!label) {
    console.log(paint(C.gray, "─".repeat(54)));
    return;
  }
  const side = Math.max(0, Math.floor((50 - label.length) / 2));
  const line = paint(C.gray, "─".repeat(side)) +
               paint(C.dim + C.white, ` ${label} `) +
               paint(C.gray, "─".repeat(side));
  console.log(line);
}

// ─── IPC bridge ──────────────────────────────────────────────────────────────
let _win = null;

function setWindow(win) {
  _win = win;
}

function _ipc(level, msg) {
  if (_win && !_win.isDestroyed()) {
    try {
      _win.webContents.send("log", { level, msg, ts: tsRaw() });
    } catch (_) { /* window may be closing */ }
  }
}

// ─── Exported log object ─────────────────────────────────────────────────────
const log = {
  setWindow,

  info(msg) {
    const line = `  ${paint(C.bblue, "ℹ")} ${ts()} ${paint(C.bwhite, msg)}`;
    console.log(line);
    _ipc("info", msg);
  },

  ok(msg) {
    const line = `  ${paint(C.bgreen, "✓")} ${ts()} ${paint(C.bgreen, msg)}`;
    console.log(line);
    _ipc("ok", msg);
  },

  warn(msg) {
    const line = `  ${paint(C.byellow, "⚠")} ${ts()} ${paint(C.byellow, msg)}`;
    console.log(line);
    _ipc("warn", msg);
  },

  error(msg) {
    const line = `  ${paint(C.bred, "✗")} ${ts()} ${paint(C.bred, msg)}`;
    console.log(line);
    _ipc("error", msg);
  },

  divider,
  liveCountdown,
  progressBar,
  spinnerFrame,
  clearLine,
  CURSOR,
  C,
  paint,
  ts,
  tsRaw,
};

module.exports = log;
