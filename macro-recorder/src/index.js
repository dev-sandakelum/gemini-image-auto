"use strict";
/**
 * src/index.js
 * Entry point — dispatches to record / play / automation mode based on CLI args.
 *
 * Usage:
 *   node src/index.js --mode record [--name "My Macro"] [--movement]
 *   node src/index.js --mode play   --file macros/my-macro.json [--speed 2]
 *   node src/index.js --mode automation --file macros/form-filler.json
 */

const path         = require("path");
const Recorder     = require("./recorder/recorder");
const Player       = require("./player/player");
const StateMachine = require("./automation/stateMachine");
const log          = require("./logger");

// ── arg parse ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const mode = args.mode || "menu";

  switch (mode) {

    // ── RECORD ────────────────────────────────────────────────────────────
    case "record": {
      const recorder = new Recorder({
        macrosDir:      path.join(__dirname, "../macros"),
        recordMovement: "movement" in args,
      });

      log.banner("MACRO RECORDER", args.name ? `"${args.name}"` : "");
      log.info(`Mode     : ${log.paint(log.C.bred + log.C.bold, "RECORD")}`);
      log.info(`Movement : ${log.paint(log.C.bwhite, "movement" in args ? "ON" : "OFF")}`);
      log.info(`Save dir : ${log.paint(log.C.gray, path.join(__dirname, "../macros"))}`);
      log.divider();
      log.info(`${log.paint(log.C.byellow, "F9")}     → stop & save`);
      log.info(`${log.paint(log.C.byellow, "Escape")} → abort (nothing saved)`);
      log.divider();

      await log.startCountdown(3, "Recording starts");

      recorder.start(args.name || "recording");
      break;
    }

    // ── PLAY ──────────────────────────────────────────────────────────────
    case "play": {
      if (!args.file) {
        log.error("Usage: node src/index.js --mode play --file <path> [--speed 2.0] [--scale 1920x1080]");
        process.exit(1);
      }

      let scaleX = null, scaleY = null, scale = null;
      if (args.scalex && args.scaley) {
        scaleX = parseFloat(args.scalex);
        scaleY = parseFloat(args.scaley);
      } else if (args.scale && args.scale !== true) {
        scale = args.scale;
      }

      const speed = parseFloat(args.speed || "1");

      log.banner("MACRO PLAYER", path.basename(args.file));
      log.info(`Mode  : ${log.paint(log.C.bgreen + log.C.bold, "PLAY")}`);
      log.info(`File  : ${log.paint(log.C.bwhite, args.file)}`);
      log.info(`Speed : ${log.paint(log.C.byellow, speed + "x")}`);
      if (scale)           log.info(`Scale : recorded at ${log.paint(log.C.bcyan, scale)}`);
      if (scaleX !== null) log.info(`Scale : x=${log.paint(log.C.bcyan, String(scaleX))}  y=${log.paint(log.C.bcyan, String(scaleY))}`);
      if (!scale && scaleX === null) log.info(`Scale : ${log.paint(log.C.gray, "auto (from macro metadata)")}`);
      log.divider();

      const player = new Player({
        speedMultiplier: speed,
        minDelay: parseInt(args.mindelay || "0", 10),
        scaleX, scaleY, scale,
      });

      await log.startCountdown(3, "Playback starts");

      await player.play(path.resolve(args.file));
      break;
    }

    // ── AUTOMATION ────────────────────────────────────────────────────────
    case "automation": {
      if (!args.file) {
        log.error("Usage: node src/index.js --mode automation --file <path>");
        process.exit(1);
      }

      log.banner("STATE-MACHINE AUTOMATION", path.basename(args.file));
      log.info(`Mode : ${log.paint(log.C.bmagenta + log.C.bold, "AUTOMATION")}`);
      log.info(`File : ${log.paint(log.C.bwhite, args.file)}`);
      log.divider();

      await log.startCountdown(3, "Automation starts");

      const sm = new StateMachine();
      await sm.run(path.resolve(args.file));
      break;
    }

    // ── MENU ──────────────────────────────────────────────────────────────
    default: {
      const W = 56;
      const line = "═".repeat(W);
      const { C, paint } = log;

      log.raw(paint(C.bcyan, `╔${line}╗`));
      log.raw(paint(C.bcyan, `║`) + paint(C.bold + C.bwhite, "  MACRO RECORDER v1.0".padEnd(W)) + paint(C.bcyan, `║`));
      log.raw(paint(C.bcyan, `╠${line}╣`));

      const row = (label, value) =>
        paint(C.bcyan, "║") +
        `  ${paint(C.byellow, label.padEnd(10))}` +
        paint(C.gray, value.padEnd(W - 14)) +
        paint(C.bcyan, "║");

      const blank = () =>
        paint(C.bcyan, "║") + " ".repeat(W) + paint(C.bcyan, "║");

      const sect = (t) =>
        paint(C.bcyan, "║") +
        paint(C.bold + C.bwhite, `  ${t}`.padEnd(W)) +
        paint(C.bcyan, "║");

      log.raw(blank());
      log.raw(sect("Record a macro:"));
      log.raw(row("", "node src/index.js --mode record"));
      log.raw(row("--name", '"Login Flow"'));
      log.raw(row("--movement", "include mouse moves"));
      log.raw(blank());
      log.raw(sect("Play a macro:"));
      log.raw(row("", "node src/index.js --mode play --file macros/x.json"));
      log.raw(row("--speed", "2.0  (playback speed multiplier)"));
      log.raw(row("--scale", "1920x1080  (recorded resolution)"));
      log.raw(row("--scalex/y", "0.8  (manual scale factors)"));
      log.raw(blank());
      log.raw(sect("State-machine automation:"));
      log.raw(row("", "node src/index.js --mode automation --file macros/x.json"));
      log.raw(blank());
      log.raw(paint(C.bcyan, `╚${line}╝`));
    }
  }
}

main().catch((err) => {
  log.error(`[Fatal] ${err.message}`);
  process.exit(1);
});
