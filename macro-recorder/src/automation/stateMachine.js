"use strict";
/**
 * automation/stateMachine.js
 * Drives state-based automation defined in a JSON file.
 */

const actions     = require("./actions");
const FileManager = require("./fileManager");
const log         = require("../logger");

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

const ENGINE_STATES = {
  IDLE:      "IDLE",
  RUNNING:   "RUNNING",
  WAITING:   "WAITING",
  COMPLETED: "COMPLETED",
  FAILED:    "FAILED",
};

class StateMachine {
  constructor() {
    this.engineState  = ENGINE_STATES.IDLE;
    this._retryCounts = {};
    this._stateCount  = 0;
    this._startTime   = null;
  }

  async run(source) {
    const automation = typeof source === "string"
      ? await FileManager.readJSON(source)
      : source;

    const { states, start = "START" } = automation;
    if (!states) throw new Error("Automation JSON must have a 'states' key");

    const stateNames = Object.keys(states);
    const ctx = { data: {}, _stop: false };

    this.engineState  = ENGINE_STATES.RUNNING;
    this._retryCounts = {};
    this._stateCount  = 0;
    this._startTime   = Date.now();

    let current  = start;
    let previous = null;

    log.divider("AUTOMATION START");
    log.info(
      `States: ${log.paint(log.C.bwhite, String(stateNames.length))}  ` +
      `Start: ${log.paint(log.C.bmagenta + log.C.bold, start)}`
    );
    log.divider();

    while (current && !ctx._stop) {
      const def = states[current];
      if (!def) throw new Error(`State "${current}" not defined`);

      this._stateCount++;
      log.stateTransition(previous, current);

      // Terminal state
      if (def.terminal || def.action === "stop") {
        if (def.action === "stop") await actions.stop(ctx, def);
        log.info(`Terminal state reached: ${log.paint(log.C.bwhite + log.C.bold, current)}`);
        break;
      }

      // Optional pre-state delay
      if (def.delay) {
        await log.liveCountdown(def.delay, `State delay (${current})`);
      }

      // ── Condition branch ───────────────────────────────────────────────
      if (def.condition) {
        const handler = actions[def.condition];
        if (typeof handler !== "function") {
          throw new Error(`Condition handler "${def.condition}" not found`);
        }
        const result = handler(ctx, def.params || def);
        const resStr = result
          ? log.paint(log.C.bgreen, "TRUE  → " + def.ifTrue)
          : log.paint(log.C.byellow, "FALSE → " + def.ifFalse);
        log.info(`Condition  ${log.paint(log.C.bwhite, def.condition)}  ${resStr}`);
        previous = current;
        current  = result ? (def.ifTrue || current) : (def.ifFalse || current);
        if (current === ENGINE_STATES.COMPLETED) break;
        continue;
      }

      // ── Normal action ──────────────────────────────────────────────────
      const handler = actions[def.action];
      if (typeof handler !== "function") {
        throw new Error(`Action handler "${def.action}" not found in actions.js`);
      }

      const t0 = Date.now();
      try {
        await handler(ctx, def.params ? { ...def, ...def.params } : def);
        const took = Date.now() - t0;
        log.info(
          `Action ${log.paint(log.C.bwhite + log.C.bold, def.action)} ` +
          log.paint(log.C.bgreen, "✓") +
          `  ${log.paint(log.C.gray, took + "ms")}`
        );
        this._retryCounts[current] = 0;
        previous = current;
        current  = def.next ?? null;
        if (!current) {
          log.info("No next state — stopping");
          break;
        }
      } catch (err) {
        log.error(`State "${current}" — ${err.message}`);

        if (def.retry) {
          const retries = (this._retryCounts[current] || 0) + 1;
          this._retryCounts[current] = retries;
          const max = def.maxRetries ?? 3;
          if (retries <= max) {
            log.warn(`Retry ${retries}/${max} → jumping to "${def.retry}"`);
            previous = current;
            current  = def.retry;
          } else {
            this.engineState = ENGINE_STATES.FAILED;
            throw new Error(`Max retries (${max}) exceeded in state "${current}"`);
          }
        } else {
          this.engineState = ENGINE_STATES.FAILED;
          throw err;
        }
      }
    }

    const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(2);
    this.engineState = ENGINE_STATES.COMPLETED;

    log.divider();
    log.ok(
      `Automation complete  ` +
      `states visited=${log.paint(log.C.bwhite, String(this._stateCount))}  ` +
      `elapsed=${log.paint(log.C.byellow, elapsed + "s")}`
    );
    log.divider("DONE");
  }
}

module.exports = StateMachine;
