"use strict";
/**
 * renderer/tabs/queue.js — Tab 0: Task Queue
 *
 * Responsibilities:
 *  - Load and display queue items with current status
 *  - Import a new queue.json file
 *  - Filter/search the table
 *  - Reset failed items
 *  - "Start from ID" action
 *  - Refresh stats bar
 */

(function initQueueTab() {

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const tbody          = document.getElementById("queue-tbody");
  const searchInput    = document.getElementById("queue-search");
  const statusFilter   = document.getElementById("queue-filter-status");
  const btnImport      = document.getElementById("btn-import-queue");
  const fileInput      = document.getElementById("queue-file-input");
  const btnRefresh     = document.getElementById("btn-refresh-queue");
  const btnResetFailed = document.getElementById("btn-reset-failed");
  const btnStartFrom   = document.getElementById("btn-start-from");
  const startFromInput = document.getElementById("start-from-input");

  // Stats
  const statTotal   = document.getElementById("stat-total");
  const statPending = document.getElementById("stat-pending");
  const statDone    = document.getElementById("stat-done");
  const statFailed  = document.getElementById("stat-failed");

  // ── State ───────────────────────────────────────────────────────────────────
  let allItems = [];

  // ── Load ─────────────────────────────────────────────────────────────────────
  async function load() {
    try {
      allItems = await window.api.queue.load();
      renderTable();
      await refreshStats();
    } catch (err) {
      console.error("queue:load error", err);
    }
  }

  async function refreshStats() {
    try {
      const stats = await window.api.queue.stats();
      statTotal.textContent   = stats.total   ?? 0;
      statPending.textContent = stats.pending ?? 0;
      statDone.textContent    = stats.done    ?? 0;
      statFailed.textContent  = stats.failed  ?? 0;
    } catch (_) {}
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function renderTable() {
    const q      = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;

    const filtered = allItems.filter((item) => {
      if (status && item.status !== status) return false;
      if (q) {
        return (
          String(item.id).includes(q) ||
          item.path.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q)
        );
      }
      return true;
    });

    tbody.innerHTML = "";
    for (const item of filtered) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.id}</td>
        <td>${esc(item.name)}</td>
        <td style="font-family:var(--mono);font-size:11px">${esc(item.path)}</td>
        <td><span class="badge badge-${item.status}">${item.status}</span></td>
        <td style="color:var(--text-dim);font-size:11px">${esc(item.reason || "")}</td>
        <td>
          ${item.status !== "done"
            ? `<button class="btn btn-ghost btn-xs" data-action="reset" data-id="${item.id}">Reset</button>`
            : ""}
        </td>
      `;
      tbody.appendChild(tr);
    }

    if (filtered.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="6" style="color:var(--text-dim);text-align:center;padding:20px">No items match the filter.</td>`;
      tbody.appendChild(tr);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────────

  searchInput.addEventListener("input",  renderTable);
  statusFilter.addEventListener("change", renderTable);

  btnRefresh.addEventListener("click", load);

  btnImport.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const text = await file.text();
    const result = await window.api.queue.import(text);
    if (result.ok) {
      fileInput.value = "";
      await load();
    } else {
      alert(`Import failed:\n${result.error}`);
    }
  });

  btnResetFailed.addEventListener("click", async () => {
    const count = await window.api.queue.resetFailed();
    await load();
    alert(`Reset ${count} failed item(s) to pending.`);
  });

  btnStartFrom.addEventListener("click", async () => {
    const id = parseInt(startFromInput.value, 10);
    if (isNaN(id)) { alert("Enter a valid numeric ID"); return; }
    await window.api.runner.startFrom(id);
    // Switch to runner tab
    document.querySelector('[data-tab="runner"]').click();
  });

  // Per-row reset button
  tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='reset']");
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    await window.api.queue.resetItem(id);
    await load();
  });

  // Refresh queue table after runner finishes an item
  window.api.on.runnerEvent(({ type }) => {
    if (["item-done", "item-failed", "finished"].includes(type)) {
      load();
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────────
  load();

  // Reload when tab becomes active
  document.querySelector('[data-tab="queue"]').addEventListener("click", load);

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

})();
