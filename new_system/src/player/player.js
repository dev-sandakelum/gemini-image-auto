"use strict";
/**
 * src/player/player.js
 * Loads a recorded macro JSON and replays every action.
 * Adapted from the original macro-recorder player — API unchanged.
 */

const path           = require("path");
const fs             = require("fs");
const MousePlayer    = require("./mouse");
const KeyboardPlayer = require("./keyboard");
const log            = require("../logger");

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

class Player {
  /**
   * @param {object} opts
   * @param {number}  [opts.speedMultiplier=1]
   * @param {number}  [opts.minDelay=0]
   * @param {number}  [opts.scaleX]
   * @param {number}  [opts.scaleY]
   * @param {string}  [opts.scale]   "WxH" e.g. "1920x1080"
   */
  constructor({ speedMultiplier = 1.0, minDelay = 0, scaleX, scaleY, scale } = {}) {
    this.speedMultiplier = speedMultiplier;
    this.minDelay        = minDelay;
    this._keyboard       = new KeyboardPlayer();
    this._paused         = false;
    this._stopped        = false;
    this._scaleX         = scaleX ?? null;
    this._scaleY         = scaleY ?? null;
    this._scaleStr       = scale  ?? null;
  }

  pause()  { this._paused  = true;  log.warn("Playback PAUSED  ⏸"); }
  resume() { this._paused  = false; log.ok("Playback RESUMED ▶"); }
  stop()   { this._stopped = true;  log.warn("Playback STOPPED ■"); }

  async play(source) {
    const macro = typeof source === "string"
      ? JSON.parse(fs.readFileSync(source, "utf8"))
      : source;

    if (!macro || !Array.isArray(macro.actions))
      throw new Error("Invalid macro: missing actions array");

    const mouse = new MousePlayer();

    if (this._scaleX !== null && this._scaleY !== null) {
      mouse.scaleX = this._scaleX;
      mouse.scaleY = this._scaleY;
    } else if (this._scaleStr) {
      const [rw, rh] = this._scaleStr.split("x").map(Number);
      if (rw && rh) await mouse.autoScale(rw, rh);
    } else if (macro.screen?.w && macro.screen?.h) {
      await mouse.autoScale(macro.screen.w, macro.screen.h);
    }

    this._stopped = false;
    this._paused  = false;

    const total = macro.actions.length;
    log.info(
      `Playing macro: ${macro.name}` +
      `  actions=${total}  speed=${this.speedMultiplier}x`
    );

    const startTime = Date.now();

    for (let i = 0; i < total; i++) {
      if (this._stopped) break;

      while (this._paused && !this._stopped) await sleep(100);
      if (this._stopped) break;

      const action = macro.actions[i];
      const delay  = Math.max(
        this.minDelay,
        Math.round((action.delay || 0) / this.speedMultiplier)
      );

      if (delay >= 300) {
        await log.liveCountdown(delay, "Delay");
      } else if (delay > 0) {
        await sleep(delay);
      }

      await this._executeAction(action, i + 1, total, mouse);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    log.ok(`Macro complete  actions=${total}  elapsed=${elapsed}s`);
  }

  async _executeAction(action, idx, total, mouse) {
    try {
      switch (action.type) {
        case "mouse": {
          log.info(`[${idx}/${total}] mouse.${action.action}  (${action.x},${action.y})`);
          await mouse.execute(action);
          break;
        }
        case "keyboard": {
          const detail = action.action === "text"
            ? `type "${action.text}"`
            : `hotkey ${action.label || (action.keys || []).join("+")}`;
          log.info(`[${idx}/${total}] keyboard.${detail}`);
          await this._keyboard.execute(action);
          break;
        }
        case "wait": {
          const dur = Math.round((action.duration || 0) / this.speedMultiplier);
          log.info(`[${idx}/${total}] wait ${dur}ms`);
          await log.liveCountdown(dur, "Wait action");
          break;
        }
        default:
          log.warn(`[${idx}/${total}] Unknown action type: ${action.type}`);
      }
    } catch (err) {
      log.error(`[${idx}/${total}] ${err.message}`);
    }
  }
}

module.exports = Player;
