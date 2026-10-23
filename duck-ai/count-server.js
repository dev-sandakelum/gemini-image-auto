"use strict";
/**
 * duck-ai/count-server.js
 *
 * Counts image files in img/ recursively and serves the count over HTTP.
 * The browser extension polls GET /count — when the number increments,
 * it knows the sorter processed the last image and submits the next prompt.
 *
 * Usage:
 *   node count-server.js
 *   node count-server.js --port 7843 --imgdir img
 *
 * Endpoints:
 *   GET /count  →  { "count": 12 }
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return (i !== -1 && process.argv[i+1]) ? process.argv[i+1] : fallback;
}

const PORT    = parseInt(arg("port",   "7843"), 10);
const IMG_DIR = path.resolve(arg("imgdir", path.join(__dirname, "img")));
const IMG_EXTS = new Set([".jpg",".jpeg",".png",".gif",".webp",".bmp",".tiff",".tif"]);

function countImages(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return n;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countImages(path.join(dir, e.name));
    else if (e.isFile() && IMG_EXTS.has(path.extname(e.name).toLowerCase())) n++;
  }
  return n;
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/count") {
    const count = countImages(IMG_DIR);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ count }));
    process.stdout.write(`\r  /count → ${String(count).padStart(4)}   ${new Date().toLocaleTimeString()}   `);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  [count-server] http://127.0.0.1:${PORT}/count`);
  console.log(`  [count-server] counting: ${IMG_DIR}\n`);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE")
    console.error(`  [count-server] Port ${PORT} already in use. Try --port <N>`);
  else
    console.error(`  [count-server] ${e.message}`);
  process.exit(1);
});
