const rows = document.getElementById("rows");
const empty = document.getElementById("empty");
const meta = document.getElementById("meta");
const qEl = document.getElementById("q");
const mpEl = document.getElementById("marketplace");
const catTree = document.getElementById("cat-tree");
const catAll = document.getElementById("cat-all");
const catEmpty = document.getElementById("cat-empty");
const detailEmpty = document.getElementById("detail-empty");
const detailBody = document.getElementById("detail-body");

let categoryKey = "";
/** @type {Map<string, object>} */
let itemsByKey = new Map();
/** Last marketplace/category window from API (no text q). Instant typeahead filters this. */
let cacheItems = [];
let lastTotal = 0;
let selectedKey = "";
let loadAbort = null;
let qTimer = null;
let loadSeq = 0;

function productKey(p) {
  return `${p.marketplace}\u001f${p.external_id}`;
}

function rub(n) {
  if (n == null) return "—";
  return new Intl.NumberFormat("ru-RU").format(n) + " ₽";
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** All query tokens must appear in name, brand or category path. */
function matchesQuery(p, q) {
  const tokens = String(q || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return true;
  const hay = [p.name, p.brand, ...(p.category_norm || []), ...(p.category_path || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function setActiveCat(key) {
  categoryKey = key || "";
  catAll.classList.toggle("active", !categoryKey);
  catTree.querySelectorAll("[data-key]").forEach((el) => {
    el.classList.toggle("active", el.dataset.key === categoryKey);
  });
}

function renderTree(nodes, depth = 0) {
  if (!nodes?.length) return "";
  return nodes
    .map((n) => {
      const kids = renderTree(n.children, depth + 1);
      return `<div class="cat-node" style="--d:${depth}">
        <button type="button" class="cat-btn" data-key="${esc(n.key)}" title="${esc(n.path.join(" › "))}">
          <span class="cat-name">${esc(n.name)}</span>
          <span class="cat-count">${n.count}</span>
        </button>
        ${kids ? `<div class="cat-kids">${kids}</div>` : ""}
      </div>`;
    })
    .join("");
}

function clearDetail() {
  selectedKey = "";
  detailEmpty.classList.remove("hidden");
  detailBody.classList.add("hidden");
  detailBody.innerHTML = "";
  rows.querySelectorAll("tr.selected").forEach((tr) => tr.classList.remove("selected"));
}

function showDetail(p) {
  if (!p) {
    clearDetail();
    return;
  }
  selectedKey = productKey(p);
  detailEmpty.classList.add("hidden");
  detailBody.classList.remove("hidden");

  const img = p.image_url
    ? `<img class="detail-img" src="${esc(p.image_url)}" alt="" referrerpolicy="no-referrer" />`
    : `<div class="detail-img-empty" aria-hidden="true"></div>`;
  const oldPrice =
    p.old_price != null && p.price != null && p.old_price > p.price
      ? `<span class="old">${rub(p.old_price)}</span>`
      : "";
  const norm = p.category_norm?.length ? p.category_norm : null;
  const raw = p.category_path?.length ? p.category_path : null;
  const crumb = norm
    ? `<p class="detail-crumb">${esc(norm.join(" › "))}</p>`
    : raw
      ? `<p class="detail-crumb">${esc(raw.join(" › "))}</p>`
      : "";
  const rawLine =
    norm && raw && raw.join("\u001f") !== norm.join("\u001f")
      ? `<p class="detail-raw muted">На площадке: ${esc(raw.join(" › "))}</p>`
      : "";
  const link = p.url
    ? `<a class="detail-link" href="${esc(p.url)}" target="_blank" rel="noopener">Открыть на площадке</a>`
    : `<p class="detail-no-link">Ссылка на источник отсутствует</p>`;

  detailBody.innerHTML = `
    ${img}
    <span class="badge ${esc(p.marketplace)}">${esc(p.marketplace)}</span>
    <h2 class="detail-title">${esc(p.name)}</h2>
    ${p.brand ? `<p class="detail-brand">${esc(p.brand)}</p>` : ""}
    ${crumb}
    ${rawLine}
    <dl class="detail-dl">
      <dt>Цена</dt><dd>${rub(p.price)}${oldPrice}</dd>
      <dt>Рейтинг</dt><dd>${p.rating != null ? p.rating.toFixed(1) : "—"}</dd>
      <dt>Отзывы</dt><dd>${p.reviews_count != null ? p.reviews_count : "—"}</dd>
      <dt>ID</dt><dd>${esc(p.external_id)}</dd>
      <dt>Обновлён</dt><dd>${fmtWhen(p.last_seen_at)}</dd>
      <dt>Первый раз</dt><dd>${fmtWhen(p.first_seen_at)}</dd>
      <dt>Видели</dt><dd>${p.seen_count ?? 1}</dd>
    </dl>
    ${link}
  `;

  rows.querySelectorAll("tr[data-key]").forEach((tr) => {
    tr.classList.toggle("selected", tr.dataset.key === selectedKey);
  });
}

function renderRows(items) {
  itemsByKey = new Map(items.map((p) => [productKey(p), p]));
  if (!items.length) {
    rows.innerHTML = "";
    empty.classList.remove("hidden");
    if (selectedKey) clearDetail();
    return;
  }
  empty.classList.add("hidden");
  rows.innerHTML = items
    .map((p) => {
      const key = productKey(p);
      const img = p.image_url
        ? `<img class="thumb" src="${esc(p.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
        : `<div class="thumb-empty"></div>`;
      const cat = p.category_norm?.length ? p.category_norm : p.category_path;
      const crumb = cat?.length
        ? `<div class="muted crumb">${esc(cat.join(" › "))}</div>`
        : "";
      const rating = p.rating != null ? p.rating.toFixed(1) : "—";
      const reviews = p.reviews_count != null ? p.reviews_count : "—";
      const selected = key === selectedKey ? " selected" : "";
      return `<tr data-key="${esc(key)}" class="${selected.trim()}">
        <td>${img}</td>
        <td><span class="badge ${esc(p.marketplace)}">${esc(p.marketplace)}</span></td>
        <td>${esc(p.name)}${p.brand ? `<div class="muted">${esc(p.brand)}</div>` : ""}${crumb}</td>
        <td class="price">${rub(p.price)}</td>
        <td>${rating}</td>
        <td>${reviews}</td>
        <td class="muted when">${fmtWhen(p.last_seen_at)}</td>
        <td class="muted">${p.seen_count ?? 1}</td>
      </tr>`;
    })
    .join("");

  if (selectedKey && itemsByKey.has(selectedKey)) {
    showDetail(itemsByKey.get(selectedKey));
  } else if (selectedKey) {
    clearDetail();
  }
}

/** Instant filter of the cached marketplace/category window (no network). */
function applyLocalFilter() {
  const q = qEl.value;
  const filtered = cacheItems.filter((p) => matchesQuery(p, q)).slice(0, 200);
  meta.textContent = q.trim()
    ? `${filtered.length} из кэша ${cacheItems.length} · в БД ${lastTotal}`
    : `${filtered.length} / ${lastTotal}`;
  renderRows(filtered);
}

async function loadCategories() {
  const params = new URLSearchParams();
  if (mpEl.value) params.set("marketplace", mpEl.value);
  const res = await fetch("/api/categories?" + params);
  const data = await res.json();
  if (data.error || !data.tree?.length) {
    catTree.innerHTML = "";
    catEmpty.classList.toggle("hidden", !!data.tree?.length);
    if (categoryKey) setActiveCat("");
    return;
  }
  catEmpty.classList.add("hidden");
  catTree.innerHTML = renderTree(data.tree);
  setActiveCat(categoryKey);
}

/**
 * Fetch products. Without text q → refresh typeahead cache.
 * With q → server search over a wider DB window; show hits (cache unchanged).
 */
async function load(opts = {}) {
  const q = qEl.value.trim();
  const withQ = Boolean(opts.withQ && q);
  const seq = ++loadSeq;
  if (loadAbort) loadAbort.abort();
  loadAbort = new AbortController();

  const params = new URLSearchParams();
  if (mpEl.value) params.set("marketplace", mpEl.value);
  if (withQ) params.set("q", q);
  if (categoryKey) params.set("category", categoryKey);
  params.set("limit", withQ ? "200" : "2000");

  try {
    const res = await fetch("/api/products?" + params, { signal: loadAbort.signal });
    const data = await res.json();
    if (seq !== loadSeq) return;
    if (data.error) {
      meta.textContent = data.error;
      cacheItems = [];
      lastTotal = 0;
      itemsByKey = new Map();
      empty.classList.remove("hidden");
      rows.innerHTML = "";
      clearDetail();
      return;
    }
    lastTotal = data.total ?? 0;
    const items = data.items || [];
    if (withQ) {
      meta.textContent = `${items.length} найдено · в БД ${lastTotal}`;
      renderRows(items);
    } else {
      cacheItems = items;
      applyLocalFilter();
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (seq !== loadSeq) return;
    meta.textContent = err?.message || String(err);
  }
}

async function refresh() {
  await loadCategories();
  await load();
}

function onQueryInput() {
  applyLocalFilter();
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    const q = qEl.value.trim();
    if (q) load({ withQ: true });
    else load();
  }, 180);
}

qEl.addEventListener("input", onQueryInput);
mpEl.addEventListener("change", () => {
  setActiveCat("");
  clearDetail();
  refresh();
});
catAll.addEventListener("click", () => {
  setActiveCat("");
  load();
});
catTree.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-key]");
  if (!btn) return;
  setActiveCat(btn.dataset.key);
  load();
});
rows.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-key]");
  if (!tr) return;
  const p = itemsByKey.get(tr.dataset.key);
  if (p) showDetail(p);
});
document.getElementById("reload").addEventListener("click", refresh);
refresh();
