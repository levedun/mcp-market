const rows = document.getElementById("rows");
const empty = document.getElementById("empty");
const meta = document.getElementById("meta");
const qEl = document.getElementById("q");
const mpEl = document.getElementById("marketplace");

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

async function load() {
  const params = new URLSearchParams();
  if (mpEl.value) params.set("marketplace", mpEl.value);
  if (qEl.value.trim()) params.set("q", qEl.value.trim());
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
      const rating = p.rating != null ? p.rating.toFixed(1) : "—";
      const reviews = p.reviews_count != null ? p.reviews_count : "—";
      return `<tr>
        <td>${img}</td>
        <td><span class="badge ${esc(p.marketplace)}">${esc(p.marketplace)}</span></td>
        <td>${name}${p.brand ? `<div class="muted">${esc(p.brand)}</div>` : ""}</td>
        <td class="price">${rub(p.price)}</td>
        <td>${rating}</td>
        <td>${reviews}</td>
        <td class="muted">${p.seen_count ?? 1}</td>
      </tr>`;
    })
    .join("");
}

let t;
qEl.addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(load, 200);
});
mpEl.addEventListener("change", load);
document.getElementById("reload").addEventListener("click", load);
load();
