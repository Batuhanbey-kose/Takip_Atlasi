const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { unzipSync, zipSync } = require("fflate");

const root = path.resolve(__dirname, "..");
const version = require("../package.json").version;
const runtimeVersion = "22.23.3";
const runtimeHash = "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71";
const archivePath = path.join(root, `dist/node-v${runtimeVersion}-win-x64.zip`);
const destination = path.join(root, `dist/Takip-Atlasi-PC-v${version}`);

async function build() {
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  let runtime = fs.existsSync(archivePath) ? fs.readFileSync(archivePath) : null;
  if (!runtime || createHash("sha256").update(runtime).digest("hex") !== runtimeHash) {
    const response = await fetch(`https://nodejs.org/dist/v${runtimeVersion}/node-v${runtimeVersion}-win-x64.zip`);
    if (!response.ok) throw new Error("Windows Node runtime could not be downloaded");
    runtime = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(runtime).digest("hex") !== runtimeHash) throw new Error("Windows Node runtime checksum mismatch");
    fs.writeFileSync(archivePath, runtime);
  }
  if (fs.existsSync(destination) && !fs.existsSync(path.join(destination, ".atlas-pc-build"))) {
    throw new Error("PC output directory contains unfamiliar files");
  }
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, ".atlas-pc-build"), version);
  fs.cpSync(path.join(root, "www"), path.join(destination, "www"), { recursive: true });
  fs.mkdirSync(path.join(destination, "scripts"), { recursive: true });
  for (const script of ["serve.js", "instagram-desktop.js", "desktop-enrichment.js"]) {
    fs.copyFileSync(path.join(root, "scripts", script), path.join(destination, "scripts", script));
  }
  fs.mkdirSync(path.join(destination, "shared"), { recursive: true });
  for (const asset of ["instagram-collector.js", "instagram-web-observer.js"]) {
    fs.copyFileSync(path.join(root, "android/app/src/main/assets", asset), path.join(destination, "shared", asset));
  }
  fs.mkdirSync(path.join(destination, "node_modules"), { recursive: true });
  fs.cpSync(path.join(root, "node_modules/playwright-core"), path.join(destination, "node_modules/playwright-core"), { recursive: true });
  fs.writeFileSync(path.join(destination, "package.json"), JSON.stringify({ name: "takip-atlasi-pc", version, private: true }));
  fs.copyFileSync(path.join(root, "scripts/pc-launcher.bat"), path.join(destination, "Takip-Atlasi-PC.bat"));
  fs.mkdirSync(path.join(destination, "runtime"), { recursive: true });
  const entries = unzipSync(runtime, { filter: (entry) => /\/(?:node\.exe|LICENSE)$/.test(entry.name) });
  for (const [name, bytes] of Object.entries(entries)) {
    fs.writeFileSync(path.join(destination, "runtime", path.basename(name)), bytes);
  }
  fs.writeFileSync(path.join(destination, "KULLANIM.txt"), "ZIP'in tamamini bir klasore cikart ve Takip-Atlasi-PC.bat dosyasina cift tikla.\r\nEdge veya Chrome kurulu olmali. Node/npm kurmana gerek yok.\r\nGiris acilan gercek Instagram penceresindedir; sonra uygulamada Listeleri tara dugmesine bas.\r\nListeler 12 hesaplik sayfalarla, temkinli araliklarla okunur. Profil sayaclari birer birer hazirlanir.\r\nEksik liste olursa sinirli analiz uyarisini kontrol et. Yildizli hesaplarini saklayabilir ve filtrelenmis listenin tamamini kopyalayabilirsin.\r\n");
  const files = {};
  const collect = (directory, relative = "") => {
    for (const name of fs.readdirSync(directory)) {
      const filePath = path.join(directory, name);
      const entry = relative ? `${relative}/${name}` : name;
      if (fs.statSync(filePath).isDirectory()) collect(filePath, entry);
      else files[`Takip-Atlasi-PC/${entry}`] = new Uint8Array(fs.readFileSync(filePath));
    }
  };
  collect(destination);
  const zip = zipSync(files, { level: 6 });
  const output = path.join(root, "dist/Takip-Atlasi-PC.zip");
  fs.writeFileSync(output, zip);
  fs.writeFileSync(`${output}.sha256`, `${createHash("sha256").update(zip).digest("hex")}  Takip-Atlasi-PC.zip\n`);
  console.log(`PC package ready: ${output}`);
}

build().catch((error) => { console.error(error.message); process.exitCode = 1; });
