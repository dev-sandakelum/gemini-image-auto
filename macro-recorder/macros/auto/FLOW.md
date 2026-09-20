# Automation Flow — `macros/auto/`

## Overview

The watcher (`src/watcher.js`) polls `data/output-img/` every second.
When a new image is detected it runs the full cycle below.

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        POLL TICK (every 1s)                     │
└─────────────────────────────────────┬───────────────────────────┘
                                      │
                         count images in output-img/
                         read count.txt
                                      │
                    ┌─────────────────▼─────────────────┐
                    │   images  >  count.txt ?           │
                    └──────┬──────────────────┬──────────┘
                          NO                 YES
                           │                  │
                     (idle spinner)           │
                                   ┌──────────▼──────────────────┐
                                   │  write imgCount → count.txt │
                                   │  (crash-safe, done first)   │
                                   └──────────┬──────────────────┘
                                              │
                                   ┌──────────▼──────────────────┐
                                   │   CLEAN data/queue/         │
                                   │   (delete leftover images)  │
                                   └──────────┬──────────────────┘
                                              │
                                   ┌──────────▼──────────────────┐
                                   │   1.add_prompt.json         │
                                   │                             │
                                   │  • click prompt field       │
                                   │  • Ctrl+V  (paste text)     │
                                   │  • click submit             │
                                   │  • wait 20s (AI generates)  │
                                   │  • click next/continue      │
                                   └──────────┬──────────────────┘
                                              │
                                   ┌──────────▼──────────────────┐
                                   │   2.download_image.json     │
                                   │                             │
                                   │  • click image area         │
                                   │  • End ×3 (scroll to end)   │
                                   │  • right-click image        │
                                   │  • click "Save image as"    │
                                   │  • click Save in dialog     │
                                   └──────────┬──────────────────┘
                                              │
                                   ┌──────────▼──────────────────┐
                                   │   check  data/queue/        │
                                   └──────┬───────────┬──────────┘
                                         │             │
                                    IMAGE FOUND    QUEUE EMPTY
                                         │             │
                              ┌──────────▼──┐    ┌─────▼────────────────────────┐
                              │ move image  │    │  RETRY LOOP                  │
                              │ queue/ →    │    │                              │
                              │ temp/       │    │  ┌─────────────────────────┐ │
                              └──────┬──────┘    │  │  4.exit.json            │ │
                                     │           │  │  • click exit/close btn │ │
                              ┌──────▼──────┐    │  │  • End key ×2           │ │
                              │ 3.next.json │    │  └────────────┬────────────┘ │
                              │             │    │               │              │
                              │ • wait 1.6s │    │  ┌────────────▼────────────┐ │
                              │ • click Next│    │  │  5.wait.json            │ │
                              └──────┬──────┘    │  │  • wait 10s             │ │
                                     │           │  │  • wait 1.6s            │ │
                              ┌──────▼──────┐    │  │  • click Next           │ │
                              │  CYCLE DONE │    │  └────────────┬────────────┘ │
                              │  wait for   │    │               │              │
                              │  next poll  │    │  ┌────────────▼────────────┐ │
                              └─────────────┘    │  │  2.download_image.json  │ │
                                                 │  │  (try download again)   │ │
                                                 │  └────────────┬────────────┘ │
                                                 │               │              │
                                                 │  check queue again ──────────┘
                                                 │  (loop until image appears)
                                                 └──────────────────────────────┘
```

---

## Macro Files

| File | Purpose | Key actions |
|---|---|---|
| `1.add_prompt.json` | Paste prompt and submit to AI | click field → Ctrl+V → submit → wait 20s → continue |
| `2.download_image.json` | Right-click save the generated image | click image → End ×3 → right-click → Save As → confirm |
| `3.next.json` | Advance to next item after success | wait 1.6s → click Next |
| `4.exit.json` | Close/dismiss current dialog on retry | click exit → End ×2 |
| `5.wait.json` | Wait for AI before retrying download | wait 10s → click Next |

---

## Data Folders

| Folder | Role |
|---|---|
| `data/output-img/` | Watched folder — image count triggers the cycle |
| `data/queue/` | Cleared before each cycle; download lands here |
| `data/temp/` | Confirmed images moved here for `sorter.js` to process |
| `data/count.txt` | Stores last known image count — written **before** macros run |

---

## Execution Order (happy path)

```
1.add_prompt  →  2.download_image  →  [image in queue]  →  move to temp  →  3.next  →  DONE
```

## Execution Order (retry path)

```
1.add_prompt  →  2.download_image  →  [queue empty]
  →  4.exit  →  5.wait  →  2.download_image  →  [queue empty]
  →  4.exit  →  5.wait  →  2.download_image  →  [image found]
  →  move to temp  →  3.next  →  DONE
```

---

## Click Positions (1920 × 1080)

### 1.add_prompt.json

| Step | Button | X | Y | Hold |
|---|---|---|---|---|
| 1 | Left | 641 | 967 | 160ms |
| 2 | Left | 357 | 921 | 160ms |
| 3 | Left | 357 | 921 | 160ms |
| 4 | Left | 357 | 921 | 160ms |
| 5 | `Ctrl+V` | — | — | — |
| 6 | Left | 996 | 911 | 120ms |
| 7 | Left | 796 | 965 | 160ms |

### 2.download_image.json

| Step | Button | X | Y | Hold |
|---|---|---|---|---|
| 1 | Left | 141 | 450 | 160ms |
| 2 | `End` ×3 | — | — | — |
| 3 | Right | 320 | 556 | 160ms |
| 4 | Left | 379 | 633 | 160ms |
| 5 | Left | 600 | 585 | 160ms |

### 3.next.json

| Step | Button | X | Y | Hold |
|---|---|---|---|---|
| 1 | Left | 796 | 965 | 160ms |

### 4.exit.json

| Step | Button | X | Y | Hold |
|---|---|---|---|---|
| 1 | Left | 1077 | 881 | 160ms |
| 2 | `End` ×1 | — | — | — |

### 5.wait.json

| Step | Button | X | Y | Hold |
|---|---|---|---|---|
| 1 | Left | 796 | 965 | 160ms |

---

> See `click-demo.html` for the interactive visual preview of all click positions.
