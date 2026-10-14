const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const desktop = require("./instagram-desktop.js");

const root = path.resolve(__dirname, "../www");
const port = Number(process.env.PORT) || 4173;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function api(request, response, url) {
  const port = request.socket.localPort;
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(request.headers.host) ||
    (request.headers.origin && !allowedHosts.some((host) => request.headers.origin === `http://${host}`)) ||
    request.headers["sec-fetch-site"] === "cross-site") {
    json(response, 403, { message: "Yalnızca bu bilgisayardaki uygulama bağlantısı kabul edilir." });
    return;
  }
  try {
    const action = url.pathname.slice("/api/instagram/".length);
    if (request.method === "GET") {
      if (action === "health") return json(response, 200, { available: desktop.available, product: "takip-atlasi", version: require("../package.json").version });
      if (action === "status") return json(response, 200, await desktop.status());
      if (action === "result") return json(response, 200, desktop.readResult(url.searchParams.get("relationship"), Number(url.searchParams.get("offset")), Number(url.searchParams.get("limit")) || 250));
      if (action.startsWith("photo/")) {
        const photo = desktop.photo(action.slice("photo/".length));
        if (!photo) return response.writeHead(404).end();
        response.writeHead(200, { "Content-Type": photo.contentType, "Content-Length": photo.bytes.length,
          "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
        return response.end(photo.bytes);
      }
    } else if (request.method === "POST" && String(request.headers["content-type"]).startsWith("application/json")) {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > (action === "photos" ? 128 * 1024 : 4096)) { json(response, 413, { message: "İstek çok büyük." }); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (action === "start") return json(response, 200, desktop.start(body));
      if (action === "scan") return json(response, 200, await desktop.beginScan());
      if (action === "metadata") return json(response, 200, await desktop.requestMetadata(body.records));
      if (action === "photos") return json(response, 200, await desktop.requestPhotos(body.records));
      if (action === "cancel-enrichment") { await desktop.cancelEnrichment(); return json(response, 200, {}); }
      if (action === "cancel") { await desktop.cancel(); return json(response, 200, {}); }
      if (action === "clear-result") { desktop.clearResult(); return json(response, 200, {}); }
      if (action === "clear-session") { await desktop.close(); return json(response, 200, {}); }
    }
    json(response, 404, { message: "PC bağlantı işlemi bulunamadı." });
  } catch (error) {
    json(response, 409, { code: error.code || "PC_REQUEST_FAILED", message: error.code ? error.message : "PC bağlantı isteği tamamlanamadı.", data: error.data || {} });
  }
}

const server = http.createServer((request, response) => {
  let url;
  try { url = new URL(request.url, "http://localhost"); }
  catch (error) { response.writeHead(400).end(); return; }
  if (url.pathname.startsWith("/api/instagram/")) {
    api(request, response, url).catch(() => json(response, 500, { message: "PC bağlantı işlemi tamamlanamadı." }));
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end();
    return;
  }
  let file;
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  } catch (error) {
    response.writeHead(400).end();
    return;
  }
  if (!file.startsWith(`${root}${path.sep}`) || !types[path.extname(file)]) {
    response.writeHead(404).end();
    return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": `${types[path.extname(file)]}; charset=utf-8`,
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
    });
    if (request.method === "HEAD") {
      response.end();
    } else {
      fs.createReadStream(file).pipe(response);
    }
  });
});

function openPcApplication() {
  if (process.env.ATLAS_OPEN_BROWSER === "1" && process.platform === "win32") {
    execFile("cmd.exe", ["/d", "/c", "start", "", `http://127.0.0.1:${port}`], () => {});
  }
}

if (require.main === module) {
  server.on("error", async (error) => {
    if (error.code === "EADDRINUSE") {
      const response = await fetch(`http://127.0.0.1:${port}/api/instagram/health`).catch(() => null);
      const health = response && await response.json().catch(() => null);
      if (health?.product === "takip-atlasi") {
        openPcApplication();
        return;
      }
    }
    console.error("PC sunucusu açılamadı; 4173 portunu kontrol et.");
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Takip Atlası: http://127.0.0.1:${port}`);
    openPcApplication();
  });
}

module.exports = server;
