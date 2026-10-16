import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractProducts, normalizeItem } from "../src/catalog/normalize.js";
import { openCatalogDb, metricsChanged } from "../src/catalog/db.js";
import { upsertProducts, listProducts, countProducts, listCategoryTree, matchesQuery, backfillCategoryNorm } from "../src/catalog/ingest.js";
import { normalizeCategory, collapseSiblingTail, stripNoiseRoots } from "../src/catalog/categories.js";

{
  assert.deepEqual(stripNoiseRoots(["Каталог", "Офис и мебель"]), ["Офис и мебель"]);
  assert.deepEqual(
    collapseSiblingTail([
      "Мебель",
      "Компьютерная и офисная мебель",
      "Кресла офисные и компьютерные",
      "Офисные кресла",
      "Компьютерные кресла игровые",
      "Компьютерные кресла детские",
    ]),
    ["Мебель", "Компьютерная и офисная мебель", "Кресла офисные и компьютерные"]
  );
  assert.deepEqual(
    normalizeCategory({ name: "Мышь беспроводная Logitech", category_path: ["Каталог", "Периферия"] }),
    ["Электроника", "Периферия", "Мыши"]
  );
  assert.deepEqual(
    normalizeCategory({
      name: "Кресло игровое",
      category_path: ["Каталог", "Офис и мебель", "Офисная мебель"],
    }),
    ["Мебель", "Кресла компьютерные"]
  );
  assert.deepEqual(
    normalizeCategory({ name: "USB флешка 64GB", category_path: null }),
    ["Электроника", "Накопители", "USB-флешки"]
  );
  // Specs in finished-PC titles must not win over the device type.
  assert.deepEqual(
    normalizeCategory({
      name: "HUNSIO Мини-ПК (Intel Core i9-13900HX, RAM 16 ГБ, SSD 1000 ГБ, NVIDIA GeForce RTX 4060 (8 Гб), Windows 11 Pro), серый",
    }),
    ["Электроника", "Компьютеры", "Настольные и мини-ПК"]
  );
  assert.deepEqual(
    normalizeCategory({ name: "Ноутбук ASUS 16 ГБ SSD 512 ГБ RTX 4050" }),
    ["Электроника", "Компьютеры", "Ноутбуки"]
  );
  // Standalone parts still map to components.
  assert.deepEqual(
    normalizeCategory({ name: "SSD Samsung 990 PRO 1 ТБ NVMe" }),
    ["Электроника", "Накопители", "Диски и SSD"]
  );
  assert.deepEqual(
    normalizeCategory({ name: "Оперативная память Kingston DDR5 16 ГБ" }),
    ["Электроника", "Комплектующие", "Оперативная память"]
  );
  // DNS umbrella «ПК, ноутбуки…» must not classify desktop PCs as notebooks.
  assert.deepEqual(
    normalizeCategory({
      name: "ПК ARDOR GAMING RAGE H416",
      category_path: ["Каталог", "ПК, ноутбуки, периферия", "Компьютеры и ПО", "Персональные компьютеры"],
    }),
    ["Электроника", "Компьютеры", "Настольные и мини-ПК"]
  );
  assert.deepEqual(
    normalizeCategory({
      name: "Умная розетка TP-LINK Tapo P110",
      category_path: ["Строительство и ремонт", "Электрика", "Розетки, вилки и выключатели", "Электророзетки"],
    }),
    ["Электроника", "Умный дом", "Розетки"]
  );
  assert.deepEqual(
    normalizeCategory({
      name: "Atorch Wi Fi цифровой ваттметр 220В AC",
      category_path: ["Строительство и ремонт", "Инструменты", "Измерительные инструменты", "Счетчики электроэнергии"],
    }),
    ["Электроника", "Умный дом", "Измерители"]
  );
  // Brand leaf stripped from fallback path.
  assert.deepEqual(
    normalizeCategory({
      name: "Кабель HDMI no-match-xyz",
      category_path: ["Электроника", "Кабели", "Xiaomi"],
    }),
    ["Электроника", "Кабели"]
  );
}

{
  const p = {
    name: "Кресло компьютерное ZOMBIE",
    brand: "ZOMBIE",
    category_path: ["Мебель", "Кресла офисные"],
  };
  assert.equal(matchesQuery(p, ""), true);
  assert.equal(matchesQuery(p, "крес"), true);
  assert.equal(matchesQuery(p, "кресло комп"), true);
  assert.equal(matchesQuery(p, "комп кресло"), true); // tokens, any order
  assert.equal(matchesQuery(p, "офис"), true); // category
  assert.equal(matchesQuery(p, "мышь"), false);
}

{
  const ozon = normalizeItem({
    sku: "123",
    name: "Ноутбук",
    price: 50000,
    oldPrice: 60000,
    rating: 4.8,
    reviews: 120,
    brand: "ASUS",
    url: "https://www.ozon.ru/product/123/",
    image: "https://cdn/x.jpg",
    categories: ["Электроника", "Ноутбуки"],
  }, "ozon");
  assert.equal(ozon.marketplace, "ozon");
  assert.equal(ozon.external_id, "123");
  assert.equal(ozon.old_price, 60000);
  assert.deepEqual(ozon.category_path, ["Электроника", "Ноутбуки"]);
}

