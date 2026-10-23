"use strict";
/**
 * renderer/tabs/recorder.js — Tab 1: Macro Recorder
 *
 * Visual action list builder for the 3 core macros:
 *   click_prompt_box.json
 *   press_enter.json
 *   click_save_as_image.json
 *
 * Supports:
 *  - Loading an existing macro from macros/
 *  - Adding actions via dropdown
 *  - Deleting actions
 *  - Saving back to macros/
 *  - Raw JSON editor (always visible as fallback)
 *
 * Note: Live recording via uiohook-napi would require a separate IPC call
 * to the main process. The "⏺ Record" button is stubbed here — it shows a
 * prompt explaining how to trigger recording in the main process.
 */

(function initRecorderTab() {

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const macroSelect  = document.getElementById("recorder-macro-select");
  const btnNew       = document.getElementById("btn-new-macro");
  const nameInput    = document.getElementById("macro-name-input");
  const btnLoad      = document.getElementById("btn-load-macro");
  const btnSave      = document.getElementById("btn-save-macro");
  const actionList   = document.getElementById("action-list");
  const newActionSel = document.getElementById("new-action-type");
  const btnAddAction = document.getElementById("btn-add-action");
  const btnRecord    = document.getElementById("btn-record-live");
  const rawJson      = document.getElementById("macro-raw-json");
  const btnApplyRaw  = document.getElementById("btn-apply-raw");

  // ── State ────────────────────────────────────────────────────────────────────
  let currentMacro = {
    name:      "",
    version:   1,
    recordedAt: null,
    actions:   [],
  };

  // ── Populate macro select ─────────────────────────────────────────────────────
  async function refreshMacroList() {
    const files = await window.api.macros.list();
    macroSelect.innerHTML = "";
    for (const f of files) {
      const opt = document.createElement("option");
      opt.value       = f;
      opt.textContent = f;
      macroSelect.appendChild(opt);
    }
    // Keep in sync with name input
    if (files.length > 0 && !nameInput.value) {
      nameInput.value = files[0].replace(/\.json$/, "");
    }
  }

  // ── Load ──────────────────────────────────────────────────────────────────────
  async function loadMacro(filename) {
    try {
      currentMacro = await window.api.macros.load(filename);
      nameInput.value = currentMacro.name || filename.replace(/\.json$/, "");
      renderActions();
      syncRaw();
    } catch (err) {
      alert(`Could not load ${filename}: ${err.message}`);
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function saveMacro() {
    const name = nameInput.value.trim();
    if (!name) { alert("Enter a macro name first"); return; }
    currentMacro.name = name;
    currentMacro.recordedAt = new Date().toISOString();
    const filename = name.endsWith(".json") ? name : `${name}.json`;
    try {
      await window.api.macros.save(filename, currentMacro);
      await refreshMacroList();
      alert(`Saved: ${filename}`);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  }

  // ── Render action list ────────────────────────────────────────────────────────
  function renderActions() {
    actionList.innerHTML = "";
    currentMacro.actions.forEach((act, idx) => {
      const div = document.createElement("div");
      div.className = "action-item";
      div.setAttribute("role", "listitem");
      div.innerHTML = `
        <span class="action-idx">${idx + 1}</span>
        <span class="action-type">${esc(act.type)}</span>
        <span class="action-detail">${actionSummary(act)}</span>
        <button class="btn-del-action" data-idx="${idx}" aria-label="Delete action ${idx + 1}">✕</button>
      `;
      actionList.appendChild(div);
    });
  }

  function actionSummary(act) {
    if (act.type === "mouse") {
      const btn = act.button ? `[${act.button}]` : "";
      return esc(`${act.action} ${btn} (${act.x ?? "?"},${act.y ?? "?"}) holdMs=${act.holdMs ?? 60}`);
    }
    if (act.type === "keyboard") {
      if (act.action === "hotkey") return esc(`hotkey ${(act.keys || []).join("+")}`);
      if (act.action === "text")   return esc(`type "${act.text}"`);
      return esc(act.action);
    }
    if (act.type === "wait") return esc(`${act.duration ?? 0}ms`);
    return esc(JSON.stringify(act));
  }

  // ── Sync raw editor ───────────────────────────────────────────────────────────
  function syncRaw() {
    rawJson.value = JSON.stringify(currentMacro, null, 2);
  }

  // ── Add action ────────────────────────────────────────────────────────────────
  function buildNewAction(type) {
    switch (type) {
      case "mouse-click":
        return { type: "mouse", action: "click", button: "left",
                 x: 0, y: 0, holdMs: 160, delay: 0 };
      case "mouse-right-click":
        return { type: "mouse", action: "click", button: "right",
                 x: 0, y: 0, holdMs: 160, delay: 0 };
      case "keyboard-hotkey":
        return { type: "keyboard", action: "hotkey",
                 keys: ["ctrl", "v"], label: "Ctrl+V", delay: 0 };
      case "keyboard-text":
        return { type: "keyboard", action: "text", text: "", delay: 0 };
      case "wait":
        return { type: "wait", duration: 500, delay: 0 };
      default:
        return { type: "wait", duration: 500, delay: 0 };
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────────

  btnLoad.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) { alert("Enter a macro name to load"); return; }
    const file = name.endsWith(".json") ? name : `${name}.json`;
    await loadMacro(file);
  });

  macroSelect.addEventListener("change", async () => {
    if (macroSelect.value) await loadMacro(macroSelect.value);
  });

  btnNew.addEventListener("click", () => {
    currentMacro = {
      name:       "",
      version:    1,
      recordedAt: null,
      actions:    [],
    };
    nameInput.value = "";
    renderActions();
    syncRaw();
  });

  btnSave.addEventListener("click", saveMacro);

  btnAddAction.addEventListener("click", () => {
    const act = buildNewAction(newActionSel.value);
    currentMacro.actions.push(act);
    renderActions();
    syncRaw();
  });

  // Delete action
  actionList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-idx]");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    currentMacro.actions.splice(idx, 1);
    renderActions();
    syncRaw();
  });

  btnApplyRaw.addEventListener("click", () => {
    try {
      const parsed = JSON.parse(rawJson.value);
      currentMacro = parsed;
      nameInput.value = parsed.name || nameInput.value;
      renderActions();
    } catch (err) {
      alert(`JSON parse error: ${err.message}`);
    }
  });

  btnRecord.addEventListener("click", () => {
    alert(
      "Live recording is driven from the main process.\n\n" +
      "To record a macro:\n" +
      "1. Run: node src/index.js --mode record --name <name>\n" +
      "   in the new_system folder.\n" +
      "2. F9 to stop & save.\n" +
      "3. The JSON will appear in macros/ — click Load to inspect it here."
    );
  });

  // ── Init ──────────────────────────────────────────────────────────────────────
  (async () => {
    await refreshMacroList();
    if (macroSelect.options.length > 0) {
      await loadMacro(macroSelect.options[0].value);
    }
  })();

  // Refresh list when tab becomes active
  document.querySelector('[data-tab="recorder"]').addEventListener("click", refreshMacroList);

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

})();
