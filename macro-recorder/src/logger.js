"use strict";
/**
 * src/logger.js
 * Centralised terminal output — colours, progress bars, live countdowns,
 * spinners and section banners used across all modules.
 *
 * No external deps — pure ANSI escape codes + process.stdout.
 */

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  // foreground
  black:   "\x1b[30m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  white:   "\x1b[37m",
  gray:    "\x1b[90m",
  // bright foreground
  bred:    "\x1b[91m",
  bgreen:  "\x1b[92m",
  byellow: "\x1b[93m",
  bblue:   "\x1b[94m",
  bmagenta:"\x1b[95m",
  bcyan:   "\x1b[96m",
  bwhite:  "\x1b[97m",
  // background
  bgRed:   "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgBlue:  "\x1b[44m",
  bgGray:  "\x1b[100m",
};

const paint = (color, text) => `${color}${text}${C.reset}`;

// ─── Timestamp ───────────────────────────────────────────────────────────────
function ts() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return paint(C.gray, `${hh}:${mm}:${ss}.${ms}`);
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
function progressBar(done, total, width = 16) {
  if (total === 0) return paint(C.gray, "[" + "─".repeat(width) + "]");
  const pct   = done / total;
  const filled = Math.round(pct * width);
  const empty  = width - filled;
  const bar    = paint(C.bgreen, "█".repeat(filled)) + paint(C.gray, "░".repeat(empty));
  const label  = paint(C.bwhite, `${String(done).padStart(String(total).length)}/${total}`);
  const pctStr = paint(C.byellow, `${String(Math.round(pct * 100)).padStart(3)}%`);
  return `[${bar}] ${label} ${pctStr}`;
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
const SPINNER_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
let _spinnerIdx = 0;
function spinnerFrame() {
  return paint(C.bcyan, SPINNER_FRAMES[_spinnerIdx++ % SPINNER_FRAMES.length]);
}

// ─── Section banner ──────────────────────────────────────────────────────────
function banner(title, sub = "") {
  const W = 52;
  const line = "═".repeat(W);
  const pad  = (s) => {
    const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
    const total   = W - visible.length;
    const l = Math.floor(total / 2);
    const r = total - l;
    return " ".repeat(l) + s + " ".repeat(r);
  };
  const titleLine = pad(paint(C.bold + C.bwhite, title));
  console.log(paint(C.bcyan, `╔${line}╗`));
  console.log(paint(C.bcyan, `║`) + titleLine + paint(C.bcyan, `║`));
  if (sub) {
    const subLine = pad(paint(C.gray, sub));
    console.log(paint(C.bcyan, `║`) + subLine + paint(C.bcyan, `║`));
  }
  console.log(paint(C.bcyan, `╚${line}╝`));
}

// ─── Divider ─────────────────────────────────────────────────────────────────
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

// ─── ANSI cursor helpers ──────────────────────────────────────────────────────
const CURSOR = {
  up:        (n = 1) => `\x1b[${n}A`,   // move cursor up N lines
  eraseLine: "\x1b[2K",                  // erase entire current line
  col0:      "\r",                       // move to column 0
};

/** Erase the current line and move cursor to column 0, ready to rewrite. */
function clearLine() {
  process.stdout.write(CURSOR.eraseLine + CURSOR.col0);
}

/** Erase N lines above (including current). Useful after multi-line output. */
function clearLines(n) {
  for (let i = 0; i < n; i++) {
    process.stdout.write(CURSOR.eraseLine + CURSOR.col0);
    if (i < n - 1) process.stdout.write(CURSOR.up());
  }
}

// ─── Live countdown (overwrites same line) ───────────────────────────────────
/**
 * Prints ONE line and keeps rewriting it in-place every tickMs.
 * When done, erases that line completely — no residue in the scroll buffer.
 *
 * @param {number} totalMs
 * @param {string} label
 * @param {number} [tickMs]
 */
async function liveCountdown(totalMs, label = "Waiting", tickMs = 50) {
  if (totalMs <= 0) return;
  const start = Date.now();

  // Print a blank placeholder line so subsequent \r rewrites land here
  process.stdout.write("\n");

  return new Promise((resolve) => {
    const iv = setInterval(() => {
      const elapsed   = Date.now() - start;
      const remaining = Math.max(0, totalMs - elapsed);
      const pct       = Math.min(1, elapsed / totalMs);
      const barW      = 24;
      const filled    = Math.round(pct * barW);
      const bar       = paint(C.bblue, "▓".repeat(filled)) +
                        paint(C.gray,  "░".repeat(barW - filled));
      const remSec    = (remaining / 1000).toFixed(2);

      // Erase current line, rewrite in place
      process.stdout.write(
        CURSOR.eraseLine + CURSOR.col0 +
        `  ${paint(C.cyan, "⏱")} ${paint(C.bwhite, label.padEnd(16))}` +
        ` [${bar}] ${paint(C.byellow + C.bold, remSec.padStart(6))}s`
      );

      if (remaining <= 0) {
        clearInterval(iv);
        // Erase the countdown line entirely — clean slate for next log line
        process.stdout.write(CURSOR.eraseLine + CURSOR.col0);
        resolve();
      }
    }, tickMs);
  });
}

// ─── Live countdown for pre-start (counts down 3..2..1) ─────────────────────
async function startCountdown(seconds = 3, label = "Starting") {
  process.stdout.write("\n"); // reserve one line
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(
      CURSOR.eraseLine + CURSOR.col0 +
      `  ${paint(C.bcyan, "▶")} ${paint(C.bwhite, label)} in ` +
      `${paint(C.byellow + C.bold, String(i))}...`
    );
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Erase the countdown line entirely
  process.stdout.write(CURSOR.eraseLine + CURSOR.col0);
}

// ─── Action log line helpers ─────────────────────────────────────────────────
const ICONS = {
  mouse:    paint(C.bcyan,    "🖱 "),
  keyboard: paint(C.bmagenta, "⌨ "),
  wait:     paint(C.byellow,  "⏳"),
  error:    paint(C.bred,     "✗ "),
  warn:     paint(C.byellow,  "⚠ "),
  ok:       paint(C.bgreen,   "✓ "),
  info:     paint(C.bblue,    "ℹ "),
  record:   paint(C.bred,     "⏺ "),
  save:     paint(C.bgreen,   "💾"),
  state:    paint(C.bmagenta, "◆ "),
  trigger:  paint(C.byellow,  "⚡"),
  scale:    paint(C.bcyan,    "⇔ "),
  file:     paint(C.bblue,    "📄"),
};

function actionTag(idx, total) {
  const w = String(total).length;
  return paint(C.gray, "[") +
         paint(C.bwhite, String(idx).padStart(w)) +
         paint(C.gray, "/") +
         paint(C.gray, String(total)) +
         paint(C.gray, "]");
}

function delayBadge(ms) {
  if (!ms || ms <= 0) return "";
  const sec = (ms / 1000).toFixed(2);
  const col = ms > 2000 ? C.byellow : ms > 500 ? C.bwhite : C.gray;
  return paint(col, ` +${sec}s`);
}

// ─── Exported log functions ───────────────────────────────────────────────────
const log = {
  // Raw styled line
  raw(msg) { console.log(msg); },

  info(msg) {
    console.log(`  ${ICONS.info} ${ts()} ${paint(C.bwhite, msg)}`);
  },

  ok(msg) {
    console.log(`  ${ICONS.ok} ${ts()} ${paint(C.bgreen, msg)}`);
  },

  warn(msg) {
    console.log(`  ${ICONS.warn} ${ts()} ${paint(C.byellow, msg)}`);
  },

  error(msg) {
    console.log(`  ${ICONS.error} ${ts()} ${paint(C.bred, msg)}`);
  },

  // ── Player action line
  playerAction(idx, total, type, details, delayMs) {
    const tag   = actionTag(idx, total);
    const icon  = ICONS[type] || ICONS.info;
    const badge = delayBadge(delayMs);
    const bar   = progressBar(idx, total, 16);
    // Single line: [idx/total] icon  timestamp  details  +delay  ▓▓░░ n/total pct%
    process.stdout.write(
      `  ${tag} ${icon} ${ts()} ${paint(C.bwhite, details)}${badge}  ${bar}\n`
    );
  },

  // ── Recorder capture line
  recorded(type, details) {
    console.log(`  ${ICONS[type] || ICONS.record} ${ts()} ${paint(C.bwhite, details)}`);
  },

  // ── State machine state transition
  stateTransition(from, to) {
    const arrow = paint(C.gray, " → ");
    console.log(
      `\n  ${ICONS.state} ${ts()} ` +
      paint(C.magenta, from || "—") +
      arrow +
      paint(C.bmagenta + C.bold, to)
    );
  },

  // ── Watcher trigger
  watcherTick(imgCount, counter, triggered) {
    const diff = imgCount - counter;
    if (triggered) {
      console.log(
        `\n  ${ICONS.trigger} ${ts()} ` +
        paint(C.byellow + C.bold, `NEW IMAGE DETECTED`) +
        `  images=${paint(C.bgreen, String(imgCount))}` +
        `  counter=${paint(C.gray, String(counter))}` +
        `  delta=${paint(C.bgreen, "+" + diff)}`
      );
    }
  },

  // ── Scale info
  scaleInfo(rw, rh, cw, ch, sx, sy) {
    console.log(
      `  ${ICONS.scale} ${ts()} ` +
      paint(C.cyan, `${rw}×${rh}`) +
      paint(C.gray, " → ") +
      paint(C.bwhite, `${cw}×${ch}`) +
      `  scaleX=${paint(C.byellow, sx.toFixed(4))}` +
      `  scaleY=${paint(C.byellow, sy.toFixed(4))}`
    );
  },

  // ── Section banners + helpers re-exported
  banner,
  divider,
  liveCountdown,
  startCountdown,
  progressBar,
  spinnerFrame,
  clearLine,
  clearLines,
  CURSOR,

  // Colours re-exported for inline use
  C,
  paint,
  ts,
};

module.exports = log;
