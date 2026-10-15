#!/usr/bin/env node
// List catalog products: node scripts/catalog-list.mjs [--marketplace ozon] [--limit 30]
import { catalogDbPath, openCatalogDb, listProducts, countProducts } from "../src/catalog/index.js";

const args = process.argv.slice(2);
const marketplace = args.includes("--marketplace") ? args[args.indexOf("--marketplace") + 1] : null;
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 30;

const path = process.env.MARKET_CATALOG_DB || catalogDbPath();
const db = openCatalogDb(path);
const total = countProducts(db);
const rows = listProducts(db, { marketplace, limit });
console.log(JSON.stringify({ path, total, showing: rows.length, marketplace, items: rows }, null, 2));
db.close();
