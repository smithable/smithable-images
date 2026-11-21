import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { groupGaps, matchNeed, newSubjects, starterFiles, starterGaps } from "./gaps.mjs";

const e = (id, kind, style, subject, tags = [], orientation = "landscape") => ({ id, kind, style, subject, tags, orientation });

const index = [
  e("salon-b", "hero", "lifelike", "hero-salon"),
  e("haircut-b", "sample", "lifelike", "service-haircut", ["people"]),
  e("haircut-p", "sample", "photographs", "service-haircut", ["person"]),
  e("haircut-tall", "sample", "lifelike", "haircut-tall", ["people"], "portrait"),
  e("haircut-ink", "sample", "ink-wash", "service-haircut", ["people"]),
  e("coffee-b", "sample", "lifelike", "drink-coffee", ["starter-kiosk"]),
  e("coffee-p", "sample", "photographs", "drink-coffee-2", []),
  e("bread-b", "sample", "lifelike", "food-bread", ["starter-kiosk"]),
  e("laptop-1-b", "sample", "lifelike", "market-laptop-1", []),
  e("laptop-ink", "sample", "ink-wash", "market-laptop", []),
];
const styles = ["photographs", "lifelike"];

test("a need is met by a photographic landscape of its kind, subject and people, one per subject, at most target", () => {
  assert.deepEqual(matchNeed(index, { kind: "sample", subject: ["service-haircut"], people: true, target: 2 }, styles), {
    matched_ids: ["haircut-b"],
    missing: 1,
  });
  assert.deepEqual(matchNeed(index, { kind: "sample", subject: ["service-haircut"], people: false, target: 1 }, styles).missing, 1);
  assert.deepEqual(matchNeed(index, { kind: "sample", subject: ["haircut-tall"], people: true, target: 1 }, styles).missing, 1);
  assert.deepEqual(matchNeed(index, { kind: "sample", subject: ["market-laptop"], people: false, target: 1 }, styles).missing, 1);
});

test("a hero serves a sample need but not the other way, and the first subject listed is preferred", () => {
  assert.deepEqual(matchNeed(index, { kind: "sample", subject: ["hero-salon"], people: false, target: 1 }, styles).matched_ids, ["salon-b"]);
  assert.equal(matchNeed(index, { kind: "hero", subject: ["drink-coffee"], people: false, target: 1 }, styles).missing, 1);
  const both = { kind: "sample", subject: ["food-bread", "drink-coffee"], people: false, target: 1 };
  assert.deepEqual(matchNeed(index, both, styles).matched_ids, ["bread-b"]);
});

test("new subject keys come with the index's subjects that share a word", () => {
  assert.deepEqual(newSubjects(index, ["finished-haircut", "hero-salon", "kayak"]), [
    { key: "finished-haircut", near: ["haircut-tall", "service-haircut"] },
    { key: "kayak", near: [] },
  ]);
});

test("needs are ranked by groups, then counts; never groups are left out", () => {
  const need = (subject) => ({ slot: "hero", kind: "hero", subject: [subject], people: false, target: 1 });
  const groups = [
    { trade: "a", class: "write", count: { aland: 3, finland: { n: 4, date: "2026-11-21" } }, pictures: [need("x"), need("y")] },
    { trade: "b", class: "write", count: 1, pictures: [need("y"), need("z")] },
    { trade: "c", class: "never", count: 99, pictures: [need("z"), need("z")] },
    { trade: "d", pictures: [need("hero-salon")] },
  ];
  const r = groupGaps(index, groups, styles);
  assert.deepEqual(
    r.ranked.map((n) => [n.need, n.groups, n.count]),
    [
      ["hero:y:none", ["a", "b"], 8],
      ["hero:x:none", ["a"], 7],
      ["hero:z:none", ["b"], 1],
    ],
  );
  assert.equal(r.groups[3].pictures[0].missing, 0);
  assert.deepEqual(
    r.new_subjects.map((n) => n.key),
    ["x", "y", "z"],
  );
});

test("starters' needs: tagged subjects and their sample files, an alternate counts for its subject", () => {
  const dir = mkdtempSync(join(tmpdir(), "gaps-"));
  mkdirSync(join(dir, "kiosk", "samples"), { recursive: true });
  mkdirSync(join(dir, "marketplace", "samples"), { recursive: true });
  writeFileSync(join(dir, "kiosk", "samples", "Dish.yml"), "- photos: [{ file: coffee-b.webp }, { file: 0.webp }]\n");
  writeFileSync(join(dir, "marketplace", "samples", "Item.yml"), '- photos:\n    - { file: "market-laptop-1.webp" }\n');
  const files = starterFiles(dir);
  assert.deepEqual(files, { kiosk: ["coffee-b", "0"], marketplace: ["market-laptop-1"] });
  assert.deepEqual(starterGaps(index, styles, files), {
    starters: [
      { starter: "kiosk", style: "photographs", missing: [{ subject: "food-bread", kind: "sample" }] },
      { starter: "marketplace", style: "photographs", missing: [{ subject: "market-laptop", kind: "sample" }] },
    ],
    unknown: [{ starter: "kiosk", file: "0" }],
  });
});

test("an alternate's starter tag counts for its subject; a repeated key counts once; YAML comments are not files", () => {
  const ix = [...index, e("coffee-p2", "sample", "photographs", "drink-coffee-3", ["starter-cafe"])];
  assert.deepEqual(starterGaps(ix, ["ink-wash"]).starters.find((s) => s.starter === "cafe"), {
    starter: "cafe",
    style: "ink-wash",
    missing: [{ subject: "drink-coffee", kind: "sample" }],
  });
  assert.equal(matchNeed(index, { kind: "sample", subject: ["food-bread", "food-bread"], people: false, target: 2 }, styles).missing, 1);
  const dir = mkdtempSync(join(tmpdir(), "gaps-"));
  mkdirSync(join(dir, "kiosk", "samples"), { recursive: true });
  writeFileSync(join(dir, "kiosk", "samples", "Dish.yml"), "# file: ghost.webp\n- &a { cover: { file: 'bread-b.webp' } }\n- *a\n");
  assert.deepEqual(starterFiles(dir), { kiosk: ["bread-b"] });
});

test("--out refuses a path inside the library", () => {
  const script = fileURLToPath(new URL("./gaps.mjs", import.meta.url));
  const inside = fileURLToPath(new URL("./.gaps-test-out.json", import.meta.url));
  const r = spawnSync(process.execPath, [script, "--out", inside], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /inside the library/);
  assert.equal(existsSync(inside), false);
  // A link outside the library that points into it is replaced, never written through.
  const dir = mkdtempSync(join(tmpdir(), "gaps-"));
  writeFileSync(join(dir, "target.json"), "keep");
  symlinkSync(join(dir, "target.json"), join(dir, "sym.json"));
  linkSync(join(dir, "target.json"), join(dir, "hard.json"));
  symlinkSync(join(dir, "missing.json"), join(dir, "dangling.json"));
  for (const f of ["sym.json", "hard.json", "dangling.json", "gaps.json"]) assert.equal(spawnSync(process.execPath, [script, "--out", join(dir, f)]).status, 0);
  assert.equal(readFileSync(join(dir, "target.json"), "utf8"), "keep");
  assert.equal(existsSync(join(dir, "missing.json")), false);
});
