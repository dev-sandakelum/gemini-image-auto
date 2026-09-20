"use strict";
/**
 * player/keyboard.js
 * Replays keyboard actions using @nut-tree-fork/nut-js.
 */

const { keyboard, Key } = require("@nut-tree-fork/nut-js");
const log = require("../logger");

keyboard.config.autoDelayMs = 0;

const KEY_MAP = {
  enter:     Key.Return,
  return:    Key.Return,
  escape:    Key.Escape,
  tab:       Key.Tab,
  backspace: Key.Backspace,
  delete:    Key.Delete,
  space:     Key.Space,
  up:        Key.Up,
  down:      Key.Down,
  left:      Key.Left,
  right:     Key.Right,
  home:      Key.Home,
  end:       Key.End,
  pageup:    Key.PageUp,
  pagedown:  Key.PageDown,
  f1: Key.F1, f2: Key.F2, f3: Key.F3,  f4: Key.F4,
  f5: Key.F5, f6: Key.F6, f7: Key.F7,  f8: Key.F8,
  f9: Key.F9, f10: Key.F10, f11: Key.F11, f12: Key.F12,
  ctrl:  Key.LeftControl,
  shift: Key.LeftShift,
  alt:   Key.LeftAlt,
  win:   Key.LeftSuper,
};

function resolveKey(name) {
  const lower = name.toLowerCase();
  if (KEY_MAP[lower] !== undefined) return KEY_MAP[lower];
  if (/^[a-z]$/.test(lower)) return Key[lower.toUpperCase()];
  if (/^[0-9]$/.test(lower)) return Key[`Num${lower}`];
  log.warn(`KeyboardPlayer: unknown key "${name}"`);
  return null;
}

class KeyboardPlayer {
  async execute(act) {
    switch (act.action) {
      case "text":
        await keyboard.type(act.text);
        break;

      case "hotkey": {
        const keys = (act.keys || []).map(resolveKey).filter(Boolean);
        if (keys.length) await keyboard.pressKey(...keys);
        if (keys.length) await keyboard.releaseKey(...keys);
        break;
      }

      case "keydown":
        log.warn(`KeyboardPlayer: raw keydown skipped (${act.key})`);
        break;

      default:
        log.warn(`KeyboardPlayer: unknown action "${act.action}"`);
    }
  }
}

module.exports = KeyboardPlayer;
