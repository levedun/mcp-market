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
      rating, reviews_count, image_url, attrs_json, first_seen_at, last_seen_at, seen_count
    ) VALUES (
      @marketplace, @external_id, @url, @name, @brand, @price, @old_price, @currency,
      @rating, @reviews_count, @image_url, @attrs_json, @now, @now, 1
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

export function listProducts(db, { marketplace = null, limit = 50 } = {}) {
  const cols = `marketplace, external_id, url, name, brand, price, old_price, rating,
                reviews_count, image_url, first_seen_at, last_seen_at, seen_count`;
  if (marketplace) {
    return db
      .prepare(`SELECT ${cols} FROM products WHERE marketplace = ? ORDER BY last_seen_at DESC LIMIT ?`)
      .all(marketplace, limit);
  }
  return db.prepare(`SELECT ${cols} FROM products ORDER BY last_seen_at DESC LIMIT ?`).all(limit);
}

export function countProducts(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
}
