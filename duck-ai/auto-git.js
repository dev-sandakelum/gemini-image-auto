// auto-git.js
const { exec } = require("child_process");

const INTERVAL_SEC = 30;
const isTTY = process.stdout.isTTY;

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }
      resolve(stdout.trim());
    });
  });
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function clearLine() {
  if (isTTY) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
  }
}

function log(msg) {
  clearLine();
  console.log(`[${new Date().toLocaleString()}] ${msg}`);
}

async function autoCommit() {
  try {
    await run("git add img");

    // Check what is actually staged
    const staged = await run("git diff --cached --name-only");
    if (!staged) {
      log("No changes to commit, skipping.");
      return;
    }

    const code = timestamp();
    log(`Committing ${staged.split("\n").length} file(s): auto-commit ${code}`);
    await run(`git commit -m "auto-commit ${code}"`);

    log("Pushing...");
    await run("git push -u origin HEAD");

    log(`Done: auto-commit ${code} pushed successfully.`);
  } catch (err) {
    const details = [err.stderr, err.stdout, err.message]
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .join("\n");
    log(`Error: ${details}`);
  }
}

function countdown(seconds) {
  return new Promise((resolve) => {
    let remaining = seconds;

    const draw = () => {
      if (!isTTY) return;
      clearLine();
      process.stdout.write(`Next run in ${String(remaining).padStart(2, "0")}s...`);
    };

    draw();
    const timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        clearLine();
        resolve();
        return;
      }
      draw();
    }, 1000);
  });
}

async function main() {
  console.log("Auto git started. Press Ctrl+C to stop.\n");

  while (true) {
    await autoCommit();
    await countdown(INTERVAL_SEC);
  }
}

main();