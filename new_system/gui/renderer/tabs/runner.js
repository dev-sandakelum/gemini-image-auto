"use strict";
/**
 * renderer/tabs/runner.js — Tab 2: Runner
 *
 * Responsibilities:
 *  - Run all / run failed / pause / resume / stop
 *  - Display live progress banner
 *  - Display colour-coded log pane
 *  - Speed + interval controls (written to settings before starting)
 */

(function initRunnerTab() {

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const btnRunAll    = document.getElementById("btn-run-all");
  const btnRunFailed = document.getElementById("btn-run-failed");
  const btnPause     = document.getElementById("btn-pause");
  const btnStop      = document.getElementById("btn-stop");

  const progressEl   = document.getElementById("runner-progress");
  const currentEl    = document.getElementById("runner-current-item");
  const stepEl       = document.getElementById("runner-step");
  const statusEl     = document.getElementById("runner-status-text");

  const logPane      = document.getElementById("log-pane");
  const autoScroll   = document.getElementById("log-autoscroll");
  const btnClearLog  = document.getElementById("btn-clear-log");

  const speedInput    = document.getElementById("speed-input");
  const intervalInput = document.getElementById("interval-input");

  // ── State ────────────────────────────────────────────────────────────────────
  let totalItems = 0;
  let doneItems  = 0;

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function setRunning(yes) {
    btnRunAll.disabled    = yes;
    btnRunFailed.disabled = yes;
    btnPause.disabled     = !yes;
    btnStop.disabled      = !yes;
  }

  function appendLog(level, msg, ts) {
    const line = document.createElement("div");
    line.className = `log-line log-line-${level}`;
    line.innerHTML =
      `<span class="log-ts">${esc(ts || "")}</span>` +
      esc(msg);
    logPane.appendChild(line);

    // Trim if too long
    if (logPane.children.length > 2000) {
      logPane.removeChild(logPane.firstChild);
    }

    if (autoScroll.checked) {
      logPane.scrollTop = logPane.scrollHeight;
    }
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function applySpeedInterval() {
    const speed    = parseFloat(speedInput.value)    || 1;
    const interval = parseInt(intervalInput.value, 10) ?? 500;
    await window.api.settings.save({ speedMultiplier: speed, intervalMs: interval });
  }

  // ── Buttons ───────────────────────────────────────────────────────────────────
  btnRunAll.addEventListener("click", async () => {
    await applySpeedInterval();
    await window.api.runner.start();
    setRunning(true);
    statusEl.textContent = "Running";
  });

  btnRunFailed.addEventListener("click", async () => {
    await applySpeedInterval();
    await window.api.runner.runFailed();
    setRunning(true);
    statusEl.textContent = "Running (failed only)";
  });

  btnPause.addEventListener("click", async () => {
    const s = await window.api.runner.status();
    if (s.paused) {
      await window.api.runner.resume();
      btnPause.textContent = "⏸ Pause";
      statusEl.textContent = "Running";
    } else {
      await window.api.runner.pause();
      btnPause.textContent = "▶ Resume";
      statusEl.textContent = "Paused";
    }
  });

  btnStop.addEventListener("click", async () => {
    await window.api.runner.stop();
    setRunning(false);
    statusEl.textContent = "Stopped";
    btnPause.textContent = "⏸ Pause";
  });

  btnClearLog.addEventListener("click", () => { logPane.innerHTML = ""; });

  // ── Runner events ─────────────────────────────────────────────────────────────
  window.api.on.runnerEvent(({ type, payload }) => {
    switch (type) {

      case "started":
        totalItems = payload.total || 0;
        doneItems  = 0;
        progressEl.textContent = `0 / ${totalItems}`;
        statusEl.textContent   = "Running";
        setRunning(true);
        appendLog("ok", `▶ Started — ${totalItems} item(s) to process`, now());
        break;

      case "item-start":
        currentEl.textContent = `id=${payload.item?.id}  ${payload.item?.path}/${payload.item?.name}`;
        stepEl.textContent    = "—";
        appendLog("info", `→ Item ${payload.item?.id}: ${payload.item?.path}/${payload.item?.name}`, now());
        break;

      case "step":
        stepEl.textContent = `${payload.step}/${payload.totalSteps}  ${payload.label || ""}`;
        appendLog("info", `  step ${payload.step}: ${payload.label || ""}`, now());
        break;

      case "item-done":
        doneItems = payload.done || doneItems + 1;
        progressEl.textContent = `${doneItems} / ${totalItems}`;
        appendLog("ok", `✓ Done  id=${payload.item?.id}`, now());
        break;

      case "item-failed":
        doneItems = payload.done || doneItems + 1;
        progressEl.textContent = `${doneItems} / ${totalItems}`;
        appendLog("error", `✗ Failed  id=${payload.item?.id}  ${payload.reason}`, now());
        break;

      case "finished":
        setRunning(false);
        statusEl.textContent = "Finished";
        appendLog("ok", "■ Queue finished", now());
        break;

      case "paused":
        statusEl.textContent = "Paused";
        appendLog("warn", "⏸ Paused", now());
        break;

      case "resumed":
        statusEl.textContent = "Running";
        appendLog("info", "▶ Resumed", now());
        break;

      case "stopped":
        setRunning(false);
        statusEl.textContent = "Stopped";
        appendLog("warn", "■ Stopped by user", now());
        break;

      case "error":
        appendLog("error", `Runner error: ${payload.message}`, now());
        break;
    }
  });

  // ── Log lines from main process ───────────────────────────────────────────────
  window.api.on.log(({ level, msg, ts }) => {
    appendLog(level, msg, ts);
  });

  // ── Init ──────────────────────────────────────────────────────────────────────
  (async () => {
    // Load speed/interval from settings
    try {
      const s = await window.api.settings.get();
      speedInput.value    = s.speedMultiplier ?? 1;
      intervalInput.value = s.intervalMs      ?? 500;
    } catch (_) {}

    // Sync button state with current runner status
    try {
      const s = await window.api.runner.status();
      setRunning(s.running);
      if (s.running && s.paused) {
        statusEl.textContent = "Paused";
        btnPause.textContent = "▶ Resume";
      } else if (s.running) {
        statusEl.textContent = "Running";
      }
    } catch (_) {}
  })();

  function now() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function pad(n) { return String(n).padStart(2, "0"); }

})();
