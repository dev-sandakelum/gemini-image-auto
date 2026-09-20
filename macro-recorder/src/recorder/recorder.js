"use strict";
/**
 * recorder/recorder.js
 * Event-driven recorder using uiohook-napi for global mouse + keyboard hooks.
 *
 * Stop & save : F9
 * Abort       : Escape  |  Ctrl+C
 *
 * State: IDLE → RECORDING → SAVED
 */

const path = require("path");
const { uIOhook, UiohookKey } = require("uiohook-napi");
const KeyboardRecorder = require("./keyboard");
const FileManager      = require("../automation/fileManager");
const log              = require("../logger");

const STATES = { IDLE: "IDLE", RECORDING: "RECORDING", SAVED: "SAVED" };
const BUTTON_NAMES = { 1: "left", 2: "right", 3: "middle" };

class Recorder {
  constructor({
    macrosDir      = path.join(__dirname, "../../macros"),
    recordMovement = false,
    moveThreshold  = 5,
  } = {}) {
    this.macrosDir      = macrosDir;
    this.recordMovement = recordMovement;
    this.moveThreshold  = moveThreshold;

    this.state      = STATES.IDLE;
    this._keyboard  = new KeyboardRecorder();
    this._actions   = [];
    this._lastTime  = null;
    this._lastPos   = null;
    this._ctrlDown  = false;
    this._shiftDown = false;
    this._stopping  = false;

    // Live stats
    this._mouseCount    = 0;
    this._keyCount      = 0;
    this._scrollCount   = 0;
    this._recordStart   = null;
  }

  get isRecording() { return this.state === STATES.RECORDING; }

  // ── status line (overwrite in place) ───────────────────────────────────────
  _printStatus() {
    const elapsed = this._recordStart ? ((Date.now() - this._recordStart) / 1000).toFixed(1) : "0.0";
    const total   = this._actions.length;
    process.stdout.write(
      `\r  ${log.paint(log.C.bred + log.C.bold, "⏺ REC")}` +
      `  ${log.paint(log.C.gray, elapsed + "s")}` +
      `  actions=${log.paint(log.C.bwhite, String(total).padStart(4))}` +
      `  mouse=${log.paint(log.C.bcyan, String(this._mouseCount).padStart(3))}` +
      `  keys=${log.paint(log.C.bmagenta, String(this._keyCount).padStart(3))}` +
      `  scroll=${log.paint(log.C.byellow, String(this._scrollCount).padStart(2))}` +
      `   `
    );
  }

  // ── start ──────────────────────────────────────────────────────────────────
  start(name = "recording") {
    if (this.state !== STATES.IDLE) throw new Error("Already recording");

    this.state         = STATES.RECORDING;
    this._actions      = [];
    this._lastTime     = Date.now();
    this._lastPos      = null;
    this._stopping     = false;
    this._saveName     = name;
    this._mouseCount   = 0;
    this._keyCount     = 0;
    this._scrollCount  = 0;
    this._recordStart  = Date.now();

    // Live status ticker
    this._statusTimer = setInterval(() => this._printStatus(), 250);

    // ── Mouse move ──────────────────────────────────────────────────────────
    uIOhook.on("mousemove", (e) => {
      if (!this.isRecording || !this.recordMovement) return;
      if (this._lastPos) {
        const dx = Math.abs(e.x - this._lastPos.x);
        const dy = Math.abs(e.y - this._lastPos.y);
        if (dx < this.moveThreshold && dy < this.moveThreshold) return;
      }
      this._lastPos = { x: e.x, y: e.y };
      this._emit({ type: "mouse", action: "move", x: e.x, y: e.y });
      this._mouseCount++;
    });

    // ── Mouse click ─────────────────────────────────────────────────────────
    uIOhook.on("mousedown", (e) => {
      if (!this.isRecording) return;
      const btn = BUTTON_NAMES[e.button] ?? "left";
      this._emit({ type: "mouse", action: "click", button: btn, x: e.x, y: e.y });
      this._mouseCount++;
      process.stdout.write("\n");
      log.recorded("mouse",
        `click  ${log.paint(log.C.bmagenta, btn)}  ` +
        `(${log.paint(log.C.bcyan, String(e.x))}, ${log.paint(log.C.bcyan, String(e.y))})`
      );
    });

    // ── Scroll ──────────────────────────────────────────────────────────────
    uIOhook.on("wheel", (e) => {
      if (!this.isRecording) return;
      const amount = e.rotation < 0 ? -e.clicks : e.clicks;
      this._emit({ type: "mouse", action: "scroll", amount, x: e.x, y: e.y });
      this._scrollCount++;
      process.stdout.write("\n");
      log.recorded("mouse",
        `scroll  ${amount > 0
          ? log.paint(log.C.bgreen, "↑ " + Math.abs(amount))
          : log.paint(log.C.byellow, "↓ " + Math.abs(amount))}`
      );
    });

    // ── Key down ────────────────────────────────────────────────────────────
    uIOhook.on("keydown", (e) => {
      if (!this.isRecording) return;

      if (e.keycode === UiohookKey.Ctrl  || e.keycode === UiohookKey.CtrlRight)  { this._ctrlDown  = true; return; }
      if (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight) { this._shiftDown = true; return; }

      // F9 → stop & save
      if (e.keycode === UiohookKey.F9) {
        if (this._stopping) return;
        this._stopping = true;
        this.stop().then(() => {
          uIOhook.stop();
          process.exit(0);
        });
        return;
      }

      // Escape → abort
      if (e.keycode === UiohookKey.Escape) {
        clearInterval(this._statusTimer);
        process.stdout.write("\n");
        log.warn("Recording ABORTED — nothing saved.");
        uIOhook.stop();
        process.exit(0);
      }

      // Ctrl combos
      if (this._ctrlDown) {
        const raw = keyToChar(e, false);
        if (raw) {
          const code = raw.toLowerCase().charCodeAt(0) - 96;
          if (code > 0 && code < 27) {
            const events = this._keyboard.feed(String.fromCharCode(code));
            this._flushKeyEvents(events);
          }
        }
        return;
      }

      // Printable / special
      const char = keyToChar(e, this._shiftDown);
      if (char !== null) {
        const events = this._keyboard.feed(char);
        this._flushKeyEvents(events);
      }
    });

    // ── Key up ──────────────────────────────────────────────────────────────
    uIOhook.on("keyup", (e) => {
      if (e.keycode === UiohookKey.Ctrl  || e.keycode === UiohookKey.CtrlRight)  this._ctrlDown  = false;
      if (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight) this._shiftDown = false;
    });

    uIOhook.start();
  }

