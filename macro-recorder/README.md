# Macro Recorder

Windows macro recorder and state-machine automation engine built with Node.js.

## Setup

```bash
cd macro-recorder
npm install
```

> **Requires Node 18+** and Windows (nut-js uses native Windows input APIs).

---

## Modes

### 1. Record a macro

```bash
node src/index.js --mode record
# or with a name and mouse movement tracking:
node src/index.js --mode record --name "Login Flow" --movement
```

- A 3-second countdown gives you time to switch to the target window.
- **Ctrl+S** — stop and save the macro to `macros/`.
- **Ctrl+C** — abort without saving.
- Recorded file: `macros/<timestamp>-<name>.json`

---

### 2. Play a macro

```bash
node src/index.js --mode play --file macros/example.json
# play at 2× speed:
node src/index.js --mode play --file macros/example.json --speed 2
```

Options:
| Flag | Default | Description |
|------|---------|-------------|
| `--speed` | `1.0` | Playback speed multiplier (2 = twice as fast) |
| `--mindelay` | `0` | Floor for all delays in ms |

---

### 3. Run state-machine automation

```bash
node src/index.js --mode automation --file macros/form-filler.json
```

The bundled `form-filler.json` example:
1. Reads every line from `data/input.txt`
2. Clicks a field at (742, 381)
3. Selects all → types the line → presses Enter
4. Waits 1.5 s → loops until EOF

---

## File formats

### Macro JSON (`macros/*.json`)

```json
{
  "name": "My Macro",
  "version": 1,
  "actions": [
    { "type": "mouse",    "action": "click",  "button": "left", "x": 742, "y": 381, "delay": 0 },
    { "type": "keyboard", "action": "text",   "text": "Hello",  "delay": 500 },
    { "type": "keyboard", "action": "hotkey", "keys": ["ctrl","v"], "delay": 200 },
    { "type": "mouse",    "action": "scroll", "amount": -3,     "delay": 300 },
    { "type": "wait",     "duration": 1000,   "delay": 0 }
  ]
}
```

Supported action types:

| type | action | extra fields |
|------|--------|--------------|
| `mouse` | `click` | `button` (left/right/middle), `x`, `y` |
| `mouse` | `doubleClick` | `x`, `y` |
| `mouse` | `move` | `x`, `y` |
| `mouse` | `scroll` | `amount` (positive=up, negative=down) |
| `keyboard` | `text` | `text` |
| `keyboard` | `hotkey` | `keys` array e.g. `["ctrl","c"]` |
| `keyboard` | `keydown` | raw hex (auto-recorded, skipped on replay) |
| `wait` | — | `duration` ms |

---

### Automation JSON (`macros/*.json` with `states`)

```json
{
  "start": "START",
  "states": {
    "START":      { "action": "readFile",     "path": "data/input.txt", "next": "CHECK" },
    "CHECK":      { "condition": "checkFileHasNextLine", "ifTrue": "READ", "ifFalse": "DONE" },
    "READ":       { "action": "readNextLine", "next": "TYPE" },
    "TYPE":       { "action": "typeText",     "text": "$currentLine",   "next": "WAIT",
                    "retry": "TYPE", "maxRetries": 2 },
    "WAIT":       { "action": "wait",         "duration": 1000,         "next": "CHECK" },
    "DONE":       { "terminal": true }
  }
}
```

Built-in actions: `readFile`, `readNextLine`, `writeFile`, `appendFile`,
`click`, `doubleClick`, `moveMouse`, `scroll`, `typeText`, `pressKey`,
`hotkey`, `wait`, `stop`

Built-in conditions: `checkFileHasNextLine`, `checkDataEquals`

Special text value `"$currentLine"` is replaced with the last line read by `readNextLine`.

---

## Project structure

```
macro-recorder/
├── src/
│   ├── recorder/
│   │   ├── mouse.js        ← polls mouse position & clicks
│   │   ├── keyboard.js     ← buffers keys → text runs & hotkeys
│   │   └── recorder.js     ← orchestrates recording, saves JSON
│   ├── player/
│   │   ├── mouse.js        ← replays mouse actions
│   │   ├── keyboard.js     ← replays keyboard actions
│   │   └── player.js       ← sequential playback with delay
│   ├── automation/
│   │   ├── stateMachine.js ← drives state-based automation
│   │   ├── fileManager.js  ← read/write/pointer for text files
│   │   └── actions.js      ← all action handlers
│   └── index.js            ← CLI entry point
├── macros/
│   ├── example.json        ← sample recorded macro
│   └── form-filler.json    ← sample automation
├── data/
│   └── input.txt           ← sample input data
└── package.json
```

## State machine flow

```
IDLE → RECORDING → SAVED        (record mode)
IDLE → RUNNING → WAITING → COMPLETED  (play / automation)

Custom automation states:
START → READ_FILE → CHECK_LINE
          ├── hasNext → READ_NEXT → CLICK → TYPE → SUBMIT → WAIT → CHECK_LINE
          └── empty  → DONE
```
