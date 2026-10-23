"use strict";
/**
 * src/engine/paste-prompt.js
 *
 * Writes a string to the system clipboard then fires Ctrl+V into
 * whatever window is currently focused.
 *
 * In the Electron main process, clipboard is available from 'electron'.
 * When running as plain Node (test / CLI), we fall back to a child_process
 * PowerShell call so the module stays self-contained.
 */

const { keyboard, Key } = require("@nut-tree-fork/nut-js");
const log               = require("../logger");

keyboard.config.autoDelayMs = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * Write text to clipboard.
 * Tries Electron's clipboard first (available in main process),
 * falls back to PowerShell Set-Clipboard.
 *
 * @param {string} text
 */
async function writeClipboard(text) {
  try {
    // Works in Electron main process
    const { clipboard } = require("electron");
    clipboard.writeText(text);
    log.info(`Clipboard via Electron (${text.length} chars)`);
    return;
  } catch (_) {
    // Not in Electron — use PowerShell
  }

  const { execSync } = require("child_process");
  // Escape single-quotes by doubling them for PowerShell
  const escaped = text.replace(/'/g, "''");
  execSync(`powershell -NoProfile -Command "Set-Clipboard -Value '${escaped}'"`, {
    stdio: "pipe",
    windowsHide: true,
  });
  log.info(`Clipboard via PowerShell (${text.length} chars)`);
}

/**
 * Paste prompt into the currently focused field.
 *
 * @param {string} promptText  Full prompt string for this queue item
 */
async function pastePrompt(promptText) {
  if (!promptText || typeof promptText !== "string") {
    throw new Error("pastePrompt: promptText must be a non-empty string");
  }

  log.info(`Pasting prompt: "${promptText.slice(0, 60)}${promptText.length > 60 ? "…" : ""}"`);

  await writeClipboard(promptText);
  await sleep(100); // let clipboard settle

  // Ctrl+V
  await keyboard.pressKey(Key.LeftControl, Key.V);
  await keyboard.releaseKey(Key.LeftControl, Key.V);
  await sleep(200); // let the UI register the paste

  log.ok("Prompt pasted");
}

module.exports = { pastePrompt, writeClipboard };
