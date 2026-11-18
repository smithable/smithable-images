import assert from "node:assert/strict";
import test from "node:test";
import { commonsLicence } from "./commons.mjs";

const meta = (more = {}) => ({ License: { value: "cc0" }, LicenseShortName: { value: "CC0" }, Artist: { value: "Someone" }, Credit: { value: "Own work" }, ...more });

test("an own-work CC0 file passes", () => {
  assert.equal(commonsLicence(meta()).ok, true);
  assert.equal(commonsLicence(meta()).copiedFrom, null);
});

test("a Commons copy of a stock site's or Flickr's picture is refused", () => {
  for (const [credit, site] of [
    ['<a href="https://unsplash.com/photos/WJkc3xZjSXw">https://unsplash.com/photos/WJkc3xZjSXw</a>', "unsplash.com"],
    ['<a href="https://www.flickr.com/photos/pixel_la/24244320481">coffee-desk-laptop-notebook</a>', "flickr.com"],
    ["www.Pixel.la Free Stock Photos", "pixel.la"],
  ]) {
    const licence = commonsLicence(meta({ Credit: { value: credit } }));
    assert.equal(licence.ok, false, credit);
    assert.equal(licence.copiedFrom, site);
  }
  assert.equal(commonsLicence(meta({ Artist: { value: "www.Pixel.la Free Stock Photos" } })).copiedFrom, "pixel.la");
});

test("restrictions and other licences are still refused", () => {
  assert.equal(commonsLicence(meta({ Restrictions: { value: "personality" } })).ok, false);
  assert.equal(commonsLicence(meta({ License: { value: "cc-by-sa-4.0" }, LicenseShortName: { value: "CC BY-SA 4.0" } })).ok, false);
});
