import { metricsChanged } from "./db.js";

/** Upsert products; write snapshot only when price/rating/reviews change (or first see). */
export function upsertProducts(db, products, { sourceTool = null, now = new Date().toISOString() } = {}) {
  if (!products?.length) return { upserted: 0, snapshots: 0 };

  const select = db.prepare(
    "SELECT price, old_price, rating, reviews_count FROM products WHERE marketplace = ? AND external_id = ?"
  );
  const insert = db.prepare(`
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
      insert.run({
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
        category_path: Array.isArray(p.category_path) && p.category_path.length
          ? JSON.stringify(p.category_path)
          : null,
        attrs_json: p.attrs ? JSON.stringify(p.attrs) : null,
        now,
      });
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

function hasCategoryCol(db) {
  return db.prepare("PRAGMA table_info(products)").all().some((c) => c.name === "category_path");
}

function decodeRow(row) {
  if (!row) return row;
  let category_path = null;
  if (row.category_path) {
    try {
      const parsed = JSON.parse(row.category_path);
      if (Array.isArray(parsed) && parsed.length) category_path = parsed;
    } catch { /* ignore */ }
  }
  return { ...row, category_path };
}

export function listProducts(db, { marketplace = null, category = null, limit = 50 } = {}) {
  const withCat = hasCategoryCol(db);
  const cols = `marketplace, external_id, url, name, brand, price, old_price, rating,
                reviews_count, image_url, first_seen_at, last_seen_at, seen_count` +
    (withCat ? ", category_path" : "");
  // Pull a wider window when filtering by category prefix (JSON path match in JS).
  const fetchLimit = category ? Math.max(limit * 20, 2000) : limit;
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
      const path = p.category_path;
      if (!path?.length || path.length < prefix.length) return false;
      return prefix.every((seg, i) => path[i] === seg);
    });
  }
  return rows.slice(0, limit);
}

/** Nested category tree with product counts from category_path JSON. */
export function listCategoryTree(db, { marketplace = null } = {}) {
  if (!hasCategoryCol(db)) return [];
  const cols = "category_path";
  const rows = marketplace
    ? db.prepare(`SELECT ${cols} FROM products WHERE marketplace = ? AND category_path IS NOT NULL`).all(marketplace)
    : db.prepare(`SELECT ${cols} FROM products WHERE category_path IS NOT NULL`).all();

  const root = { children: new Map(), count: 0 };
  for (const row of rows) {
    let path;
    try {
      path = JSON.parse(row.category_path);
    } catch {
      continue;
    }
    if (!Array.isArray(path) || !path.length) continue;
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

export function countProducts(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
}
