"use strict";
/**
 * src/player/mouse.js
 * Replays mouse actions using @nut-tree-fork/nut-js.
 * Copied from the original macro-recorder — no changes needed.
 */

const { mouse, Button } = require("@nut-tree-fork/nut-js");
const log = require("../logger");

mouse.config.autoDelayMs = 0;

const DEFAULT_HOLD_MS = 60;

const BUTTON_MAP = {
  left:   Button.LEFT,
  right:  Button.RIGHT,
  middle: Button.MIDDLE,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

class MousePlayer {
  constructor({ scaleX = 1, scaleY = 1 } = {}) {
    this.scaleX = scaleX;
    this.scaleY = scaleY;
  }

  async autoScale(recordedW, recordedH) {
    const { screen } = require("@nut-tree-fork/nut-js");
    const curW = await screen.width();
    const curH = await screen.height();
    this.scaleX = curW / recordedW;
    this.scaleY = curH / recordedH;
    log.info(
      `Scale  ${recordedW}×${recordedH} → ${curW}×${curH}` +
      `  scaleX=${this.scaleX.toFixed(4)}  scaleY=${this.scaleY.toFixed(4)}`
    );
  }

  _tx(x) { return Math.round(x * this.scaleX); }
  _ty(y) { return Math.round(y * this.scaleY); }

  async _holdClick(btn, holdMs) {
    await mouse.pressButton(btn);
    await sleep(holdMs);
    await mouse.releaseButton(btn);
  }

  async execute(act) {
    const holdMs = (typeof act.holdMs === "number") ? act.holdMs : DEFAULT_HOLD_MS;

    switch (act.action) {
      case "move": {
        await mouse.setPosition({ x: this._tx(act.x), y: this._ty(act.y) });
        break;
      }
      case "click": {
        const btn = BUTTON_MAP[act.button] ?? Button.LEFT;
        await mouse.setPosition({ x: this._tx(act.x), y: this._ty(act.y) });
        await this._holdClick(btn, holdMs);
        break;
      }
      case "doubleClick": {
        const btn = BUTTON_MAP[act.button] ?? Button.LEFT;
        await mouse.setPosition({ x: this._tx(act.x), y: this._ty(act.y) });
        await this._holdClick(btn, holdMs);
        await sleep(60);
        await this._holdClick(btn, holdMs);
        break;
      }
      case "scroll": {
        const { ScrollDirection, scrollMouse } = require("@nut-tree-fork/nut-js");
        const dir = (act.amount ?? 3) >= 0 ? ScrollDirection.UP : ScrollDirection.DOWN;
        await scrollMouse(Math.abs(act.amount ?? 3), dir);
        break;
      }
      default:
        log.warn(`MousePlayer: unknown action "${act.action}"`);
    }
  }
}

module.exports = MousePlayer;
