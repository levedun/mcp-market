// Cross-marketplace category normalization for the catalog UI.
// Raw breadcrumbs stay in category_path; category_norm is a shared tree.

const NOISE_ROOT = /^(каталог|dns|ozon|wildberries|вб|wb|яндекс(?:\.?\s*маркет)?|yandex(?:\s*market)?|главная|home)$/i;

/** Leaf-ish labels that Ozon often lists as siblings after a real path. */
const LEAF_SIBLING = /кресл|мышь|мыши|стул|флеш|наушник|клавиатур|монитор|коврик|гарнитур|микрофон/i;

/**
 * Marketplace umbrella segments that mention several product types at once
 * (e.g. DNS «ПК, ноутбуки, периферия»). Must not decide notebook vs desktop.
 */
const UMBRELLA_SEGMENT =
  /пк\s*,\s*ноутбук|ноутбук\w*\s*,\s*(?:пк|перифери)|компьютеры?\s+и\s+(?:по|комплект|перифери)|компьют\w*\s+и\s+перифери/i;

/** Trailing brand / SKU-ish leaves that Ozon sometimes appends to breadcrumbs. */
const BRAND_LEAF =
  /^(xiaomi|samsung|kingston|apple|asus|hp|lenovo|acer|msi|gigabyte|ardor(?:\s+gaming)?|logitech|razer|hyperx|corsair|tp-?link|tapo|intel|amd|nvidia)$/i;

/**
 * Finished devices whose titles often list RAM/SSD/GPU as specs — component rules
 * must not win on those strings.
 */
