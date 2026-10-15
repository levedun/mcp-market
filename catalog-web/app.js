const rows = document.getElementById("rows");
const empty = document.getElementById("empty");
const meta = document.getElementById("meta");
const qEl = document.getElementById("q");
const mpEl = document.getElementById("marketplace");
const catTree = document.getElementById("cat-tree");
const catAll = document.getElementById("cat-all");
const catEmpty = document.getElementById("cat-empty");

let categoryKey = "";

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

async function load() {
  const params = new URLSearchParams();
  if (mpEl.value) params.set("marketplace", mpEl.value);
  if (qEl.value.trim()) params.set("q", qEl.value.trim());
  if (categoryKey) params.set("category", categoryKey);
  params.set("limit", "200");
  const res = await fetch("/api/products?" + params);
  const data = await res.json();
  if (data.error) {
    meta.textContent = data.error;
    rows.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  meta.textContent = `${data.showing} / ${data.total}`;
  if (!data.items?.length) {
    rows.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  rows.innerHTML = data.items
    .map((p) => {
      const img = p.image_url
        ? `<img class="thumb" src="${esc(p.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
        : `<div class="thumb-empty"></div>`;
      const name = p.url
        ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>`
        : esc(p.name);
      const crumb = p.category_path?.length
        ? `<div class="muted crumb">${esc(p.category_path.join(" › "))}</div>`
        : "";
      const rating = p.rating != null ? p.rating.toFixed(1) : "—";
      const reviews = p.reviews_count != null ? p.reviews_count : "—";
      return `<tr>
        <td>${img}</td>
        <td><span class="badge ${esc(p.marketplace)}">${esc(p.marketplace)}</span></td>
        <td>${name}${p.brand ? `<div class="muted">${esc(p.brand)}</div>` : ""}${crumb}</td>
        <td class="price">${rub(p.price)}</td>
        <td>${rating}</td>
        <td>${reviews}</td>
        <td class="muted when">${fmtWhen(p.last_seen_at)}</td>
        <td class="muted">${p.seen_count ?? 1}</td>
      </tr>`;
    })
    .join("");
}

async function refresh() {
  await loadCategories();
  await load();
}

let t;
qEl.addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(load, 200);
});
mpEl.addEventListener("change", () => {
  setActiveCat("");
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
document.getElementById("reload").addEventListener("click", refresh);
refresh();