{
  const dns = normalizeItem({
    name: "DNS Item",
    price: 1000,
    url: "https://www.dns-shop.ru/product/abcdef0123456789/slug/",
    image: "https://c.dns-shop.ru/thumb/x.jpg",
  }, "dns");
  assert.equal(dns.external_id, "abcdef0123456789");
  assert.equal(dns.image_url, "https://c.dns-shop.ru/thumb/x.jpg");

  const ya = normalizeItem({
    name: "Yandex Chair Long Enough Name",
    price: 5000,
    id: "1234567890",
    url: "https://market.yandex.ru/card/x/1234567890",
    image: "https://avatars.mds.yandex.net/get-mpic/1/img",
  }, "yandex");
  assert.equal(ya.image_url, "https://avatars.mds.yandex.net/get-mpic/1/img");
}

{
  const fromSearch = extractProducts("ozon_search", {
    items: [
      { sku: "1", name: "A", price: 10, url: "https://www.ozon.ru/product/1/", categories: ["Электроника", "USB-флешки"] },
      { sku: "2", name: "B", price: 20, url: "https://www.ozon.ru/product/2/" },
    ],
  });
  assert.equal(fromSearch.length, 2);
  assert.deepEqual(fromSearch[0].category_path, ["Электроника", "USB-флешки"]);
  assert.equal(fromSearch[1].category_path, null);

  const fromCompare = extractProducts("compare", {
    items: [
      { site: "ozon", name: "X", price: 1, url: "https://www.ozon.ru/product/9/", rating: 4.5, reviews: 10 },
      { site: "dns", name: "Y", error: "fail" },
    ],
  });
  assert.equal(fromCompare.length, 1);
  assert.equal(fromCompare[0].marketplace, "ozon");

  assert.equal(extractProducts("ozon_filters", { filters: [] }).length, 0);
  assert.equal(extractProducts("ozon_product_reviews", { reviews: [] }).length, 0);
}

{
  const dir = mkdtempSync(join(tmpdir(), "catalog-"));
  const dbPath = join(dir, "catalog.db");
  const db = openCatalogDb(dbPath);
  const p = {
    marketplace: "ozon",
    external_id: "42",
    url: "https://www.ozon.ru/product/42/",
    name: "Test",
    brand: null,
    price: 100,
    old_price: null,
    currency: "RUB",
    rating: 4.5,
    reviews_count: 3,
    image_url: null,
    category_path: ["Электроника", "Смартфоны"],
    attrs: null,
  };
  let s = upsertProducts(db, [p], { sourceTool: "ozon_search", now: "2026-01-01T00:00:00.000Z" });
  assert.equal(s.upserted, 1);
  assert.equal(s.snapshots, 1);
  assert.equal(countProducts(db), 1);
  assert.deepEqual(listProducts(db)[0].category_path, ["Электроника", "Смартфоны"]);
  assert.deepEqual(listProducts(db)[0].category_norm, ["Электроника", "Телефоны", "Смартфоны"]);

  s = upsertProducts(db, [p], { sourceTool: "ozon_search", now: "2026-01-02T00:00:00.000Z" });
  assert.equal(s.snapshots, 0); // unchanged metrics → no snapshot
  assert.equal(listProducts(db)[0].seen_count, 2);

  // search without categories must not wipe path
  s = upsertProducts(db, [{ ...p, category_path: null, price: 90 }], { sourceTool: "ozon_search", now: "2026-01-03T00:00:00.000Z" });
  assert.equal(s.snapshots, 1);
  assert.equal(listProducts(db)[0].price, 90);
  assert.deepEqual(listProducts(db)[0].category_path, ["Электроника", "Смартфоны"]);

  upsertProducts(db, [{
    ...p,
    external_id: "43",
    name: "RAM Kingston",
    category_path: ["Электроника", "Комплектующие", "ОЗУ"],
  }], { now: "2026-01-04T00:00:00.000Z" });
  const tree = listCategoryTree(db);
  assert.equal(tree[0].name, "Электроника");
  assert.equal(tree[0].count, 2);
  assert.equal(listProducts(db, { category: "Электроника\u001fТелефоны\u001fСмартфоны" }).length, 1);
  assert.equal(listProducts(db, { q: "смарт" }).length, 1);
  assert.equal(listProducts(db, { q: "kingston памят" }).length, 1);
  assert.equal(listProducts(db, { q: "ноутбук" }).length, 0);

  const bf = backfillCategoryNorm(db);
  assert.equal(bf.updated, 2);

  const snaps = db.prepare("SELECT COUNT(*) AS n FROM product_snapshots").get().n;
  assert.equal(snaps, 3);
  assert.equal(metricsChanged(null, p), true);
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log("catalog.test.js: ok");