export const FINISHED_DEVICE =
  /мини[\s-]?пк|mini[\s-]?pc|неттоп|моноблок|системн\w*\s*блок|готов\w*\s*(?:пк|компьютер)|игрово\w*\s*пк|(?:^|[\s(])пк\s+[A-Za-zА-Яа-яЁё0-9]|персональн\w*\s*компьютер|ноутбук|notebook|laptop|макбук|macbook|смартфон|iphone|android.?телефон|планшет|tablet/i;

const PATH_DESKTOP = ["Электроника", "Компьютеры", "Настольные и мини-ПК"];
const PATH_NOTEBOOK = ["Электроника", "Компьютеры", "Ноутбуки"];

/**
 * Canonical rules: first match wins (finished devices → furniture/peripherals → parts).
 * Optional `unless` skips the rule when that regex matches the haystack.
 * Optional `nameOnly` is only used in the name+brand phase (see normalizeCategory).
 */
export const CANON_RULES = [
  // ── finished devices (before parts: titles embed "SSD", "RAM", "RTX" as specs) ──
  { re: /смартфон|iphone|android.?телефон|телефон\w*\s*и\s*смарт/i, path: ["Электроника", "Телефоны", "Смартфоны"] },
  { re: /планшет|tablet|ipad/i, path: ["Электроника", "Планшеты"] },
  // Desktop / mini-PC before notebooks so "ПК …" wins; notebooks are name-first (see phase 1).
  {
    re: /мини[\s-]?пк|mini[\s-]?pc|неттоп|моноблок|системн\w*\s*блок|готов\w*\s*(?:пк|компьютер)|игрово\w*\s*пк|(?:^|[\s(])пк\s+[A-Za-zА-Яа-яЁё0-9]|персональн\w*\s*компьютер/i,
    path: PATH_DESKTOP,
  },
  { re: /ноутбук|notebook|laptop|макбук|macbook/i, path: PATH_NOTEBOOK },

  // ── smart home (before generic "монитор" / construction fallbacks) ──
  {
    re: /умн\w*\s*розетк|smart\s*plug|wi-?fi\s*розетк|розетк\w*.{0,24}(?:wifi|wi-?fi|алис|яндекс|zigbee|matter)|(?:tapo|tuya)\b.{0,20}розетк/i,
    path: ["Электроника", "Умный дом", "Розетки"],
  },
  {
    re: /ваттметр|ватт[\s-]?метр|счетчик\w*\s*электро|измерител\w*\s*(?:мощност|энерго)|power\s*meter|energy\s*meter/i,
    path: ["Электроника", "Умный дом", "Измерители"],
  },

  // ── furniture ──
  { re: /кресл\w*.{0,40}(комп|игро|гейм|офис|эргоном)|((комп|игро|гейм|офис|эргоном)\w*.{0,40}кресл)|gaming\s*chair|офисн\w*\s*кресл/i, path: ["Мебель", "Кресла компьютерные"] },
  { re: /кресл/i, path: ["Мебель", "Кресла"] },
  { re: /стол\w*.{0,30}(комп|письм|офис)|(комп|письм|офис)\w*.{0,30}стол/i, path: ["Мебель", "Столы"] },

  // ── peripherals ──
  { re: /мышь|мыши|\bmouse\b|мышка/i, path: ["Электроника", "Периферия", "Мыши"] },
  { re: /клавиатур|keyboard/i, path: ["Электроника", "Периферия", "Клавиатуры"] },
  { re: /наушник|гарнитур|headset|headphones?/i, path: ["Электроника", "Аудио", "Наушники"] },
  { re: /монитор(?!инг)|\bmonitor\b/i, path: ["Электроника", "Периферия", "Мониторы"] },

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
  { re: /персональн\w*\s*компьютер|мини[\s-]?пк|настольн|неттоп|моноблок/i, path: PATH_DESKTOP },
  // Bare «ноутбук» only — skip umbrella «ПК, ноутбуки, периферия».
  { re: /^ноутбук/i, path: PATH_NOTEBOOK },
  { re: /usb[\s-]?флеш|флешк|flash/i, path: ["Электроника", "Накопители", "USB-флешки"] },
  { re: /компьютерн\w*\s*мыш|мыш(и|ь|ка)/i, path: ["Электроника", "Периферия", "Мыши"] },
  { re: /кресл|офисн\w*\s*мебел/i, path: ["Мебель", "Кресла компьютерные"] },
  { re: /оперативн|озу|\bram\b/i, path: ["Электроника", "Комплектующие", "Оперативная память"] },
  { re: /смартфон/i, path: ["Электроника", "Телефоны", "Смартфоны"] },
  { re: /умн\w*\s*розетк|электророзетк|smart\s*plug/i, path: ["Электроника", "Умный дом", "Розетки"] },
  { re: /ваттметр|счетчик\w*\s*электро|измерительн\w*\s*инструмент/i, path: ["Электроника", "Умный дом", "Измерители"] },
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
 * Drop trailing brand / model leaves from a cleaned path.
 */
export function stripBrandLeaves(path) {
  const p = [...(path || [])];
  while (p.length && BRAND_LEAF.test(p[p.length - 1])) p.pop();
  return p;
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

function nameBrandText({ name, brand } = {}) {
  return [name, brand].filter(Boolean).join(" \n ");
}

function ruleMatches(rule, text) {
  if (!text) return false;
  if (rule.unless && rule.unless.test(text)) return false;
  return rule.re.test(text);
}

function matchRules(rules, text) {
  for (const rule of rules) {
    if (ruleMatches(rule, text)) return [...rule.path];
  }
  return null;
}

/**
 * Map raw marketplace path + product text → canonical breadcrumb for the catalog tree.
 * Phase 1: name+brand only (avoids DNS umbrella «ПК, ноутбуки…» stealing desktops).
 * Phase 2: full haystack (path + name).
 * Phase 3: segment aliases (skip umbrella segments).
 * Fallback: cleaned raw path without brand leaves.
 * @returns {string[]|null}
 */
export function normalizeCategory(product = {}) {
  const raw = stripBrandLeaves(collapseSiblingTail(product.category_path || []));
  const byName = matchRules(CANON_RULES, nameBrandText(product));
  if (byName) return byName;

  // Drop mixed umbrellas from the path haystack so «ПК, ноутбуки…» cannot steal the type.
  const pathForRules = raw.filter((seg) => !UMBRELLA_SEGMENT.test(seg));
  const text = haystack({ ...product, category_path: pathForRules });
  const byHay = matchRules(CANON_RULES, text);
  if (byHay) return byHay;

  // Segment aliases on cleaned raw path (deepest first); skip mixed umbrellas.
  for (let i = pathForRules.length - 1; i >= 0; i--) {
    const seg = pathForRules[i];
    for (const al of SEGMENT_ALIASES) {
      if (al.re.test(seg)) return [...al.path];
    }
  }

  // Fallback: cleaned raw path if we have anything left.
  return raw.length ? raw : null;
}
