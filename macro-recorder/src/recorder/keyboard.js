"use strict";
/**
 * recorder/keyboard.js
 * Buffers keyboard events emitted by recorder.js (which uses readline/raw-mode
 * for key capture). Handles individual keys, text runs, and common hotkeys.
 */

// Hotkey combos we recognise and store as a single action instead of raw keys.
const HOTKEYS = new Map([
  ["\x01", { keys: ["ctrl", "a"], label: "Ctrl+A" }],
  ["\x03", { keys: ["ctrl", "c"], label: "Ctrl+C" }],
  ["\x04", { keys: ["ctrl", "d"], label: "Ctrl+D" }],
  ["\x06", { keys: ["ctrl", "f"], label: "Ctrl+F" }],
  ["\x16", { keys: ["ctrl", "v"], label: "Ctrl+V" }],
  ["\x18", { keys: ["ctrl", "x"], label: "Ctrl+X" }],
  ["\x1a", { keys: ["ctrl", "z"], label: "Ctrl+Z" }],
  ["\x1b", { keys: ["escape"],   label: "Escape"  }],
  ["\r",   { keys: ["enter"],    label: "Enter"   }],
  ["\n",   { keys: ["enter"],    label: "Enter"   }],
  ["\t",   { keys: ["tab"],      label: "Tab"     }],
  ["\x7f", { keys: ["backspace"],label: "Backspace"}],
]);

class KeyboardRecorder {
  constructor() {
    this._events = [];
    this._textBuffer = "";
    this._lastTime = Date.now();
  }

  /**
   * Feed a raw key string (from process.stdin in raw mode).
   * Returns the constructed event (or null if it was absorbed into a text run).
   */
  feed(rawKey) {
    const now = Date.now();
    const delay = now - this._lastTime;
    this._lastTime = now;

    // Known hotkey / special key?
    if (HOTKEYS.has(rawKey)) {
      // Flush any pending text first
      const textEvent = this._flushText(delay);
      const hotkeyEvent = {
        type: "keyboard",
        action: "hotkey",
        keys: HOTKEYS.get(rawKey).keys,
        label: HOTKEYS.get(rawKey).label,
        delay: textEvent ? 0 : delay,
      };
      this._events.push(hotkeyEvent);
      return [textEvent, hotkeyEvent].filter(Boolean);
    }

    // Printable character → accumulate into text buffer
    if (rawKey.length === 1 && rawKey >= " ") {
      this._textBuffer += rawKey;
      return null; // not emitted yet
    }

    // Unknown control sequence → store as raw keydown
    const textEvent = this._flushText(delay);
    const rawEvent = {
      type: "keyboard",
      action: "keydown",
      key: rawKey.split("").map((c) => c.charCodeAt(0).toString(16)).join(" "),
      delay: textEvent ? 0 : delay,
    };
    this._events.push(rawEvent);
    return [textEvent, rawEvent].filter(Boolean);
  }

  /** Call when recording stops to flush any remaining text buffer. */
  finalFlush() {
    return this._flushText(0);
  }

  flush() {
    const copy = [...this._events];
    this._events = [];
    return copy;
  }

  _flushText(delay) {
    if (!this._textBuffer) return null;
    const event = {
      type: "keyboard",
      action: "text",
      text: this._textBuffer,
      delay,
    };
    this._textBuffer = "";
    this._events.push(event);
    return event;
  }
}

module.exports = KeyboardRecorder;
