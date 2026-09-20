"use strict";
/**
 * player/player.js
 * Loads a recorded macro JSON and replays every action with its original delay.
 * State: IDLE → RUNNING → WAITING → COMPLETED
 *
 * Coordinate scaling:
 *   --scale 1920x1080   scale from recorded resolution to current screen
 *   --scalex 0.8        manual X factor
 *   --scaley 0.8        manual Y factor
 *   If the macro JSON has a "screen" field ({ w, h }) it is used automatically.
 */

const path           = require("path");
const MousePlayer    = require("./mouse");
const KeyboardPlayer = require("./keyboard");
const FileManager    = require("../automation/fileManager");
const log            = require("../logger");

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

const STATES = {
  IDLE:      "IDLE",
  RUNNING:   "RUNNING",
  WAITING:   "WAITING",
  COMPLETED: "COMPLETED",
};

class Player {
  /**
   * @param {object} opts
   * @param {number}  [opts.speedMultiplier=1]
   * @param {number}  [opts.minDelay=0]
   * @param {number}  [opts.scaleX=1]   X coordinate multiplier
   * @param {number}  [opts.scaleY=1]   Y coordinate multiplier
   * @param {string}  [opts.scale]      "WxH" recorded resolution, e.g. "1920x1080"
   */
  constructor({ speedMultiplier = 1.0, minDelay = 0, scaleX, scaleY, scale } = {}) {
    this.state           = STATES.IDLE;
    this.speedMultiplier = speedMultiplier;
    this.minDelay        = minDelay;
    this._keyboard       = new KeyboardPlayer();
    this._paused         = false;
    this._stopped        = false;

    this._scaleX  = scaleX ?? null;
    this._scaleY  = scaleY ?? null;
    this._scaleStr = scale ?? null;
  }

  pause() {
    this._paused = true;
    log.warn("Playback PAUSED  ⏸");
  }
  resume() {
    this._paused = false;
    log.ok("Playback RESUMED ▶");
  }
  stop() {
    this._stopped = true;
    log.warn("Playback STOPPED ■");
  }

  async play(source) {
    const macro = typeof source === "string"
      ? await FileManager.readJSON(source)
      : source;

    if (!macro || !Array.isArray(macro.actions))
      throw new Error("Invalid macro: missing actions array");

    // ── Resolve coordinate scaling ─────────────────────────────────────────
    const mouse = new MousePlayer();

    if (this._scaleX !== null && this._scaleY !== null) {
      mouse.scaleX = this._scaleX;
      mouse.scaleY = this._scaleY;
      log.info(
        `Manual scale  scaleX=${log.paint(log.C.byellow, this._scaleX.toFixed(4))}` +
        `  scaleY=${log.paint(log.C.byellow, this._scaleY.toFixed(4))}`
      );
    } else if (this._scaleStr) {
      const [rw, rh] = this._scaleStr.split("x").map(Number);
      if (rw && rh) await mouse.autoScale(rw, rh);
    } else if (macro.screen?.w && macro.screen?.h) {
      await mouse.autoScale(macro.screen.w, macro.screen.h);
    }

    if (mouse.scaleX === 1 && mouse.scaleY === 1) {
      log.info("No coordinate scaling applied (recorded at same resolution)");
    }
    // ───────────────────────────────────────────────────────────────────────

    this.state    = STATES.RUNNING;
    this._stopped = false;
    this._paused  = false;

    const total = macro.actions.length;
    log.divider("PLAYBACK START");
    log.info(
      `Macro: ${log.paint(log.C.bwhite + log.C.bold, macro.name)}` +
      `  actions=${log.paint(log.C.bgreen, String(total))}` +
      `  speed=${log.paint(log.C.byellow, this.speedMultiplier + "x")}` +
      (macro.recordedAt ? `  recorded=${log.paint(log.C.gray, macro.recordedAt.slice(0, 10))}` : "")
    );
    log.divider();

    const startTime = Date.now();

    for (let i = 0; i < total; i++) {
      if (this._stopped) break;

      while (this._paused && !this._stopped) {
        this.state = STATES.WAITING;
        await sleep(100);
      }
      if (this._stopped) break;
      this.state = STATES.RUNNING;

      const action = macro.actions[i];
      const delay  = Math.max(
        this.minDelay,
        Math.round((action.delay || 0) / this.speedMultiplier)
      );

      // Live delay countdown (only for noticeable pauses)
      if (delay >= 300) {
        await log.liveCountdown(delay, "Delay");
      } else if (delay > 0) {
        await sleep(delay);
      }

      await this._executeAction(action, i + 1, total, mouse);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    this.state = STATES.COMPLETED;

    log.divider();
    log.ok(
      `Playback complete  ` +
      `actions=${log.paint(log.C.bgreen, String(total))}  ` +
      `elapsed=${log.paint(log.C.byellow, elapsed + "s")}`
    );
    log.divider("DONE");
  }

  async _executeAction(action, idx, total, mouse) {
    try {
      switch (action.type) {

        case "mouse": {
          const coord = (action.x != null && action.y != null)
            ? `(${log.paint(log.C.bcyan, String(action.x))},${log.paint(log.C.bcyan, String(action.y))})`
            : "";
          const btn = action.button ? log.paint(log.C.bmagenta, action.button) : "";
          const act = log.paint(log.C.bwhite + log.C.bold, action.action);
          log.playerAction(idx, total, "mouse",
            `mouse.${act}  ${btn}  ${coord}`,
            action.delay
          );
          await mouse.execute(action);
          break;
        }

        case "keyboard": {
          let detail;
          if (action.action === "text") {
            detail = `type  ${log.paint(log.C.bgreen, `"${action.text}"`)}`; 
          } else if (action.action === "hotkey") {
            detail = `hotkey  ${log.paint(log.C.byellow, action.label || action.keys?.join("+") || "")}`;
          } else {
            detail = `${action.action}  ${log.paint(log.C.gray, action.key || action.label || "")}`;
          }
          log.playerAction(idx, total, "keyboard",
            `keyboard.${detail}`,
            action.delay
          );
          await this._keyboard.execute(action);
          break;
        }

        case "wait": {
          const dur = Math.round((action.duration || 0) / this.speedMultiplier);
          log.playerAction(idx, total, "wait",
            `wait  ${log.paint(log.C.byellow, dur + "ms")}`,
            action.delay
          );
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
