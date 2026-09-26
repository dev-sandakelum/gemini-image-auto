// Run once to generate all PNG sizes from icon.svg
// Usage: node generate-icons.mjs
//
// Requires: npm install sharp
// (or: npm install -g sharp-cli  →  npx sharp-cli ...)

import sharp from "sharp";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const svg   = readFileSync(join(__dir, "icon.svg"));

const sizes = [16, 32, 48, 128];

await Promise.all(
  sizes.map((size) =>
    sharp(svg)
      .resize(size, size)
      .png()
      .toFile(join(__dir, `icon${size}.png`))
      .then(() => console.log(`✓ icon${size}.png`))
  )
);

console.log("All icons generated.");
