#!/usr/bin/env node
// Local catalog viewer: node scripts/catalog-serve.mjs  [port]
// Reads ~/.market-mcp/catalog.db (or MARKET_CATALOG_DB). Do not run as public server.
import { createServer } from "node:http";
import { readFileSync, existsSync, copyFileSync, unlinkSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogDbPath, openCatalogDb, listProducts, countProducts, listCategoryTree } from "../src/catalog/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, "..", "catalog-web");
const port = Number(process.argv[2] || process.env.PORT || 3847);
// Local default 127.0.0.1; in Docker set CATALOG_BIND=0.0.0.0
const host = process.env.CATALOG_BIND || "127.0.0.1";
const sourceDbPath = process.env.MARKET_CATALOG_DB || catalogDbPath();
// Docker Desktop on Windows cannot mmap SQLite WAL on a bind mount → copy to Linux fs.
const useSnapshot = process.env.CATALOG_SNAPSHOT === "1";
const snapPath = process.env.CATALOG_SNAPSHOT_PATH || "/tmp/catalog-snap.db";
/** Reuse snapshot until source mtime changes (typeahead must not copy on every keystroke). */
let snapSourceMtimeMs = -1;

function copyIfExists(from, to) {
  if (!existsSync(from)) return;
  copyFileSync(from, to);
}

function sourceMtimeMs(src) {
  try {
    let t = statSync(src).mtimeMs;
    for (const suffix of ["-wal", "-shm"]) {
      try {
        t = Math.max(t, statSync(src + suffix).mtimeMs);
      } catch { /* no wal/shm */ }
    }
    return t;
  } catch {
    return -1;
  }
}

/** Copy .db (+ wal/shm) onto a local path so node:sqlite can open it. Skip if unchanged. */
function snapshotDb(src) {
  const mtime = sourceMtimeMs(src);
  if (mtime === snapSourceMtimeMs && existsSync(snapPath)) return snapPath;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      if (existsSync(snapPath + suffix)) unlinkSync(snapPath + suffix);
    } catch { /* ignore */ }
  }
  copyFileSync(src, snapPath);
  copyIfExists(src + "-wal", snapPath + "-wal");
  copyIfExists(src + "-shm", snapPath + "-shm");
  snapSourceMtimeMs = mtime;
  return snapPath;
}

function openViewerDb() {
  if (!existsSync(sourceDbPath)) return null;
  const path = useSnapshot ? snapshotDb(sourceDbPath) : sourceDbPath;
  return openCatalogDb(path, { readOnly: true });
}

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

  if (url.pathname === "/api/categories") {
    if (!existsSync(sourceDbPath)) return json(res, 200, { tree: [], uncategorized: 0 });
    try {
      const db = openViewerDb();
      if (!db) return json(res, 200, { tree: [], uncategorized: 0 });
      const marketplace = url.searchParams.get("marketplace") || null;
      const tree = listCategoryTree(db, { marketplace });
      const total = countProducts(db);
      const withCatSql = marketplace
        ? "SELECT COUNT(*) AS n FROM products WHERE marketplace = ? AND (category_norm IS NOT NULL OR category_path IS NOT NULL)"
        : "SELECT COUNT(*) AS n FROM products WHERE category_norm IS NOT NULL OR category_path IS NOT NULL";
      let withCat = 0;
      try {
        withCat = marketplace
          ? db.prepare(withCatSql).get(marketplace).n
          : db.prepare(withCatSql).get().n;
      } catch { /* column missing on old DB */ }
      db.close();
      return json(res, 200, { tree, uncategorized: Math.max(0, total - withCat), total });
    } catch (err) {
      return json(res, 500, { error: err?.message || String(err) });
    }
  }

  if (url.pathname === "/api/products") {
    if (!existsSync(sourceDbPath)) {
      return json(res, 200, { path: sourceDbPath, total: 0, items: [], note: "catalog.db not created yet" });
    }
    try {
      const db = openViewerDb();
      if (!db) return json(res, 200, { path: sourceDbPath, total: 0, items: [], note: "catalog.db not created yet" });
      const marketplace = url.searchParams.get("marketplace") || null;
      const category = url.searchParams.get("category") || null;
      const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit") || 100)));
      const q = (url.searchParams.get("q") || "").trim() || null;
      const items = listProducts(db, { marketplace, category, q, limit });
      const total = countProducts(db);
      db.close();
      return json(res, 200, { path: sourceDbPath, total, showing: items.length, marketplace, category, q, items });
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

server.listen(port, host, () => {
  console.error(
    `catalog viewer http://${host}:${port}/  db=${sourceDbPath}` +
      (useSnapshot ? ` (snapshot→${snapPath})` : "")
  );
});
