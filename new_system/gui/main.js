"use strict";
/**
 * gui/main.js — Electron main process
 *
 * Responsibilities:
 *  - Create and manage the BrowserWindow
 *  - Instantiate QueueRunner + expose it via IPC
 *  - Forward runner events → renderer ("runner-event" channel)
 *  - Handle all IPC requests from the renderer (see ipc handlers below)
 *
 * IPC channels (main ← renderer):
 *   queue:load         → returns queue items with current status
 *   queue:import       → { queueJson: string } replace queue.json content
 *   queue:stats        → returns { total, pending, done, failed, running }
 *   queue:reset-item   → { id: number }
 *   queue:reset-failed → resets all failed items
 *   runner:start       → start from first pending
 *   runner:start-from  → { id: number }
 *   runner:run-failed  → retry failed items only
 *   runner:pause       → pause
 *   runner:resume      → resume
 *   runner:stop        → stop
 *   runner:status      → returns { running, paused }
 *   macros:list        → returns array of macro filenames
 *   macros:load        → { file: string } returns macro JSON
 *   macros:save        → { file: string, content: object }
 *   settings:get       → returns { downloadsDir, speedMultiplier, intervalMs }
 *   settings:save      → { downloadsDir, speedMultiplier, intervalMs }
 *
 * IPC channels (main → renderer):
 *   log                → { level, msg, ts }
 *   runner-event       → { type, payload }
 *     types: started, item-start, item-done, item-failed, step, finished, paused, resumed, stopped
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path  = require("path");
const fs    = require("fs");
const fse   = require("fs-extra");

const QueueRunner = require("../src/engine/queue-runner");
const log         = require("../src/logger");

const PROJECT_ROOT  = path.join(__dirname, "..");
const MACROS_DIR    = path.join(PROJECT_ROOT, "macros");
const SETTINGS_FILE = path.join(PROJECT_ROOT, "settings.json");

// ── Load / save settings ──────────────────────────────────────────────────────
function loadSettings() {
  const defaults = {
    downloadsDir:    path.join(process.env.USERPROFILE || process.env.HOME || "", "Downloads"),
    speedMultiplier: 1,
    intervalMs:      500,
  };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
  } catch {
    return defaults;
  }
}

function saveSettings(data) {
  fse.ensureDirSync(path.dirname(SETTINGS_FILE));
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ── Runner singleton ──────────────────────────────────────────────────────────
let runner = null;

function buildRunner(win, settings) {
  if (runner && runner.isRunning) {
    runner.stop();
  }

  runner = new QueueRunner({
    projectRoot:     PROJECT_ROOT,
    downloadsDir:    settings.downloadsDir,
    speedMultiplier: settings.speedMultiplier,
    intervalMs:      settings.intervalMs,
  });

  // Forward all runner events to renderer
  const forward = (type) => (payload) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send("runner-event", { type, payload: payload || {} });
    }
  };

  runner.on("started",      forward("started"));
  runner.on("item-start",   forward("item-start"));
  runner.on("item-done",    forward("item-done"));
  runner.on("item-failed",  forward("item-failed"));
  runner.on("step",         forward("step"));
  runner.on("finished",     forward("finished"));
  runner.on("paused",       forward("paused"));
  runner.on("resumed",      forward("resumed"));
  runner.on("stopped",      forward("stopped"));
  runner.on("error", (err) => {
    log.error(`Runner error: ${err.message}`);
    forward("error")({ message: err.message });
  });

  return runner;
}

// ── Window ────────────────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1200,
    height:          760,
    minWidth:        900,
    minHeight:       600,
    backgroundColor: "#0f0f13",
    title:           "Gemini Image Auto",
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Wire the logger to the window so all log.* calls relay to the renderer
  log.setWindow(mainWindow);

  const settings = loadSettings();
  buildRunner(mainWindow, settings);

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Queue
ipcMain.handle("queue:load",         () => runner.getQueueWithStatus());
ipcMain.handle("queue:stats",        () => runner.getStats());
ipcMain.handle("queue:reset-item",   (_e, { id }) => { runner.resetItem(id); return true; });
ipcMain.handle("queue:reset-failed", () => runner.resetFailed());

ipcMain.handle("queue:import", (_e, { queueJson }) => {
  try {
    const parsed = JSON.parse(queueJson);
    if (!Array.isArray(parsed)) throw new Error("Must be a JSON array");
    const queueFile = path.join(PROJECT_ROOT, "queue.json");
    fs.writeFileSync(queueFile, JSON.stringify(parsed, null, 2), "utf8");
    // Rebuild runner so it picks up the new queue file
    if (mainWindow) buildRunner(mainWindow, loadSettings());
    return { ok: true, count: parsed.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Runner controls
ipcMain.handle("runner:start",      async () => { runner.start();         return true; });
ipcMain.handle("runner:start-from", async (_e, { id }) => { runner.startFrom(id); return true; });
ipcMain.handle("runner:run-failed", async () => { runner.runFailed();     return true; });
ipcMain.handle("runner:pause",      ()      => { runner.pause();          return true; });
ipcMain.handle("runner:resume",     ()      => { runner.resume();         return true; });
ipcMain.handle("runner:stop",       ()      => { runner.stop();           return true; });
ipcMain.handle("runner:status",     ()      => ({
  running: runner.isRunning,
  paused:  runner.isPaused,
}));

// Macros
ipcMain.handle("macros:list", () => {
  fse.ensureDirSync(MACROS_DIR);
  return fs.readdirSync(MACROS_DIR).filter((f) => f.endsWith(".json"));
});

ipcMain.handle("macros:load", (_e, { file }) => {
  const p = path.join(MACROS_DIR, path.basename(file)); // sanitise path
  if (!fs.existsSync(p)) throw new Error(`Macro not found: ${file}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
});

ipcMain.handle("macros:save", (_e, { file, content }) => {
  fse.ensureDirSync(MACROS_DIR);
  const p = path.join(MACROS_DIR, path.basename(file));
  fs.writeFileSync(p, JSON.stringify(content, null, 2), "utf8");
  return true;
});

// Settings
ipcMain.handle("settings:get",  ()           => loadSettings());
ipcMain.handle("settings:save", (_e, data)   => {
  const settings = { ...loadSettings(), ...data };
  saveSettings(settings);
  // Rebuild runner with new settings
  if (mainWindow) buildRunner(mainWindow, settings);
  return true;
});

// Open folder picker dialog
ipcMain.handle("dialog:pick-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title:      "Select Downloads Folder",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Open file in file explorer
ipcMain.handle("shell:open-path", (_e, { p }) => {
  shell.showItemInFolder(p);
  return true;
});
