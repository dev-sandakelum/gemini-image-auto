"use strict";
/**
 * src/engine/queue-runner.js
 *
 * Walks queue.json item by item, executing pipeline.json steps for each.
 * Progress is persisted to queue-state.json after every item so a crash or
 * pause is fully resumable.
 *
 * Usage (from Electron main or CLI):
 *
 *   const QueueRunner = require('./src/engine/queue-runner');
 *   const runner = new QueueRunner({ projectRoot: __dirname });
 *   runner.on('progress', ({ done, total, item, step }) => { ... });
 *   runner.on('item-done',   (item) => { ... });
 *   runner.on('item-failed', (item, reason) => { ... });
 *   runner.on('finished',    () => { ... });
 *   await runner.start();          // run all pending
 *   await runner.startFrom(id);    // resume from a specific id
 *   runner.pause();
 *   runner.stop();
 */

const path   = require("path");
const fs     = require("fs");
const fse    = require("fs-extra");
const { EventEmitter } = require("events");

const Player         = require("../player/player");
const { pastePrompt } = require("./paste-prompt");
const { sortFile }   = require("./sort-file");
const log            = require("../logger");

// Default paths (relative to project root)
const DEFAULTS = {
  queueFile:    "queue.json",
  stateFile:    "queue-state.json",
  pipelineFile: "pipeline.json",
  macrosDir:    "macros",
  outputDir:    "output",
  downloadsDir: null, // resolved at runtime from OS if not provided
};

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

