"use strict";
/**
 * renderer/tabs/settings.js — Tab 3: Settings
 *
 * Fields:
 *  - downloadsDir   (with folder picker)
 *  - speedMultiplier
 *  - intervalMs
 */

(function initSettingsTab() {

  const downloadsInput  = document.getElementById("settings-downloads");
  const btnPickDir      = document.getElementById("btn-pick-downloads");
  const speedInput      = document.getElementById("settings-speed");
  const intervalInput   = document.getElementById("settings-interval");
  const btnSave         = document.getElementById("btn-save-settings");
  const savedMsg        = document.getElementById("settings-saved-msg");

  let _hideTimer = null;

  // ── Load ──────────────────────────────────────────────────────────────────────
  async function loadSettings() {
    try {
      const s = await window.api.settings.get();
      downloadsInput.value = s.downloadsDir      || "";
      speedInput.value     = s.speedMultiplier   ?? 1;
      intervalInput.value  = s.intervalMs        ?? 500;
    } catch (err) {
      console.error("settings:get error", err);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────────
  btnPickDir.addEventListener("click", async () => {
    const dir = await window.api.dialog.pickFolder();
    if (dir) downloadsInput.value = dir;
  });

  btnSave.addEventListener("click", async () => {
    try {
      await window.api.settings.save({
        downloadsDir:    downloadsInput.value.trim(),
        speedMultiplier: parseFloat(speedInput.value)    || 1,
        intervalMs:      parseInt(intervalInput.value, 10) ?? 500,
      });

      savedMsg.classList.remove("hidden");
      clearTimeout(_hideTimer);
      _hideTimer = setTimeout(() => savedMsg.classList.add("hidden"), 3000);
    } catch (err) {
      alert(`Could not save settings: ${err.message}`);
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────────
  loadSettings();

  document.querySelector('[data-tab="settings"]').addEventListener("click", loadSettings);

})();
