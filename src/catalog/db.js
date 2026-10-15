// SQLite catalog store (node:sqlite). Current product state + append-only snapshots
// for price/rating history — exportable later to ClickHouse without rewriting ingest.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  marketplace TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  price REAL,
  old_price REAL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  rating REAL,
  reviews_count INTEGER,
  image_url TEXT,
  attrs_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (marketplace, external_id)
);

CREATE INDEX IF NOT EXISTS idx_products_last_seen ON products(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_marketplace_price ON products(marketplace, price);

-- Append-only history. Only rows where price/rating/reviews change (or first insert).
CREATE TABLE IF NOT EXISTS product_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace TEXT NOT NULL,
  external_id TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  price REAL,
  old_price REAL,
  rating REAL,
  reviews_count INTEGER,
  source_tool TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_product_time
  ON product_snapshots(marketplace, external_id, seen_at DESC);
`;

export function openCatalogDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(DDL);
  const ver = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!ver) {
    db.prepare("INSERT INTO meta(key, value) VALUES('schema_version', ?)").run(String(SCHEMA_VERSION));
  } else if (Number(ver.value) > SCHEMA_VERSION) {
    throw new Error(`catalog DB schema ${ver.value} is newer than code ${SCHEMA_VERSION}`);
  }
  // Future: migrate when Number(ver.value) < SCHEMA_VERSION
  return db;
}

export function metricsChanged(prev, next) {
  if (!prev) return true;
  return (
    prev.price !== next.price ||
    prev.old_price !== next.old_price ||
    prev.rating !== next.rating ||
    prev.reviews_count !== next.reviews_count
  );
}
