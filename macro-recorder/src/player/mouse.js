"use strict";
/**
 * player/mouse.js
 * Replays mouse actions using @nut-tree-fork/nut-js.
 *
 * Uses mouse.setPosition() for exact, instant positioning (no animation drift).
 *
 * DPI / resolution scaling:
 *   If the macro was recorded at a different resolution than the current screen,
 *   pass { scaleX, scaleY } to the constructor or call autoScale(recordedW, recordedH).
 *   e.g. recorded at 1920x1080, playing on 1536x864 → scaleX = 1536/1920 = 0.8
 *
 * Click hold:
 *   If an action has a "holdMs" field, the button is held down for that many
 *   milliseconds before releasing — guarantees the target app registers the click.
 *   Default holdMs = 60ms (enough for any UI framework).
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
    log.scaleInfo(recordedW, recordedH, curW, curH, this.scaleX, this.scaleY);
  }

  _tx(x) { return Math.round(x * this.scaleX); }
  _ty(y) { return Math.round(y * this.scaleY); }

  /**
   * Press and hold a button for holdMs, then release.
   * More reliable than mouse.click() which may send too-fast events.
   */
  async _holdClick(btn, holdMs) {
    await mouse.pressButton(btn);
    await sleep(holdMs);
    await mouse.releaseButton(btn);
  }

  async execute(act) {
    const holdMs = (typeof act.holdMs === "number") ? act.holdMs : DEFAULT_HOLD_MS;

    switch (act.action) {

      case "move": {
        const x = this._tx(act.x), y = this._ty(act.y);
        await mouse.setPosition({ x, y });
        break;
      }

      case "click": {
        const btn = BUTTON_MAP[act.button] ?? Button.LEFT;
        const x = this._tx(act.x), y = this._ty(act.y);
        await mouse.setPosition({ x, y });
        await this._holdClick(btn, holdMs);
        break;
      }

      case "doubleClick": {
        const btn = BUTTON_MAP[act.button] ?? Button.LEFT;
        const x = this._tx(act.x), y = this._ty(act.y);
        await mouse.setPosition({ x, y });
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
        log.warn(`MousePlayer: unknown mouse action "${act.action}"`);
    }
  }
}

module.exports = MousePlayer;
