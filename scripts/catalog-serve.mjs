#!/usr/bin/env node
// Local catalog viewer: node scripts/catalog-serve.mjs  [port]
// Reads ~/.market-mcp/catalog.db (or MARKET_CATALOG_DB). Do not run as public server.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogDbPath, openCatalogDb, listProducts, countProducts } from "../src/catalog/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, "..", "catalog-web");
const port = Number(process.argv[2] || process.env.PORT || 3847);
const dbPath = process.env.MARKET_CATALOG_DB || catalogDbPath();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/api/products") {
    if (!existsSync(dbPath)) return json(res, 200, { path: dbPath, total: 0, items: [], note: "catalog.db not created yet" });
    try {
      const db = openCatalogDb(dbPath);
      const marketplace = url.searchParams.get("marketplace") || null;
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      let items = listProducts(db, { marketplace, limit: 2000 });
      if (q) items = items.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.brand || "").toLowerCase().includes(q));
      items = items.slice(0, limit);
      const total = countProducts(db);
      db.close();
      return json(res, 200, { path: dbPath, total, showing: items.length, marketplace, items });
    } catch (err) {
      return json(res, 500, { error: err?.message || String(err) });
    }
  }

  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  if (file.includes("..")) {
    res.writeHead(400);
    return res.end("bad path");
  }
  const abs = join(WEB, file);
  if (!abs.startsWith(WEB) || !existsSync(abs)) {
    res.writeHead(404);
    return res.end("not found");
  }
  const data = readFileSync(abs);
  res.writeHead(200, { "content-type": MIME[extname(abs)] || "application/octet-stream" });
  res.end(data);
});

server.listen(port, "127.0.0.1", () => {
  console.error(`catalog viewer http://127.0.0.1:${port}/  db=${dbPath}`);
});
