# gemini-image-auto — Upgrade Plan (Bulk Image Generation + GUI)

## 1. Goal

Turn the current headless macro-recorder + Chrome extension setup into a single
Electron GUI app that:

- Records/edits macros visually (no manual JSON editing)
- Drives bulk image generation from a flat **task queue** (`queue.json`) instead
  of per-product macro files
- Downloads and sorts images automatically using the queue's own `path`/`name`
- Needs **no Chrome extension** — prompt injection and image saving are both
  done by the Electron app itself via clicks/paste, same as the existing
  macro player already does

---

## 2. Current system (before)

```
macro-recorder/
├── src/
│   ├── watcher.js       # polls for new images, drives macro sequence
│   ├── sorter.js        # pattern-matches filenames to guess category folder
│   ├── logger.js
│   └── player/           # plays back recorded macro JSON (mouse/keyboard)
├── macros/                # hand-written JSON action sequences
├── count-server.js        # HTTP server, exposes /count
└── product.json            # one file per product category, hand-maintained

vertex-collector/            # Chrome extension — scrapes prompt off page
vertex-collector_gpt/        # Chrome extension — same, for ChatGPT, polls /count
```

Problems this upgrade removes:
- Prompt text lived on the webpage → needed an extension to read it
- `product.json` was per-category → didn't scale to bulk/mixed runs
- `sorter.js` guessed the destination folder from filename patterns
- No visual way to build/edit macros — hand-written JSON only
- No resumable progress — a crash mid-run meant starting over

---

## 3. New system (after)

```
macro-recorder/
├── gui/                                 # NEW — Electron app
│   ├── main.js                          # Electron main process, window setup
│   ├── preload.js                       # IPC bridge (contextBridge)
│   └── renderer/
│       ├── index.html
│       ├── tabs/
│       │   ├── queue.js                 # Tab 0 — task queue import/status
│       │   ├── recorder.js              # Tab 1 — visual macro builder
│       │   └── runner.js                # Tab 2 — run + live log
│       └── styles.css
│
├── src/
│   ├── player/                          # KEEP — existing macro playback engine
│   ├── engine/
│   │   ├── queue-runner.js              # NEW — walks queue.json, runs pipeline per item
│   │   ├── paste-prompt.js              # NEW — clipboard.writeText + Ctrl+V macro
│   │   └── sort-file.js                 # NEW — move/rename saved file to output/<path>/<name>
│   └── logger.js                        # KEEP as-is
│
├── macros/                              # KEEP — recorded click/wait/key sequences
│   ├── press_enter.json
│   ├── click_prompt_box.json
│   └── click_save_as_image.json
│
├── pipeline.json                        # NEW — single fixed pipeline (see §5)
├── queue.json                           # NEW — flat task list (see §4)
├── queue-state.json                     # NEW — per-id status, resumable
├── downloads/                           # OS download target (temp landing spot)
├── output/                              # final sorted images, by <path>/<name>
└── package.json
```

### Retired entirely
| Component | Reason |
|---|---|
| `vertex-collector/` | Prompt now comes from `queue.json`, not the page |
| `vertex-collector_gpt/` | Same — no page-scraping needed |
| `count-server.js` | No external consumer left; queue position is tracked in-app |
| `product.json` (per category) | Replaced by single flat `queue.json` |
| `sorter.js` pattern-matching | Replaced by direct `path` field on each queue item |
| Per-product pipeline files / retry-chain macros | Replaced by one fixed `pipeline.json` + skip-and-flag on failure |

---

## 4. Task Queue — `queue.json`

Flat list, any number of products/categories mixed together. Each image is its
own entry — a 5-image product is just 5 entries sharing the same `path`.

```json
[
  {
    "id": 1,
    "name": "01-main.jpg",
    "path": "ram/volt/32gb-ddr5-5600mhz-kit-2x16",
    "prompt": "Professional product photo of Volt 32GB DDR5 5600MHz ..."
  },
  {
    "id": 2,
    "name": "02-side.jpg",
    "path": "ram/volt/32gb-ddr5-5600mhz-kit-2x16",
    "prompt": "..."
  },
  {
    "id": 3,
    "name": "01-main.jpg",
    "path": "cpu-cooler/deepcool/ak620",
    "prompt": "..."
  }
]
```

