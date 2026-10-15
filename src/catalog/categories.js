// Cross-marketplace category normalization for the catalog UI.
// Raw breadcrumbs stay in category_path; category_norm is a shared tree.

const NOISE_ROOT = /^(каталог|dns|ozon|wildberries|вб|wb|яндекс(?:\.?\s*маркет)?|yandex(?:\s*market)?|главная|home)$/i;

/** Leaf-ish labels that Ozon often lists as siblings after a real path. */
const LEAF_SIBLING = /кресл|мышь|мыши|стул|флеш|наушник|клавиатур|монитор|коврик|гарнитур|микрофон/i;

/**
 * Canonical rules: first match wins (specific → broad).
 * `re` is tested against name + brand + raw path joined.
 */
export const CANON_RULES = [
  { re: /usb[\s-]?флеш|флеш[\s-]?карт|флешк|flash\s*driv|usb[\s-]?flash|накопител[^\n]{0,20}usb/i, path: ["Электроника", "Накопители", "USB-флешки"] },
  { re: /ssd|ж[её]стк\w*\s*диск|hdd|nvme|накопител/i, path: ["Электроника", "Накопители", "Диски и SSD"] },
  { re: /оперативн\w*\s*памят|\bозу\b|\bram\b|ddr[345]/i, path: ["Электроника", "Комплектующие", "Оперативная память"] },
  { re: /видеокарт|видеоадаптер|\bgpu\b|geforce|radeon/i, path: ["Электроника", "Комплектующие", "Видеокарты"] },
  { re: /процессоры?|\bcpu\w*\b|ryzen|core\s*i[3579]/i, path: ["Электроника", "Комплектующие", "Процессоры"] },
  { re: /материнск\w*\s*плат|motherboard|\bmobo\b/i, path: ["Электроника", "Комплектующие", "Материнские платы"] },
  { re: /мышь|мыши|\bmouse\b|мышка/i, path: ["Электроника", "Периферия", "Мыши"] },
  { re: /клавиатур|keyboard/i, path: ["Электроника", "Периферия", "Клавиатуры"] },
  { re: /наушник|гарнитур|headset|headphones?/i, path: ["Электроника", "Аудио", "Наушники"] },
  { re: /монитор(?!инг)|monitor/i, path: ["Электроника", "Периферия", "Мониторы"] },
  { re: /ноутбук|notebook|laptop|макбук|macbook/i, path: ["Электроника", "Компьютеры", "Ноутбуки"] },
  { re: /кресл\w*.{0,40}(комп|игро|гейм|офис|эргоном)|((комп|игро|гейм|офис|эргоном)\w*.{0,40}кресл)|gaming\s*chair|офисн\w*\s*кресл/i, path: ["Мебель", "Кресла компьютерные"] },
  { re: /кресл/i, path: ["Мебель", "Кресла"] },
  { re: /стол\w*.{0,30}(комп|письм|офис)|(комп|письм|офис)\w*.{0,30}стол/i, path: ["Мебель", "Столы"] },
  { re: /смартфон|iphone|android.?телефон|телефон\w*\s*и\s*смарт/i, path: ["Электроника", "Телефоны", "Смартфоны"] },
];

/** Path-segment aliases → canonical path (when keywords in name are weak). */
const SEGMENT_ALIASES = [
  { re: /usb[\s-]?флеш|флешк|flash/i, path: ["Электроника", "Накопители", "USB-флешки"] },
  { re: /компьютерн\w*\s*мыш|мыш(и|ь|ка)/i, path: ["Электроника", "Периферия", "Мыши"] },
  { re: /кресл|офисн\w*\s*мебел/i, path: ["Мебель", "Кресла компьютерные"] },
  { re: /оперативн|озу|\bram\b/i, path: ["Электроника", "Комплектующие", "Оперативная память"] },
  { re: /смартфон/i, path: ["Электроника", "Телефоны", "Смартфоны"] },
  { re: /ноутбук/i, path: ["Электроника", "Компьютеры", "Ноутбуки"] },
];

export function stripNoiseRoots(path) {
  if (!Array.isArray(path) || !path.length) return [];
  const out = path
    .map((s) => String(s || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  while (out.length && NOISE_ROOT.test(out[0])) out.shift();
  return out;
}

/**
 * Ozon search filter sometimes appends sibling leaf categories as if they were a path.
 * Collapse a trailing run of leaf-like labels down to the first of that run (or its parent).
 */
export function collapseSiblingTail(path) {
  const p = stripNoiseRoots(path);
  if (p.length < 2) return p;
  let end = p.length - 1;
  while (end > 0 && LEAF_SIBLING.test(p[end]) && LEAF_SIBLING.test(p[end - 1])) end--;
  // end points at first leaf-like of the trailing cluster (or last non-cluster index)
  if (end < p.length - 1 && LEAF_SIBLING.test(p[end])) {
    return p.slice(0, end + 1);
  }
  return p;
}

function haystack({ name, brand, category_path } = {}) {
  return [name, brand, ...(category_path || [])].filter(Boolean).join(" \n ");
}

/**
 * Map raw marketplace path + product text → canonical breadcrumb for the catalog tree.
 * @returns {string[]|null}
 */
export function normalizeCategory(product = {}) {
  const raw = collapseSiblingTail(product.category_path || []);
  const text = haystack({ ...product, category_path: raw });

  for (const rule of CANON_RULES) {
    if (rule.re.test(text)) return [...rule.path];
  }

  // Segment aliases on cleaned raw path (deepest first).
  for (let i = raw.length - 1; i >= 0; i--) {
    for (const al of SEGMENT_ALIASES) {
      if (al.re.test(raw[i])) return [...al.path];
    }
  }

  // Fallback: cleaned raw path if we have anything left.
  return raw.length ? raw : null;
}
