import assert from "node:assert/strict";
import test from "node:test";
import { CC0, isPhotoId, readPhotoPage } from "./wordpress.mjs";

const id = "79635261b4";
const page = (record, canonical = `https://wordpress.org/photos/photo/${id}/`) =>
  `<html><head><link rel="canonical" href="${canonical}"></head><body>
<script type="application/ld+json">${JSON.stringify(record)}</script></body></html>`;
const record = (more = {}) => ({
  "@context": "https://schema.org",
  "@type": "ImageObject",
  contentUrl: "https://pd.w.org/2022/10/79635261b49ad9b1.68416335.jpg",
  license: CC0,
  creator: { "@type": "Person", name: "Roy Tanck" },
  ...more,
});

test("a CC0 photo page gives its picture, author and page", () => {
  assert.deepEqual(readPhotoPage(page(record()), id), {
    image: "https://pd.w.org/2022/10/79635261b49ad9b1.68416335.jpg",
    author: "Roy Tanck",
    licence: "CC0 1.0",
    page: `https://wordpress.org/photos/photo/${id}/`,
  });
});

test("anything the page does not state plainly is refused", () => {
  const refused = (html) => readPhotoPage(html, id).refused;
  assert.match(refused(page(record({ license: "https://creativecommons.org/licenses/by/4.0/" }))), /not CC0/);
  assert.match(refused(page(record({ license: undefined }))), /licence is missing/);
  assert.match(refused(page(record({ contentUrl: "https://example.com/x.jpg" }))), /not pd.w.org/);
  assert.match(refused(page(record({ contentUrl: "http://pd.w.org/x.jpg" }))), /not pd.w.org/);
  assert.match(refused(page(record({ creator: {} }))), /no author/);
  assert.match(refused(page(record(), "https://wordpress.org/photos/photo/0000000000/")), /canonical/);
  assert.match(refused("<html></html>"), /canonical missing/);
  const two = page(record()).replace("</body>", `<script type="application/ld+json">${JSON.stringify(record())}</script></body>`);
  assert.match(refused(two), /2 image records/);
});

test("a photo id is the ten hex digits of its page address", () => {
  assert.equal(isPhotoId(id), true);
  for (const bad of ["79635261b", "79635261B4", "../photos/", 79635261]) assert.equal(isPhotoId(bad), false);
});