**Fields (all required):** `id` (unique int), `name` (output filename),
`path` (output folder, relative to `output/`), `prompt` (full prompt text).

**Progress** is tracked separately so re-importing an updated `queue.json`
(e.g. adding more products later) never wipes existing progress:

```json
// queue-state.json — keyed by id
{
  "1": { "status": "done" },
  "2": { "status": "failed", "reason": "timeout" },
  "3": { "status": "pending" }
}
```

Statuses: `pending` → `running` → `done` | `failed`.

---

## 5. Pipeline — `pipeline.json`

One fixed pipeline, applied to every queue item in order. No per-product
variants, no retry-chain macros — a failed item is flagged and skipped so the
batch keeps moving.

```json
{
  "name": "bulk-image-gen",
  "steps": [
    { "action": "click",           "macro": "click_prompt_box.json" },
    { "action": "paste_prompt",    "source": "queue.prompt" },
    { "action": "submit",          "macro": "press_enter.json" },
    { "action": "wait_generation", "timeoutMs": 15000, "onTimeout": "skip_and_flag" },
    { "action": "save_image",      "macro": "click_save_as_image.json" },
    { "action": "sort_to",         "target": "queue.path", "rename": "queue.name" }
  ]
}
```

**Action reference:**
| Action | What it does |
|---|---|
| `click` / `submit` / `save_image` | Plays an existing recorded macro (mouse/keyboard), same format as today |
| `paste_prompt` | `clipboard.writeText(item.prompt)` then sends `Ctrl+V` into the focused field |
| `wait_generation` | Polls for the generated image to appear; on timeout, marks item `failed` with reason `"timeout"` and moves on — no retry loop |
| `sort_to` | Watches the OS downloads folder briefly after the save-click, moves the new file to `output/<item.path>/<item.name>` |

---

## 6. GUI Tabs

### Tab 0 — Queue
- Import/validate `queue.json` (checks required fields + unique `id`)
- Table: `id | name | path | status`, filterable by path prefix or status
- "Start from id" + "Run selected / Run failed only"
- Export current state

### Tab 1 — Recorder
- Unchanged from original plan: drag-to-build action list (click, key, wait,
  scroll, type), live record via global hook, save to `macros/<name>.json`
- This is how you (re-)record `click_prompt_box.json`, `press_enter.json`,
  `click_save_as_image.json`

### Tab 2 — Runner
- Shows queue position (`22 / 340`), current item id/path/name, current step,
  status, scrollable colour-coded log
- Play / Pause / Stop, speed multiplier, interval between items
- No broadcast HTTP server needed — everything is in-process now

---

## 7. Dependencies

| Package | Purpose |
|---|---|
| `electron` | GUI shell |
| `uiohook-napi` | Global mouse/keyboard hook, for live macro recording |
| `@nut-tree/nut-js` (or `robotjs`, whichever the existing `player/` already uses) | Programmatic mouse/keyboard control for playback |
| `electron-store` | Persist `queue-state.json` / app settings |
| `chokidar` | Watch the downloads folder for the newly saved image in `sort_to` |
| `fs-extra` | Move/rename files into `output/<path>/<name>` with auto-mkdir |

No new server/HTTP dependency — `count-server.js`/`api-server.js` and its
whole broadcast layer are dropped.

---

## 8. Open items to confirm before/while building

1. **Downloads folder path** — is it the OS default (`~/Downloads`) or a
   custom location set in the browser? `sort_to` needs the exact path to watch.
2. **"Save as image" ambiguity** — if the click sometimes opens a save dialog
   (needs a filename/Enter) vs. saves directly, that's one more small macro
   step to record (`confirm_save_dialog.json`).
3. **Generation-done detection** — currently timeout-only (§5). If there's a
   reliable visual cue (thumbnail appears, spinner disappears) that could
   replace the fixed 15s timeout later, but timeout is enough to start.

---

## 9. Implementation order

1. `queue.json` + `queue-state.json` loader/validator (no UI) — test standalone
2. `paste-prompt.js` + `sort-file.js` in `src/engine/` — test standalone against one manual queue item
3. Queue tab (import, table, status)
4. Runner tab, wired to `queue-runner.js` walking the queue with `pipeline.json`
5. Recorder tab (re-record the 3 core macros through the new GUI)
6. Remove `vertex-collector/`, `vertex-collector_gpt/`, `count-server.js`, old `product.json` files, retry-chain macros