  // ── stop & save ────────────────────────────────────────────────────────────
  async stop(name) {
    if (this.state !== STATES.RECORDING) return null;
    this.state = STATES.SAVED;

    clearInterval(this._statusTimer);
    process.stdout.write("\n");
    log.divider("SAVING");

    const saveName = name || this._saveName || "recording";

    const last = this._keyboard.finalFlush();
    if (last) this._actions.push(last);

    let screenMeta = null;
    try {
      const { screen } = require("@nut-tree-fork/nut-js");
      screenMeta = { w: await screen.width(), h: await screen.height() };
      log.info(`Screen captured: ${log.paint(log.C.bwhite, screenMeta.w + "×" + screenMeta.h)}`);
    } catch (_) {
      log.warn("Could not detect screen resolution — macro saved without screen metadata");
    }

    const elapsed = ((Date.now() - this._recordStart) / 1000).toFixed(1);
    const macro = {
      name: saveName,
      version: 1,
      recordedAt: new Date().toISOString(),
      ...(screenMeta ? { screen: screenMeta } : {}),
      actions: this._actions,
    };

    const filename = `${Date.now()}-${saveName.replace(/\s+/g, "-").toLowerCase()}.json`;
    const filepath  = path.join(this.macrosDir, filename);
    await FileManager.ensureDir(this.macrosDir);
    await FileManager.writeJSON(filepath, macro);

    log.ok(`Saved  ${log.paint(log.C.bwhite + log.C.bold, String(this._actions.length))} actions  →  ${log.paint(log.C.bblue, filepath)}`);
    log.info(
      `Duration: ${log.paint(log.C.byellow, elapsed + "s")}  ` +
      `mouse=${log.paint(log.C.bcyan, String(this._mouseCount))}  ` +
      `keys=${log.paint(log.C.bmagenta, String(this._keyCount))}  ` +
      `scroll=${log.paint(log.C.byellow, String(this._scrollCount))}`
    );
    log.divider();

    return { filepath, macro };
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  _emit(partial) {
    const now   = Date.now();
    const delay = now - (this._lastTime ?? now);
    this._lastTime = now;
    this._actions.push({ ...partial, delay });
  }

  _flushKeyEvents(events) {
    if (!events) return;
    [].concat(events).filter(Boolean).forEach((ev) => {
      this._actions.push(ev);
      this._keyCount++;
      if (ev.action === "text") {
        process.stdout.write("\n");
        log.recorded("keyboard", `type  ${log.paint(log.C.bgreen, `"${ev.text}"`)}`);
      }
      if (ev.action === "hotkey") {
        process.stdout.write("\n");
        log.recorded("keyboard", `hotkey  ${log.paint(log.C.byellow, ev.label)}`);
      }
    });
  }
}

// ── Key map ─────────────────────────────────────────────────────────────────
const SPECIAL_MAP = {
  [UiohookKey.Enter]:     "\r",
  [UiohookKey.Backspace]: "\x7f",
  [UiohookKey.Tab]:       "\t",
  [UiohookKey.Space]:     " ",
};

const SHIFT_SYMBOLS = {
  "`":"~", "1":"!", "2":"@", "3":"#", "4":"$", "5":"%",
  "6":"^", "7":"&", "8":"*", "9":"(", "0":")",
  "-":"_", "=":"+", "[":"{", "]":"}", "\\":"|",
  ";":":", "'":"\"", ",":"<", ".":">", "/":"?",
};

function keyToChar(e, shift) {
  if (SPECIAL_MAP[e.keycode] !== undefined) return SPECIAL_MAP[e.keycode];
  if (e.keychar && e.keychar !== 0 && e.keychar !== 65535) {
    const ch = String.fromCharCode(e.keychar);
    if (ch >= " " && ch < "\x7f") {
      if (shift && ch >= "a" && ch <= "z") return ch.toUpperCase();
      if (shift && SHIFT_SYMBOLS[ch])      return SHIFT_SYMBOLS[ch];
      return ch;
    }
  }
  return null;
}

module.exports = Recorder;
