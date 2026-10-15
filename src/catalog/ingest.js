import { metricsChanged } from "./db.js";
import { normalizeCategory } from "./categories.js";

function pathJson(path) {
  return Array.isArray(path) && path.length ? JSON.stringify(path) : null;
}

function decodePath(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* ignore */ }
  return null;
}

/** Upsert products; write snapshot only when price/rating/reviews change (or first see). */
export function upsertProducts(db, products, { sourceTool = null, now = new Date().toISOString() } = {}) {
  if (!products?.length) return { upserted: 0, snapshots: 0 };

  const hasNorm = hasCol(db, "category_norm");
  const select = db.prepare(
    `SELECT price, old_price, rating, reviews_count, category_path${hasNorm ? ", category_norm" : ""}
     FROM products WHERE marketplace = ? AND external_id = ?`
  );
  const insert = hasNorm
    ? db.prepare(`
    INSERT INTO products (
      marketplace, external_id, url, name, brand, price, old_price, currency,
      rating, reviews_count, image_url, category_path, category_norm, attrs_json,
      first_seen_at, last_seen_at, seen_count
    ) VALUES (
      @marketplace, @external_id, @url, @name, @brand, @price, @old_price, @currency,
      @rating, @reviews_count, @image_url, @category_path, @category_norm, @attrs_json,
      @now, @now, 1
    )
    ON CONFLICT(marketplace, external_id) DO UPDATE SET
      url = COALESCE(excluded.url, products.url),
      name = excluded.name,
      brand = COALESCE(excluded.brand, products.brand),
      price = excluded.price,
      old_price = excluded.old_price,
      rating = excluded.rating,
      reviews_count = excluded.reviews_count,
      image_url = COALESCE(excluded.image_url, products.image_url),
      category_path = COALESCE(excluded.category_path, products.category_path),
      category_norm = excluded.category_norm,
      attrs_json = COALESCE(excluded.attrs_json, products.attrs_json),
      last_seen_at = excluded.last_seen_at,
      seen_count = products.seen_count + 1
  `)
    : db.prepare(`
    INSERT INTO products (
      marketplace, external_id, url, name, brand, price, old_price, currency,
      rating, reviews_count, image_url, category_path, attrs_json, first_seen_at, last_seen_at, seen_count
    ) VALUES (
      @marketplace, @external_id, @url, @name, @brand, @price, @old_price, @currency,
      @rating, @reviews_count, @image_url, @category_path, @attrs_json, @now, @now, 1
    )
    ON CONFLICT(marketplace, external_id) DO UPDATE SET
      url = COALESCE(excluded.url, products.url),
      name = excluded.name,
      brand = COALESCE(excluded.brand, products.brand),
      price = excluded.price,
      old_price = excluded.old_price,
      rating = excluded.rating,
      reviews_count = excluded.reviews_count,
      image_url = COALESCE(excluded.image_url, products.image_url),
      category_path = COALESCE(excluded.category_path, products.category_path),
      attrs_json = COALESCE(excluded.attrs_json, products.attrs_json),
      last_seen_at = excluded.last_seen_at,
      seen_count = products.seen_count + 1
  `);
  const snap = db.prepare(`
    INSERT INTO product_snapshots (
      marketplace, external_id, seen_at, price, old_price, rating, reviews_count, source_tool
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let upserted = 0;
  let snapshots = 0;

  db.exec("BEGIN");
  try {
    for (const p of products) {
      const prev = select.get(p.marketplace, p.external_id);
      const mergedPath = (Array.isArray(p.category_path) && p.category_path.length)
        ? p.category_path
        : decodePath(prev?.category_path);
      const norm = normalizeCategory({
        name: p.name,
        brand: p.brand,
        category_path: mergedPath,
      });
      const row = {
        marketplace: p.marketplace,
        external_id: p.external_id,
        url: p.url,
        name: p.name,
        brand: p.brand,
        price: p.price,
        old_price: p.old_price,
        currency: p.currency || "RUB",
        rating: p.rating,
        reviews_count: p.reviews_count,
        image_url: p.image_url,
        category_path: pathJson(p.category_path),
        attrs_json: p.attrs ? JSON.stringify(p.attrs) : null,
        now,
      };
      if (hasNorm) row.category_norm = pathJson(norm);
      insert.run(row);
      upserted++;
      if (metricsChanged(prev, p)) {
        snap.run(
          p.marketplace,
          p.external_id,
          now,
          p.price,
          p.old_price,
          p.rating,
          p.reviews_count,
          sourceTool
        );
        snapshots++;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { upserted, snapshots };
}

function hasCol(db, name) {
  return db.prepare("PRAGMA table_info(products)").all().some((c) => c.name === name);
}

function hasCategoryCol(db) {
  return hasCol(db, "category_path");
}

function decodeRow(row) {
  if (!row) return row;
  return {
    ...row,
    category_path: decodePath(row.category_path),
    category_norm: decodePath(row.category_norm),
  };
}

/** Prefer canonical path for search / filters; fall back to raw. */
export function effectiveCategory(product) {
  return product?.category_norm?.length
    ? product.category_norm
    : product?.category_path?.length
      ? product.category_path
      : null;
}

/** All whitespace-separated tokens must appear in name, brand or categories. */
export function matchesQuery(product, q) {
  const tokens = String(q || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return true;
  const hay = [
    product.name,
    product.brand,
    ...(product.category_norm || []),
    ...(product.category_path || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

export function listProducts(db, { marketplace = null, category = null, q = null, limit = 50 } = {}) {
  const withCat = hasCategoryCol(db);
  const withNorm = hasCol(db, "category_norm");
  const cols = `marketplace, external_id, url, name, brand, price, old_price, rating,
                reviews_count, image_url, first_seen_at, last_seen_at, seen_count` +
    (withCat ? ", category_path" : "") +
    (withNorm ? ", category_norm" : "");
  const needWide = Boolean(category || (q && String(q).trim()));
  const fetchLimit = needWide ? Math.max(limit * 20, 2000) : limit;
  let rows;
  if (marketplace) {
    rows = db
      .prepare(`SELECT ${cols} FROM products WHERE marketplace = ? ORDER BY last_seen_at DESC LIMIT ?`)
      .all(marketplace, fetchLimit);
  } else {
    rows = db.prepare(`SELECT ${cols} FROM products ORDER BY last_seen_at DESC LIMIT ?`).all(fetchLimit);
  }
  rows = rows.map(decodeRow);
  if (category) {
    const prefix = String(category).split("\u001f").filter(Boolean);
    rows = rows.filter((p) => {
      const path = effectiveCategory(p);
      if (!path?.length || path.length < prefix.length) return false;
      return prefix.every((seg, i) => path[i] === seg);
    });
  }
  if (q && String(q).trim()) {
    rows = rows.filter((p) => matchesQuery(p, q));
  }
  return rows.slice(0, limit);
}

/** Nested category tree from category_norm (fallback category_path). */
export function listCategoryTree(db, { marketplace = null } = {}) {
  if (!hasCategoryCol(db)) return [];
  const withNorm = hasCol(db, "category_norm");
  const cols = withNorm ? "category_path, category_norm" : "category_path";
  const rows = marketplace
    ? db.prepare(
      `SELECT ${cols} FROM products WHERE marketplace = ? AND (category_norm IS NOT NULL OR category_path IS NOT NULL)`
    ).all(marketplace)
    : db.prepare(
      `SELECT ${cols} FROM products WHERE category_norm IS NOT NULL OR category_path IS NOT NULL`
    ).all();

  const root = { children: new Map(), count: 0 };
  for (const row of rows) {
    const path = decodePath(row.category_norm) || decodePath(row.category_path);
    if (!path?.length) continue;
    let node = root;
    node.count++;
    for (const seg of path) {
      const name = String(seg).trim();
      if (!name) continue;
      if (!node.children.has(name)) node.children.set(name, { name, children: new Map(), count: 0 });
      node = node.children.get(name);
      node.count++;
    }
  }

  function toList(node, prefix = []) {
    return [...node.children.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((ch) => {
        const path = [...prefix, ch.name];
        return {
          name: ch.name,
          path,
          key: path.join("\u001f"),
          count: ch.count,
          children: toList(ch, path),
        };
      });
  }
  return toList(root);
}

/** Recompute category_norm for every product (after rules change / migration). */
export function backfillCategoryNorm(db) {
  if (!hasCol(db, "category_norm")) return { updated: 0 };
  const rows = db.prepare(
    "SELECT marketplace, external_id, name, brand, category_path FROM products"
  ).all();
  const upd = db.prepare(
    "UPDATE products SET category_norm = ? WHERE marketplace = ? AND external_id = ?"
  );
  let updated = 0;
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const path = decodePath(row.category_path);
      const norm = normalizeCategory({ name: row.name, brand: row.brand, category_path: path });
      upd.run(pathJson(norm), row.marketplace, row.external_id);
      updated++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { updated };
}

export function countProducts(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
}
