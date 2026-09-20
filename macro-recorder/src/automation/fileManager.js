"use strict";
/**
 * automation/fileManager.js
 * Handles all file I/O — read, write, append, CSV, JSON, line-by-line pointer.
 */

const fs   = require("fs/promises");
const path = require("path");

class FileManager {
  // ------------------------------------------------------------------ static helpers
  static async ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
  }

  static async readJSON(filepath) {
    const txt = await fs.readFile(filepath, "utf8");
    return JSON.parse(txt);
  }

  static async writeJSON(filepath, data) {
    await fs.writeFile(filepath, JSON.stringify(data, null, 2), "utf8");
  }

  static async readText(filepath) {
    return fs.readFile(filepath, "utf8");
  }

  static async writeText(filepath, text) {
    await fs.writeFile(filepath, text, "utf8");
  }

  static async appendText(filepath, text) {
    await fs.appendFile(filepath, text, "utf8");
  }

  static async readLines(filepath) {
    const txt = await fs.readFile(filepath, "utf8");
    return txt.split(/\r?\n/).filter((l) => l.trim() !== "");
  }

  /** Parse a simple CSV into an array of row arrays. */
  static async readCSV(filepath) {
    const lines = await FileManager.readLines(filepath);
    return lines.map((l) => l.split(",").map((c) => c.trim()));
  }

  // ------------------------------------------------------------------ instance: line pointer
  constructor(filepath) {
    this.filepath = filepath;
    this._lines   = null;
    this._pointer = 0;
  }

  async load() {
    this._lines   = await FileManager.readLines(this.filepath);
    this._pointer = 0;
    return this;
  }

  get hasNextLine() {
    return this._lines !== null && this._pointer < this._lines.length;
  }

  get currentLine() {
    return this._lines?.[this._pointer] ?? null;
  }

  get lineCount() {
    return this._lines?.length ?? 0;
  }

  get pointer() {
    return this._pointer;
  }

  nextLine() {
    if (!this.hasNextLine) return null;
    return this._lines[this._pointer++];
  }

  peekLine() {
    return this._lines?.[this._pointer] ?? null;
  }

  reset() {
    this._pointer = 0;
  }

  seek(index) {
    if (index < 0 || index >= this._lines.length) throw new RangeError(`Line index ${index} out of range`);
    this._pointer = index;
  }

  async replaceLine(index, newText) {
    if (!this._lines) throw new Error("File not loaded");
    this._lines[index] = newText;
    await FileManager.writeText(this.filepath, this._lines.join("\n") + "\n");
  }

  async appendLine(text) {
    if (!this._lines) throw new Error("File not loaded");
    this._lines.push(text);
    await FileManager.appendText(this.filepath, text + "\n");
  }
}

module.exports = FileManager;
