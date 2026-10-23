"use strict";
/**
 * src/engine/sort-file.js
 *
 * Watches the OS downloads folder for a newly appeared image file, then
 * moves it to:   output/<item.path>/<item.name>
 *
 * The watcher starts just before the save-image macro fires and stops as soon
 * as the file is confirmed moved (or the timeout is hit).
 */

const path    = require("path");
const fse     = require("fs-extra");
const chokidar = require("chokidar");
const log     = require("../logger");

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"]);

/**
 * Move the next new image that lands in downloadsDir to
 * outputRoot/<itemPath>/<itemName>, then resolve with the destination path.
 *
 * @param {object}  opts
 * @param {string}  opts.downloadsDir   Folder to watch (OS Downloads)
 * @param {string}  opts.outputRoot     Base output folder (new_system/output)
 * @param {string}  opts.itemPath       queue item's `path` field, e.g. "gpus/nova-rtx-9090"
 * @param {string}  opts.itemName       queue item's `name` field, e.g. "main.jpg"
 * @param {number}  [opts.timeoutMs=10000]   Give up after this many ms
 * @returns {Promise<string>}  Resolved destination path
 */
async function sortFile({ downloadsDir, outputRoot, itemPath, itemName, timeoutMs = 10000 }) {
  if (!fse.existsSync(downloadsDir)) {
    throw new Error(`Downloads folder not found: ${downloadsDir}`);
  }

  const destDir  = path.join(outputRoot, itemPath);
  const destFile = path.join(destDir, itemName);

  log.info(`Watching for new image in: ${downloadsDir}`);
  log.info(`Destination: output/${itemPath}/${itemName}`);

  // Snapshot of files already present so we only react to new arrivals
  const existingFiles = new Set(
    fse.readdirSync(downloadsDir).map((f) => path.join(downloadsDir, f))
  );

  return new Promise((resolve, reject) => {
    let settled = false;

    const watcher = chokidar.watch(downloadsDir, {
      persistent:  true,
      ignoreInitial: true,
      depth:       0,
      awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 100 },
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        watcher.close();
        reject(new Error(`sort-file: no new image appeared in ${timeoutMs}ms`));
      }
    }, timeoutMs);

    watcher.on("add", async (filePath) => {
      if (settled) return;
      if (existingFiles.has(filePath)) return; // pre-existing file
      const ext = path.extname(filePath).toLowerCase();
      if (!IMG_EXTS.has(ext)) return; // not an image

      settled = true;
      clearTimeout(timer);
      watcher.close();

      log.info(`New image detected: ${path.basename(filePath)}`);

      try {
        await fse.ensureDir(destDir);

        // Back up any existing file at the destination
        if (fse.existsSync(destFile)) {
          const backup = `${destFile}.bak-${Date.now()}`;
          await fse.move(destFile, backup);
          log.warn(`Backed up existing file → ${path.basename(backup)}`);
        }

        await fse.move(filePath, destFile, { overwrite: false });
        log.ok(`Moved → output/${itemPath}/${itemName}`);
        resolve(destFile);
      } catch (err) {
        reject(new Error(`sort-file move failed: ${err.message}`));
      }
    });

    watcher.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`sort-file watcher error: ${err.message}`));
      }
    });
  });
}

module.exports = { sortFile };
