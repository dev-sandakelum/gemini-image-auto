/**
 * count-server.js
 *
 * Standalone HTTP server that counts image files inside data/output-img/
 * (recursively) and returns the result to the browser extension.
 *
 * Usage:
 *   node count-server.js
 *   node count-server.js --port 7843 --imgdir data/output-img
 *
 * Endpoints:
 *   GET /count  →  { "count": 24 }
 */

"use strict";

const http = require("http");
const fs   = require("fs");
const path = require("path");

// ── arg parse ────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT    = parseInt(arg("port", "7843"), 10);
const IMG_DIR = path.resolve(arg("imgdir", path.join(__dirname, "data", "output-img")));

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"]);

// ── helpers ──────────────────────────────────────────────────────────────────
function countImages(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return count;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countImages(path.join(dir, entry.name));
    } else if (entry.isFile() && IMG_EXTS.has(path.extname(entry.name).toLowerCase())) {
      count++;
    }
  }
  return count;
}

// ── server ───────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS — allow the extension (any origin) to call this
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  // Pre-flight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/count") {
    const count = countImages(IMG_DIR);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ count }));
    console.log(`[count-server] GET /count  →  ${count}  (${IMG_DIR})`);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[count-server] running on http://127.0.0.1:${PORT}`);
  console.log(`[count-server] counting  : ${IMG_DIR}`);
  console.log(`[count-server] endpoint  : GET http://127.0.0.1:${PORT}/count`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[count-server] Port ${PORT} is already in use. Try --port <other>`);
  } else {
    console.error(`[count-server] Error: ${err.message}`);
  }
  process.exit(1);
});
