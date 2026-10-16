import assert from "node:assert/strict";
import { imgUrlFromEl } from "../src/card_image.js";

assert.equal(imgUrlFromEl(null), null);
assert.equal(imgUrlFromEl({ src: "data:image/gif;base64,xx" }), null);
assert.equal(
  imgUrlFromEl({ src: "https://c.dns-shop.ru/thumb/1.jpg" }),
  "https://c.dns-shop.ru/thumb/1.jpg"
);
assert.equal(
  imgUrlFromEl({
    src: "",
    getAttribute: (k) => (k === "data-src" ? "//c.dns-shop.ru/lazy.jpg" : null),
  }, "https://www.dns-shop.ru"),
  "https://c.dns-shop.ru/lazy.jpg"
);
assert.equal(
  imgUrlFromEl({
    src: "",
    srcset: "https://avatars.mds.yandex.net/a 1x, https://avatars.mds.yandex.net/b 2x",
    getAttribute: () => null,
  }),
  "https://avatars.mds.yandex.net/a"
);

console.log("card_image.test.js: ok");
