const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../www");
const port = Number(process.env.PORT) || 4173;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

const server = http.createServer((request, response) => {
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

if (require.main === module) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Takip Atlası: http://127.0.0.1:${port}`);
  });
}

module.exports = server;
