const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const USER = process.env.APP_USER || "family";
const PASSWORD = process.env.APP_PASSWORD || "";

function authorized(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const supplied = Buffer.from(header.slice(6), "base64");
  const expected = Buffer.from(`${USER}:${PASSWORD}`);
  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(supplied, expected);
}

http
  .createServer((req, res) => {
    if (!PASSWORD) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      return res.end("Set the APP_PASSWORD environment variable to use this site.");
    }
    if (!authorized(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Work Site"' });
      return res.end("Authentication required");
    }
    const url = new URL(req.url, "http://localhost");
    if (req.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/index.html")) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
  })
  .listen(PORT);
