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

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const FILES_DIR = path.join(DATA_DIR, "files");
const MAX_STATE = 5 * 1024 * 1024;
const MAX_FILE = 100 * 1024 * 1024;

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { rev: 0, state: null };
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, STATE_FILE);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/state") {
    if (req.method === "GET") return sendJson(res, 200, readStore());
    if (req.method === "PUT") {
      const body = JSON.parse((await readBody(req, MAX_STATE)).toString("utf8"));
      if (!body || typeof body.state !== "object") return sendJson(res, 400, { error: "bad state" });
      const store = { rev: readStore().rev + 1, state: body.state };
      writeStore(store);
      return sendJson(res, 200, { rev: store.rev });
    }
  }
  const m = url.pathname.match(/^\/api\/files\/([a-z0-9]{8,64})$/);
  if (m) {
    const file = path.join(FILES_DIR, m[1]);
    if (req.method === "GET") {
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: "missing" });
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" });
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method === "PUT") {
      const data = await readBody(req, MAX_FILE);
      fs.mkdirSync(FILES_DIR, { recursive: true });
      fs.writeFileSync(file, data);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      fs.rmSync(file, { force: true });
      return sendJson(res, 200, { ok: true });
    }
  }
  return sendJson(res, 404, { error: "not found" });
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
    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, res, url).catch((err) => {
        if (!res.headersSent) sendJson(res, err.message === "too large" ? 413 : 400, { error: err.message });
      });
    }
    if (req.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/index.html")) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
  })
  .listen(PORT);