class QueueRunner extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}  opts.projectRoot      Absolute path to new_system/
   * @param {string}  [opts.queueFile]      Path to queue.json
   * @param {string}  [opts.stateFile]      Path to queue-state.json
   * @param {string}  [opts.pipelineFile]   Path to pipeline.json
   * @param {string}  [opts.macrosDir]      Path to macros/
   * @param {string}  [opts.outputDir]      Path to output/
   * @param {string}  [opts.downloadsDir]   OS downloads folder (auto-detected if omitted)
   * @param {number}  [opts.speedMultiplier=1]
   * @param {number}  [opts.intervalMs=500]  Pause between queue items
   */
  constructor(opts = {}) {
    super();
    const root = opts.projectRoot || path.join(__dirname, "..", "..");

    this._root         = root;
    this._queueFile    = path.resolve(opts.queueFile    || path.join(root, DEFAULTS.queueFile));
    this._stateFile    = path.resolve(opts.stateFile    || path.join(root, DEFAULTS.stateFile));
    this._pipelineFile = path.resolve(opts.pipelineFile || path.join(root, DEFAULTS.pipelineFile));
    this._macrosDir    = path.resolve(opts.macrosDir    || path.join(root, DEFAULTS.macrosDir));
    this._outputDir    = path.resolve(opts.outputDir    || path.join(root, DEFAULTS.outputDir));
    this._downloadsDir = opts.downloadsDir || this._resolveDownloads();
    this._speed        = opts.speedMultiplier || 1;
    this._intervalMs   = opts.intervalMs ?? 500;

    this._paused  = false;
    this._stopped = false;
    this._running = false;
  }

  // ── Public controls ─────────────────────────────────────────────────────────

  pause() {
    this._paused = true;
    log.warn("Queue PAUSED  ⏸");
    this.emit("paused");
  }

  resume() {
    this._paused = false;
    log.ok("Queue RESUMED ▶");
    this.emit("resumed");
  }

  stop() {
    this._stopped = true;
    this._paused  = false;
    log.warn("Queue STOPPED ■");
    this.emit("stopped");
  }

  get isRunning() { return this._running; }
  get isPaused()  { return this._paused;  }

  // ── Start / resume from id ──────────────────────────────────────────────────

  async start() {
    await this._run(null);
  }

  async startFrom(id) {
    await this._run(id);
  }

  /** Run only items that are currently 'failed' */
  async runFailed() {
    const state = this._loadState();
    const failedIds = new Set(
      Object.entries(state)
        .filter(([, v]) => v.status === "failed")
        .map(([k]) => parseInt(k, 10))
    );
    if (failedIds.size === 0) {
      log.info("No failed items to retry");
      return;
    }
    log.info(`Retrying ${failedIds.size} failed item(s)`);
    await this._run(null, failedIds);
  }

  // ── Core loop ───────────────────────────────────────────────────────────────

  async _run(startFromId = null, onlyIds = null) {
    if (this._running) {
      log.warn("QueueRunner: already running — call stop() first");
      return;
    }

    this._running = true;
    this._stopped = false;
    this._paused  = false;

    let queue, pipeline;
    try {
      queue    = this._loadQueue();
      pipeline = this._loadPipeline();
    } catch (err) {
      this._running = false;
      this.emit("error", err);
      return;
    }

    const state = this._loadState();

    // Filter items to run
    let items = queue;
    if (onlyIds) {
      items = queue.filter((item) => onlyIds.has(item.id));
    } else {
      // Skip already-done items; optionally start from a specific id
      let seenStart = startFromId == null;
      items = queue.filter((item) => {
        if (!seenStart) {
          if (item.id === startFromId) seenStart = true;
          else return false;
        }
        return (state[item.id]?.status ?? "pending") !== "done";
      });
    }

    const total = items.length;
    log.info(`Queue: ${total} item(s) to process`);
    this.emit("started", { total });

    for (let i = 0; i < items.length; i++) {
      if (this._stopped) break;

      // Honour pause
      while (this._paused && !this._stopped) {
        await sleep(200);
      }
      if (this._stopped) break;

      const item = items[i];
      log.divider(`ITEM ${i + 1}/${total}  id=${item.id}`);
      log.info(`path: ${item.path}  name: ${item.name}`);

      // Mark running
      state[item.id] = { status: "running" };
      this._saveState(state);
      this.emit("item-start", { item, done: i, total });

      try {
        await this._runPipeline(item, pipeline, i + 1, total);

        state[item.id] = { status: "done" };
        this._saveState(state);
        log.ok(`Item ${item.id} done`);
        this.emit("item-done", { item, done: i + 1, total });

      } catch (err) {
        const reason = err.message;
        state[item.id] = { status: "failed", reason };
        this._saveState(state);
        log.error(`Item ${item.id} FAILED: ${reason}`);
        this.emit("item-failed", { item, reason, done: i + 1, total });
        // Always continue — no retry loop, flag and move on
      }

      if (i < items.length - 1 && this._intervalMs > 0) {
        await sleep(this._intervalMs);
      }
    }

    this._running = false;
    if (!this._stopped) {
      log.ok("Queue finished");
      this.emit("finished");
    }
  }

  // ── Pipeline execution ───────────────────────────────────────────────────────

  async _runPipeline(item, pipeline, itemNum, itemTotal) {
    const steps  = pipeline.steps;
    const player = new Player({ speedMultiplier: this._speed });

    for (let s = 0; s < steps.length; s++) {
      if (this._stopped) throw new Error("Stopped by user");

      const step = steps[s];
      log.info(`Step ${s + 1}/${steps.length}: ${step.label || step.action}`);
      this.emit("step", { item, step: s + 1, totalSteps: steps.length, label: step.label || step.action });

      switch (step.action) {

        // ── Play a recorded macro ─────────────────────────────────────────
        case "click":
        case "submit":
        case "save_image": {
          const macroPath = path.join(this._macrosDir, step.macro);
          if (!fs.existsSync(macroPath)) {
            throw new Error(`Macro not found: ${step.macro}`);
          }
          await player.play(macroPath);
          break;
        }

        // ── Paste prompt via clipboard ────────────────────────────────────
        case "paste_prompt": {
          await pastePrompt(item.prompt);
          break;
        }

        // ── Wait for image generation ─────────────────────────────────────
        case "wait_generation": {
          const timeoutMs = step.timeoutMs || 15000;
          log.info(`Waiting for generation (${timeoutMs}ms timeout)…`);
          await log.liveCountdown(timeoutMs, "Generating image");
          // Timeout-only approach per the spec — no visual detection yet
          break;
        }

        // ── Move downloaded file to output/ ───────────────────────────────
        case "sort_to": {
          await sortFile({
            downloadsDir: this._downloadsDir,
            outputRoot:   this._outputDir,
            itemPath:     item.path,
            itemName:     item.name,
            timeoutMs:    10000,
          });
          break;
        }

        default:
          throw new Error(`Unknown pipeline action: "${step.action}"`);
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _resolveDownloads() {
    // Windows: use USERPROFILE\Downloads
    const base = process.env.USERPROFILE || process.env.HOME || "";
    return path.join(base, "Downloads");
  }

  _loadQueue() {
    if (!fs.existsSync(this._queueFile)) {
      throw new Error(`queue.json not found at: ${this._queueFile}`);
    }
    const raw = JSON.parse(fs.readFileSync(this._queueFile, "utf8"));
    if (!Array.isArray(raw)) throw new Error("queue.json must be a JSON array");

    // Validate required fields
    const errors = [];
    const ids = new Set();
    for (const item of raw) {
      if (typeof item.id !== "number")   errors.push(`item missing numeric id`);
      if (typeof item.name !== "string") errors.push(`id=${item.id}: missing name`);
      if (typeof item.path !== "string") errors.push(`id=${item.id}: missing path`);
      if (typeof item.prompt !== "string") errors.push(`id=${item.id}: missing prompt`);
      if (ids.has(item.id)) errors.push(`duplicate id=${item.id}`);
      ids.add(item.id);
    }
    if (errors.length) throw new Error(`queue.json validation errors:\n${errors.join("\n")}`);
    return raw;
  }

  _loadPipeline() {
    if (!fs.existsSync(this._pipelineFile)) {
      throw new Error(`pipeline.json not found at: ${this._pipelineFile}`);
    }
    return JSON.parse(fs.readFileSync(this._pipelineFile, "utf8"));
  }

  _loadState() {
    try {
      return JSON.parse(fs.readFileSync(this._stateFile, "utf8"));
    } catch {
      return {};
    }
  }

  _saveState(state) {
    fse.ensureDirSync(path.dirname(this._stateFile));
    fs.writeFileSync(this._stateFile, JSON.stringify(state, null, 2), "utf8");
  }

  /**
   * Get a merged view of the queue with current statuses.
   * Useful for the GUI queue table.
   *
   * @returns {Array<{id,name,path,prompt,status,reason}>}
   */
  getQueueWithStatus() {
    let queue;
    try { queue = this._loadQueue(); } catch { return []; }
    const state = this._loadState();
    return queue.map((item) => ({
      ...item,
      status: state[item.id]?.status ?? "pending",
      reason: state[item.id]?.reason ?? null,
    }));
  }

  /** Reset state of a single item back to pending. */
  resetItem(id) {
    const state = this._loadState();
    delete state[id];
    this._saveState(state);
  }

  /** Reset all failed items to pending so they can be re-run. */
  resetFailed() {
    const state = this._loadState();
    let count = 0;
    for (const [k, v] of Object.entries(state)) {
      if (v.status === "failed") { delete state[k]; count++; }
    }
    this._saveState(state);
    log.info(`Reset ${count} failed item(s) to pending`);
    return count;
  }

  /** Stats summary for the GUI header. */
  getStats() {
    let queue;
    try { queue = this._loadQueue(); } catch { return { total: 0, pending: 0, done: 0, failed: 0, running: 0 }; }
    const state = this._loadState();
    const counts = { total: queue.length, pending: 0, done: 0, failed: 0, running: 0 };
    for (const item of queue) {
      const s = state[item.id]?.status ?? "pending";
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }
}

module.exports = QueueRunner;
