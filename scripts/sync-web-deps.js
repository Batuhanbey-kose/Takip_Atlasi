const fs = require("node:fs");
const path = require("node:path");

const source = path.join(__dirname, "../node_modules/fflate/umd/index.js");
const destination = path.join(__dirname, "../www/vendor/fflate.js");
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
