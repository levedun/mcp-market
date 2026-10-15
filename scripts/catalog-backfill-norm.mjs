#!/usr/bin/env node
// Recompute category_norm for all products in the catalog DB.
// Usage: node scripts/catalog-backfill-norm.mjs
import { existsSync } from "node:fs";
import { catalogDbPath, openCatalogDb, backfillCategoryNorm, countProducts, listCategoryTree } from "../src/catalog/index.js";

const path = process.env.MARKET_CATALOG_DB || catalogDbPath();
if (!existsSync(path)) {
  console.error("no catalog db at", path);
  process.exit(1);
}
const db = openCatalogDb(path);
const before = countProducts(db);
const { updated } = backfillCategoryNorm(db);
const tree = listCategoryTree(db);
const withNorm = db.prepare("SELECT COUNT(*) AS n FROM products WHERE category_norm IS NOT NULL").get().n;
db.close();
console.error(`backfill ok: ${updated}/${before} rows, with category_norm=${withNorm}`);
console.error("tree roots:", tree.map((t) => `${t.name}(${t.count})`).join(", ") || "(empty)");
