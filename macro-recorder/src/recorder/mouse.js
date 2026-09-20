"use strict";
/**
 * recorder/mouse.js
 * No longer used by recorder.js (iohook handles all mouse events directly).
 * Kept as a stub so existing imports don't break.
 */
class MouseRecorder {
  constructor() {}
  start() {}
  stop()  {}
  flush() { return []; }
  push()  {}
}
module.exports = MouseRecorder;
