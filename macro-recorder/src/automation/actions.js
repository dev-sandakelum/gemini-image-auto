"use strict";
/**
 * automation/actions.js
 * Built-in action handlers for the state machine.
 */

const { mouse, keyboard, straightTo, Point, Button, Key } = require("@nut-tree-fork/nut-js");
const FileManager = require("./fileManager");
const log         = require("../logger");

mouse.config.autoDelayMs    = 0;
keyboard.config.autoDelayMs = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

const handlers = {

  // ── File actions ──────────────────────────────────────────────────────────
  async readFile(ctx, def) {
    const fm = new FileManager(def.path);
    await fm.load();
    ctx.data.file    = fm;
    ctx.data.lines   = fm._lines.slice();
    ctx.data.pointer = 0;
    log.info(
      `${log.paint(log.C.bblue, "📄")} readFile  ` +
      `${log.paint(log.C.bwhite, def.path)}  ` +
      `lines=${log.paint(log.C.bgreen, String(fm.lineCount))}`
    );
  },

  async readNextLine(ctx) {
    const fm = ctx.data.file;
    if (!fm) throw new Error("No file loaded. Add a readFile state first.");
    ctx.data.currentLine = fm.nextLine();
    const ptr = fm.pointer;
    const tot = fm.lineCount;
    log.info(
      `readNextLine  [${log.paint(log.C.bwhite, String(ptr))}/${tot}]  ` +
      `"${log.paint(log.C.bgreen, ctx.data.currentLine ?? "(end)")}"`
    );
  },

  async writeFile(ctx, def) {
    const text = def.text ?? ctx.data.output ?? "";
    await FileManager.writeText(def.path, text);
    log.info(`writeFile  ${log.paint(log.C.bblue, def.path)}`);
  },

  async appendFile(ctx, def) {
    const text = def.text ?? ctx.data.currentLine ?? "";
    await FileManager.appendText(def.path, text + "\n");
    log.info(`appendFile  ${log.paint(log.C.bblue, def.path)}  "${log.paint(log.C.gray, text)}"`);
  },

  // ── Mouse actions ─────────────────────────────────────────────────────────
  async click(ctx, def) {
    const x   = def.x ?? ctx.data.x ?? 0;
    const y   = def.y ?? ctx.data.y ?? 0;
    const btn = def.button === "right"  ? Button.RIGHT
              : def.button === "middle" ? Button.MIDDLE
              : Button.LEFT;
    await mouse.move(straightTo(new Point(x, y)));
    await mouse.click(btn);
    log.info(
      `${log.paint(log.C.bcyan, "🖱")} click  ${log.paint(log.C.bmagenta, def.button || "left")}  ` +
      `(${log.paint(log.C.bcyan, String(x))}, ${log.paint(log.C.bcyan, String(y))})`
    );
  },

  async doubleClick(ctx, def) {
    const x = def.x ?? ctx.data.x ?? 0;
    const y = def.y ?? ctx.data.y ?? 0;
    await mouse.move(straightTo(new Point(x, y)));
    await mouse.doubleClick(Button.LEFT);
    log.info(
      `${log.paint(log.C.bcyan, "🖱")} doubleClick  ` +
      `(${log.paint(log.C.bcyan, String(x))}, ${log.paint(log.C.bcyan, String(y))})`
    );
  },

  async moveMouse(ctx, def) {
    await mouse.move(straightTo(new Point(def.x, def.y)));
    log.info(`${log.paint(log.C.bcyan, "🖱")} moveMouse  (${def.x}, ${def.y})`);
  },

  async scroll(ctx, def) {
    const { ScrollDirection, scrollMouse } = require("@nut-tree-fork/nut-js");
    const amount = def.amount ?? 3;
    const dir    = amount >= 0 ? ScrollDirection.UP : ScrollDirection.DOWN;
    await scrollMouse(Math.abs(amount), dir);
    log.info(
      `${log.paint(log.C.bcyan, "🖱")} scroll  ` +
      (amount >= 0
        ? log.paint(log.C.bgreen, "↑ " + Math.abs(amount))
        : log.paint(log.C.byellow, "↓ " + Math.abs(amount)))
    );
  },

  // ── Keyboard actions ──────────────────────────────────────────────────────
  async typeText(ctx, def) {
    const text = def.text === "$currentLine"
      ? (ctx.data.currentLine ?? "")
      : (def.text ?? "");
    await keyboard.type(text);
    log.info(`${log.paint(log.C.bmagenta, "⌨")} typeText  ${log.paint(log.C.bgreen, `"${text}"`)}`);
  },

  async pressKey(ctx, def) {
    const KEY_MAP = {
      enter: Key.Return, escape: Key.Escape, tab: Key.Tab,
      backspace: Key.Backspace, space: Key.Space,
    };
    const k = KEY_MAP[def.key?.toLowerCase()] ?? Key[def.key?.toUpperCase()] ?? null;
    if (!k) {
      log.warn(`pressKey: unknown key "${def.key}"`);
      return;
    }
    await keyboard.pressKey(k);
    await keyboard.releaseKey(k);
    log.info(`${log.paint(log.C.bmagenta, "⌨")} pressKey  ${log.paint(log.C.byellow, def.key)}`);
  },

  async hotkey(ctx, def) {
    const KEY_MAP = {
      ctrl: Key.LeftControl, shift: Key.LeftShift, alt: Key.LeftAlt,
      enter: Key.Return, escape: Key.Escape, tab: Key.Tab, backspace: Key.Backspace,
    };
    const keys = (def.keys || []).map((k) => {
      const lower = k.toLowerCase();
      if (KEY_MAP[lower]) return KEY_MAP[lower];
      if (/^[a-z]$/.test(lower)) return Key[lower.toUpperCase()];
      if (/^[0-9]$/.test(lower)) return Key[`Num${lower}`];
      return null;
    }).filter(Boolean);
    await keyboard.pressKey(...keys);
    await keyboard.releaseKey(...keys);
    log.info(
      `${log.paint(log.C.bmagenta, "⌨")} hotkey  ` +
      log.paint(log.C.byellow, def.keys?.join("+") || "")
    );
  },

  // ── Flow / timing ─────────────────────────────────────────────────────────
  async wait(ctx, def) {
    const ms = def.duration ?? 1000;
    await log.liveCountdown(ms, "Wait action");
  },

  async stop(ctx) {
    ctx._stop = true;
    log.info("stop action — halting state machine");
  },

  // ── Conditions ────────────────────────────────────────────────────────────
  checkFileHasNextLine(ctx) {
    return Boolean(ctx.data.file?.hasNextLine);
  },

  checkDataEquals(ctx, def) {
    return String(ctx.data[def.key]) === String(def.value);
  },
};

module.exports = handlers;
