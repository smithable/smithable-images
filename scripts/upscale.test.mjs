import assert from "node:assert/strict";
import test from "node:test";
import { classOf, needs, queue, usesOf, widthsFor } from "./upscale.mjs";

const hero = (id, width, tags = []) => ({ id, kind: "hero", width, tags, sha256: id });
const sample = (id, width, uses) => ({ id, kind: "sample", width, tags: [], uses, sha256: id });

test("uses default by kind; logos and icons have none", () => {
  assert.deepEqual(usesOf(hero("h", 1600)), ["hero"]);
  assert.deepEqual(usesOf(sample("s", 900)), ["item"]);
  assert.deepEqual(usesOf(sample("s", 900, ["hero", "filler"])), ["hero", "filler"]);
  assert.deepEqual(usesOf({ id: "l", kind: "logo", width: 512 }), []);
});

test("a picture needs upscaling when it is below one of its uses' minimum", () => {
  assert.equal(needs(hero("h", 1600)), true);
  assert.equal(needs(hero("h", 2400)), false);
  assert.equal(needs(sample("s", 1600)), false);
  assert.equal(needs(sample("s", 1600, ["filler", "hero"])), true);
});

test("the order: app pictures, starters' heroes, heroes, samples with uses, other samples", () => {
  const app = { id: "z-app", kind: "app", app: true, uses: ["hero"], width: 1024, sha256: "app" };
  const order = queue(
    [sample("a-plain", 900), sample("b-marked", 900, ["filler"]), hero("c-hero", 1600), sample("d-as-hero", 900, ["hero"]), hero("e-starter", 1600, ["starter-kiosk"]), app],
    new Set(),
  ).map((e) => e.id);
  assert.deepEqual(order, ["z-app", "e-starter", "c-hero", "d-as-hero", "b-marked", "a-plain"]);
  assert.equal(classOf(app), 0);
});

test("done sources and logos are skipped", () => {
  const order = queue([hero("done", 1600), hero("todo", 1600), { id: "logo", kind: "logo", width: 512, sha256: "logo" }], new Set(["done"]));
  assert.deepEqual(order.map((e) => e.id), ["todo"]);
});

test("served widths come from the uses, above the source and up to the master", () => {
  assert.deepEqual(widthsFor(hero("h", 1600), 3200), [2400]);
  assert.deepEqual(widthsFor(sample("s", 900), 3200), [1200, 1600]);
  assert.deepEqual(widthsFor(sample("s", 900, ["filler", "hero"]), 3200), [800, 1200, 1600, 2400].filter((w) => w > 900));
  assert.deepEqual(widthsFor(sample("s", 600), 2400), [800, 1200, 1600]);
});
