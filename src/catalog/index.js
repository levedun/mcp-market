// Product catalog: normalize tool results → SQLite.
// Off by default (MARKET_CATALOG=1). Failures never break MCP responses.
//
// Scale path: products = current state; product_snapshots = history for CH/analytics export.
// WAL allows a React reader while MCP writes.

import { homedir } from "node:os";
import { join } from "node:path";
import { extractProducts } from "./normalize.js";
import { openCatalogDb } from "./db.js";
import { upsertProducts, listProducts, countProducts } from "./ingest.js";

const log = (...a) => console.error("[catalog]", ...a);

export const catalogEnabled = () => process.env.MARKET_CATALOG === "1";

export function catalogDbPath() {
  // Sibling of the browser profile dir (~/.market-mcp/catalog.db), not inside the profile.
  return process.env.MARKET_CATALOG_DB || join(homedir(), ".market-mcp", "catalog.db");
}

let db = null;
let initFailed = false;

function getDb() {
  if (!catalogEnabled() || initFailed) return null;
  if (db) return db;
  try {
    db = openCatalogDb(catalogDbPath());
    log("open", catalogDbPath());
    return db;
  } catch (err) {
    initFailed = true;
    log("init failed:", err?.message || err);
    return null;
  }
}

/** Fire-and-forget ingest after a successful tool call. */
export function ingestToolResult(toolName, result) {
  if (!catalogEnabled()) return;
  try {
    const products = extractProducts(toolName, result);
    if (!products.length) return;
    const database = getDb();
    if (!database) return;
    const stats = upsertProducts(database, products, { sourceTool: toolName });
    log(`${toolName}: +${stats.upserted} products, ${stats.snapshots} snapshots`);
  } catch (err) {
    log(`${toolName} ingest error:`, err?.message || err);
  }
}

export function catalogStats() {
  const database = getDb();
  if (!database) return { enabled: catalogEnabled(), path: catalogDbPath(), count: 0 };
  return { enabled: true, path: catalogDbPath(), count: countProducts(database) };
}

export { extractProducts, listProducts, countProducts, openCatalogDb };
