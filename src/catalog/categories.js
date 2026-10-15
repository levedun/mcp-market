// Cross-marketplace category normalization for the catalog UI.
// Raw breadcrumbs stay in category_path; category_norm is a shared tree.

const NOISE_ROOT = /^(каталог|dns|ozon|wildberries|вб|wb|яндекс(?:\.?\s*маркет)?|yandex(?:\s*market)?|главная|home)$/i;

/** Leaf-ish labels that Ozon often lists as siblings after a real path. */
const LEAF_SIBLING = /кресл|мышь|мыши|стул|флеш|наушник|клавиатур|монитор|коврик|гарнитур|микрофон/i;

/**
 * Finished devices whose titles often list RAM/SSD/GPU as specs — component rules
 * must not win on those strings.
 */
export const FINISHED_DEVICE =
  /мини[\s-]?пк|mini[\s-]?pc|неттоп|моноблок|системн\w*\s*блок|готов\w*\s*(?:пк|компьютер)|игрово\w*\s*пк|(?:^|[\s(])пк\s+[A-Za-zА-Яа-я0-9]|ноутбук|notebook|laptop|макбук|macbook|смартфон|iphone|android.?телефон|планшет|tablet/i;

/**
 * Canonical rules: first match wins (finished devices → furniture/peripherals → parts).
 * Optional `unless` skips the rule when that regex matches the haystack.
 */
export const CANON_RULES = [
  // ── finished devices (before parts: titles embed "SSD", "RAM", "RTX" as specs) ──
  { re: /смартфон|iphone|android.?телефон|телефон\w*\s*и\s*смарт/i, path: ["Электроника", "Телефоны", "Смартфоны"] },
  { re: /планшет|tablet|ipad/i, path: ["Электроника", "Планшеты"] },
  { re: /ноутбук|notebook|laptop|макбук|macbook/i, path: ["Электроника", "Компьютеры", "Ноутбуки"] },
  {
    re: /мини[\s-]?пк|mini[\s-]?pc|неттоп|моноблок|системн\w*\s*блок|готов\w*\s*(?:пк|компьютер)|игрово\w*\s*пк|(?:^|[\s(])пк\s+[A-Za-zА-Яа-я0-9]/i,
    path: ["Электроника", "Компьютеры", "Настольные и мини-ПК"],
  },

  // ── furniture ──
  { re: /кресл\w*.{0,40}(комп|игро|гейм|офис|эргоном)|((комп|игро|гейм|офис|эргоном)\w*.{0,40}кресл)|gaming\s*chair|офисн\w*\s*кресл/i, path: ["Мебель", "Кресла компьютерные"] },
  { re: /кресл/i, path: ["Мебель", "Кресла"] },
  { re: /стол\w*.{0,30}(комп|письм|офис)|(комп|письм|офис)\w*.{0,30}стол/i, path: ["Мебель", "Столы"] },

  // ── peripherals ──
  { re: /мышь|мыши|\bmouse\b|мышка/i, path: ["Электроника", "Периферия", "Мыши"] },
  { re: /клавиатур|keyboard/i, path: ["Электроника", "Периферия", "Клавиатуры"] },
  { re: /наушник|гарнитур|headset|headphones?/i, path: ["Электроника", "Аудио", "Наушники"] },
  { re: /монитор(?!инг)|monitor/i, path: ["Электроника", "Периферия", "Мониторы"] },

  // ── storage / parts (skip when the title is a finished PC/phone/…) ──
  { re: /usb[\s-]?флеш|флеш[\s-]?карт|флешк|flash\s*driv|usb[\s-]?flash|накопител[^\n]{0,20}usb/i, path: ["Электроника", "Накопители", "USB-флешки"] },
  { re: /(?:^|[^\w])(?:ssd|hdd|nvme)(?:$|[^\w])|ж[её]стк\w*\s*диск|накопител/i, unless: FINISHED_DEVICE, path: ["Электроника", "Накопители", "Диски и SSD"] },
  { re: /оперативн\w*\s*памят|\bозу\b|\bram\b|ddr[345]/i, unless: FINISHED_DEVICE, path: ["Электроника", "Комплектующие", "Оперативная память"] },
  { re: /видеокарт|видеоадаптер|\bgpu\b|geforce|radeon/i, unless: FINISHED_DEVICE, path: ["Электроника", "Комплектующие", "Видеокарты"] },
  { re: /процессоры?|\bcpu\w*\b|ryzen|core\s*i[3579]/i, unless: FINISHED_DEVICE, path: ["Электроника", "Комплектующие", "Процессоры"] },
  { re: /материнск\w*\s*плат|motherboard|\bmobo\b/i, unless: FINISHED_DEVICE, path: ["Электроника", "Комплектующие", "Материнские платы"] },
];

/** Path-segment aliases → canonical path (when keywords in name are weak). */
const SEGMENT_ALIASES = [
  { re: /мини[\s-]?пк|настольн|неттоп|моноблок/i, path: ["Электроника", "Компьютеры", "Настольные и мини-ПК"] },
  { re: /ноутбук/i, path: ["Электроника", "Компьютеры", "Ноутбуки"] },
  { re: /usb[\s-]?флеш|флешк|flash/i, path: ["Электроника", "Накопители", "USB-флешки"] },
  { re: /компьютерн\w*\s*мыш|мыш(и|ь|ка)/i, path: ["Электроника", "Периферия", "Мыши"] },
  { re: /кресл|офисн\w*\s*мебел/i, path: ["Мебель", "Кресла компьютерные"] },
  { re: /оперативн|озу|\bram\b/i, path: ["Электроника", "Комплектующие", "Оперативная память"] },
  { re: /смартфон/i, path: ["Электроника", "Телефоны", "Смартфоны"] },
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

function ruleMatches(rule, text) {
  if (rule.unless && rule.unless.test(text)) return false;
  return rule.re.test(text);
}

/**
 * Map raw marketplace path + product text → canonical breadcrumb for the catalog tree.
 * @returns {string[]|null}
 */
export function normalizeCategory(product = {}) {
  const raw = collapseSiblingTail(product.category_path || []);
  const text = haystack({ ...product, category_path: raw });

  for (const rule of CANON_RULES) {
    if (ruleMatches(rule, text)) return [...rule.path];
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
