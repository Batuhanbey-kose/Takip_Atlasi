const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function main() {
  if (process.platform !== "win32") throw new Error("Portable Windows runtime smoke test requires Windows");
  const version = require("../package.json").version;
  const directory = path.resolve(__dirname, `../dist/Takip-Atlasi-PC-v${version}`);
  const child = spawn(path.join(directory, "runtime/node.exe"), [path.join(directory, "scripts/serve.js")], {
    cwd: directory, windowsHide: true, stdio: "ignore", env: { ...process.env, PORT: "4174", ATLAS_OPEN_BROWSER: "0" },
  });
  try {
    let health;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { health = await (await fetch("http://127.0.0.1:4174/api/instagram/health")).json(); break; }
      catch (error) { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.equal(health.product, "takip-atlasi");
    assert.equal(health.version, version);
    assert.match(await (await fetch("http://127.0.0.1:4174/")).text(), /desktopScanButton/);
    assert.equal((await fetch("http://127.0.0.1:4174/vendor/fflate.js")).status, 200);
    console.log("Bundled Windows Node runtime, PC server and UI assets passed.");
  } finally { child.kill(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
