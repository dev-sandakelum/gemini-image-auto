"use strict";
/**
 * gui/preload.js — contextBridge IPC bridge
 *
 * Exposes a single `window.api` object to the renderer.
 * Every method returns a Promise (via ipcRenderer.invoke).
 *
 * Renderer usage:
 *   const items = await window.api.queue.load();
 *   window.api.on.log((payload) => console.log(payload));
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {

  // ── Queue ─────────────────────────────────────────────────────────────────
  queue: {
    load:         ()       => ipcRenderer.invoke("queue:load"),
    stats:        ()       => ipcRenderer.invoke("queue:stats"),
    import:       (json)   => ipcRenderer.invoke("queue:import", { queueJson: json }),
    resetItem:    (id)     => ipcRenderer.invoke("queue:reset-item", { id }),
    resetFailed:  ()       => ipcRenderer.invoke("queue:reset-failed"),
  },

  // ── Runner ────────────────────────────────────────────────────────────────
  runner: {
    start:     ()    => ipcRenderer.invoke("runner:start"),
    startFrom: (id)  => ipcRenderer.invoke("runner:start-from", { id }),
    runFailed: ()    => ipcRenderer.invoke("runner:run-failed"),
    pause:     ()    => ipcRenderer.invoke("runner:pause"),
    resume:    ()    => ipcRenderer.invoke("runner:resume"),
    stop:      ()    => ipcRenderer.invoke("runner:stop"),
    status:    ()    => ipcRenderer.invoke("runner:status"),
  },

  // ── Macros ────────────────────────────────────────────────────────────────
  macros: {
    list:  ()             => ipcRenderer.invoke("macros:list"),
    load:  (file)         => ipcRenderer.invoke("macros:load", { file }),
    save:  (file, content) => ipcRenderer.invoke("macros:save", { file, content }),
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get:  ()     => ipcRenderer.invoke("settings:get"),
    save: (data) => ipcRenderer.invoke("settings:save", data),
  },

  // ── Dialogs / shell ───────────────────────────────────────────────────────
  dialog: {
    pickFolder: ()    => ipcRenderer.invoke("dialog:pick-folder"),
  },
  shell: {
    openPath: (p)   => ipcRenderer.invoke("shell:open-path", { p }),
  },

  // ── Event subscriptions ───────────────────────────────────────────────────
  on: {
    /**
     * Log lines forwarded from main process.
     * @param {function({ level: string, msg: string, ts: string })} cb
     */
    log: (cb) => {
      ipcRenderer.on("log", (_e, payload) => cb(payload));
    },

    /**
     * Runner lifecycle events.
     * @param {function({ type: string, payload: object })} cb
     */
    runnerEvent: (cb) => {
      ipcRenderer.on("runner-event", (_e, payload) => cb(payload));
    },
  },

  // ── Remove listeners ─────────────────────────────────────────────────────
  off: {
    log:         () => ipcRenderer.removeAllListeners("log"),
    runnerEvent: () => ipcRenderer.removeAllListeners("runner-event"),
  },
});
