/** Absolute http(s) URL from an <img>-like object (src / data-src / srcset); skips data: placeholders. */
export function imgUrlFromEl(img, base = "https://www.example.com") {
  if (!img) return null;
  const attr = (k) => (typeof img.getAttribute === "function" ? img.getAttribute(k) : null);
  const raw =
    img.currentSrc ||
    attr("data-src") ||
    attr("data-url") ||
    img.src ||
    (img.srcset || attr("srcset") || "").split(",")[0]?.trim().split(/\s+/)[0] ||
    "";
  const s = String(raw || "").trim();
  if (!s || /^data:/i.test(s)) return null;
  try {
    const u = new URL(s, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}
