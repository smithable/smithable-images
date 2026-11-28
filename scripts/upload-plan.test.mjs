import assert from "node:assert/strict";
import test from "node:test";
import { NEVER_PUBLISHED, planUpload } from "./upload-plan.mjs";

const index = [
  { id: "cafe-window-p", kind: "hero", sha256: "a".repeat(64) },
  { id: "lamp-b", kind: "sample", sha256: "b".repeat(64) },
  { id: "lamp-c", kind: "sample", sha256: "b".repeat(64) },
];

test("only the published version's entries are sent, by id and by hash", () => {
  const plan = planUpload(index, []);
  assert.deepEqual(plan.byId.map((f) => f.key), ["images/hero/cafe-window-p.webp", "images/sample/lamp-b.webp", "images/sample/lamp-c.webp"]);
  assert.deepEqual(plan.byHash.map((f) => f.key), [`images/files/${"a".repeat(64)}.webp`, `images/files/${"b".repeat(64)}.webp`]);
  // A picture on disk that no entry names (withdrawn, or taken out before publishing) is not in the plan.
  assert.equal([...plan.byId, ...plan.byHash].some((f) => f.src.includes("forest-canopy-p")), false);
});

test("a version never published is not put, and the others are, in order", () => {
  assert.ok(NEVER_PUBLISHED.includes("2026-11-18.5"));
  const plan = planUpload(index, ["2026-11-18.7.json", "2026-11-18.5.json", "2026-11-18.1.json", "notes.txt"]);
  assert.deepEqual(plan.versions, ["2026-11-18.1.json", "2026-11-18.7.json"]);
});

test("an enlarged entry sends its widths too, by id and by hash", () => {
  const plan = planUpload([{ id: "sea-p", kind: "hero", sha256: "c".repeat(64), widths: [{ width: 2400, sha256: "d".repeat(64) }] }], []);
  assert.deepEqual(plan.byId, [
    { src: "images/hero/sea-p.webp", key: "images/hero/sea-p.webp" },
    { src: "images/upscaled/hero/sea-p-2400.webp", key: "images/hero/sea-p-2400.webp" },
  ]);
  assert.deepEqual(plan.byHash.map((f) => f.key), [`images/files/${"c".repeat(64)}.webp`, `images/files/${"d".repeat(64)}.webp`]);
});

test("two files under one name stop the upload", () => {
  const index = [
    { id: "sea", kind: "hero", sha256: "c".repeat(64), widths: [{ width: 1600, sha256: "d".repeat(64) }] },
    { id: "sea-1600", kind: "hero", sha256: "e".repeat(64) },
  ];
  assert.throws(() => planUpload(index, []), /images\/hero\/sea-1600\.webp/);
});
