// Normalize marketplace tool payloads into catalog product rows.
// Tool responses stay marketplace-specific; only the catalog uses this shape.

const TOOL_SITE = {
  ozon_search: "ozon",
  ozon_product_details: "ozon",
  ozon_product_reviews: "ozon",
  dns_search: "dns",
  dns_product: "dns",
  dns_reviews: "dns",
  yandex_search: "yandex",
  yandex_card: "yandex",
  yandex_reviews: "yandex",
  wb_card: "wb",
  compare: null, // per-item site
};

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function idFromUrl(site, url) {
  if (!url) return null;
  try {
    const path = new URL(url).pathname;
    if (site === "ozon") {
      const m = path.match(/\/product\/(?:[a-z0-9_-]+-)?(\d+)\//i);
      return m ? m[1] : null;
    }
    if (site === "dns") {
      const m = path.match(/\/product\/(?:opinion\/|characteristics\/)?([0-9a-f]{16})/i);
      return m ? m[1].toLowerCase() : null;
    }
    if (site === "yandex") {
      const m = path.match(/\/(\d{6,})\/?$/);
      return m ? m[1] : null;
    }
    if (site === "wb") {
      const m = path.match(/\/catalog\/(\d+)\//);
      return m ? m[1] : null;
    }
  } catch { /* ignore */ }
  return null;
}

function attrsFrom(raw) {
  const out = {};
  if (raw.specs && typeof raw.specs === "object") out.specs = raw.specs;
  if (raw.characteristics && typeof raw.characteristics === "object") out.characteristics = raw.characteristics;
  if (raw.dimensions_mm) out.dimensions_mm = raw.dimensions_mm;
  if (raw.reliability) out.reliability = raw.reliability;
  if (raw.discount != null) out.discount = raw.discount;
  return Object.keys(out).length ? out : null;
}

/** Map one raw product-like object to a catalog row, or null if unusable. */
export function normalizeItem(raw, siteHint = null) {
  if (!raw || typeof raw !== "object" || raw.error) return null;
  const site = str(raw.site) || siteHint;
  if (!site || !["ozon", "dns", "yandex", "wb"].includes(site)) return null;

  const url = str(raw.url);
  const externalId =
    str(raw.sku) ||
    str(raw.id) ||
    str(raw.external_id) ||
    idFromUrl(site, url);
  if (!externalId) return null;

  const name = str(raw.name);
  if (!name) return null;

  const price = num(raw.price);
  const oldPrice = num(raw.oldPrice ?? raw.priceOld ?? raw.old_price);
  const rating = num(raw.rating);
  const reviewsCount = num(raw.reviews ?? raw.reviews_count ?? raw.totalReviews ?? raw.totalRatings);
  const imageUrl = str(raw.image_url || raw.image || (Array.isArray(raw.images) ? raw.images[0] : null));
  const brand = str(raw.brand);

  return {
    marketplace: site,
    external_id: String(externalId),
    url: url || null,
    name,
    brand,
    price,
    old_price: oldPrice != null && price != null && oldPrice > price ? oldPrice : oldPrice,
    currency: "RUB",
    rating,
    reviews_count: reviewsCount != null ? Math.round(reviewsCount) : null,
    image_url: imageUrl,
    attrs: attrsFrom(raw),
  };
}

/**
 * Extract catalog products from a successful tool result.
 * Skips filter/review-only payloads without a product identity.
 */
export function extractProducts(toolName, result) {
  if (!result || typeof result !== "object") return [];
  const site = TOOL_SITE[toolName];
  const out = [];

  if (Array.isArray(result.items)) {
    for (const it of result.items) {
      const row = normalizeItem(it, it?.site || site);
      if (row) out.push(row);
    }
    return out;
  }

  // Single-card tools (details / card / product)
  if (toolName === "ozon_product_reviews" || toolName === "dns_reviews" || toolName === "yandex_reviews") {
    return []; // no stable product card in these payloads
  }
  if (toolName === "ozon_filters") return [];

  const row = normalizeItem(result, site);
  return row ? [row] : [];
}

export const _internal = { TOOL_SITE, idFromUrl };
