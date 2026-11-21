import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The published index carries what an app needs to place a picture and credit it, nothing more.
// The needs file gaps.mjs reads with --needs is kept outside this library, and none of its keys may
// reach the index: every key an entry carries must be one make-images.mjs writes, with a value of
// the shape it writes (text, a number, a flag, a list of text, or one of the records below, down to
// their leaves), so a new key is added here on purpose, never by a stray merge of the two.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const text = (v) => typeof v === "string";
const number = (v) => typeof v === "number" && Number.isFinite(v);
const flag = (v) => typeof v === "boolean";
const texts = (v) => Array.isArray(v) && v.every(text);
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
// A record whose keys are all in shape, each value passing its check; failures name the path.
function checkRecord(value, shape, where) {
  assert.ok(isRecord(value), `${where} is a record`);
  for (const [key, v] of Object.entries(value)) {
    assert.ok(Object.hasOwn(shape, key), `${where} has the key ${key}`);
    shape[key](v, `${where}.${key}`);
  }
}
const leaf = (check) => (v, where) => assert.ok(check(v), `${where} has a value of the wrong shape`);
const CREDIT = Object.fromEntries(["page", "author", "licence", "licenceUrl", "uploaded", "evidence", "fetched"].map((k) => [k, leaf(text)]));
const ENTRY = {
  ...Object.fromEntries(
    ["id", "kind", "url", "alt", "style", "subject", "sha256", "orientation", "tone", "temperature", "color", "source"].map((k) => [k, leaf(text)]),
  ),
  ...Object.fromEntries(["width", "height", "bytes"].map((k) => [k, leaf(number)])),
  photo: leaf(flag),
  generated: leaf(flag),
  tags: leaf(texts),
  credit: (v, where) => checkRecord(v, CREDIT, where),
};
// A style's words: per language, exactly a name and a line. Three versions of 2026-11-18 were
// published before make-images.mjs refused an unquoted comma in YAML, so their English line for
// photographs split into a second, empty key; they stay as published, and only that key is let by.
const WORDS = { name: leaf(text), line: leaf(text) };
const SPLIT_LINE = "dedicated to the public domain by their authors.";
const SPLIT_IN = ["versions/2026-11-18.1.json", "versions/2026-11-18.2.json", "versions/2026-11-18.3.json"];
const STYLE = {
  id: leaf(text),
  generated: leaf(flag),
  drawn: leaf(flag),
  words: (v, where) => {
    assert.ok(isRecord(v), `${where} is a record`);
    for (const [lang, w] of Object.entries(v)) {
      const split = SPLIT_IN.some((file) => where.startsWith(`${file}.`)) && lang === "en" && Object.hasOwn(w, SPLIT_LINE);
      checkRecord(split ? { ...w, [SPLIT_LINE]: undefined } : w, split ? { ...WORDS, [SPLIT_LINE]: leaf((x) => x === undefined || x === null) } : WORDS, `${where}.${lang}`);
    }
  },
};
const list = (shape) => (v, where) => {
  assert.ok(Array.isArray(v), `${where} is a list`);
  v.forEach((item, i) => checkRecord(item, shape, `${where}[${i}]`));
};
const VERSION = { version: leaf(text), styles: list(STYLE), entries: list(ENTRY) };
// The needs file's own keys, as gaps.mjs describes them (kind and subject are the library's words,
// which the needs borrow).
const NEEDS_KEYS = ["name", "trade", "class", "count", "pictures", "slot", "target", "people"];

const read = (file) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));
const versionFiles = () =>
  readdirSync(join(ROOT, "versions"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => `versions/${f}`);

// A style's words are a language's display text, whose "name" is the style's own, so they are left out.
test("no shape allows a key of the needs file", () => {
  for (const shape of [ENTRY, CREDIT, STYLE, VERSION]) for (const key of NEEDS_KEYS) assert.ok(!Object.hasOwn(shape, key), key);
});

test("latest.json names a version file that is published", () => {
  const latest = read("latest.json");
  checkRecord(latest, { version: leaf(text), index: leaf(text) }, "latest.json");
  assert.equal(latest.index, `versions/${latest.version}.json`);
  assert.ok(versionFiles().includes(latest.index), `${latest.index} is in versions/`);
});

test("index.json and every version carry only the index's own keys, down to their leaves", () => {
  list(ENTRY)(read("index.json"), "index.json");
  const files = versionFiles();
  assert.ok(files.length > 0, "versions/ holds the published versions");
  for (const file of files) checkRecord(read(file), VERSION, file);
});

test("the checks catch a key or a value out of shape at any depth", () => {
  const entry = { id: "a", tags: ["x"], credit: { page: "p" } };
  const bad = [
    { ...entry, points: ["booking"] },
    { ...entry, tags: [{ people: true }] },
    { ...entry, credit: { page: "p", count: 3 } },
    { ...entry, credit: [] },
    42,
  ];
  for (const b of bad) assert.throws(() => list(ENTRY)([b], "x"));
  assert.doesNotThrow(() => list(ENTRY)([entry], "x"));
  const style = { id: "s", generated: false, words: { en: { name: "N", line: "L" } } };
  assert.throws(() => checkRecord({ version: "v", styles: [{ ...style, words: { en: { name: "N", line: "L", slot: "x" } } }], entries: [] }, VERSION, "v"));
  assert.throws(() => checkRecord({ version: "v", styles: [false], entries: [] }, VERSION, "v"));
  assert.doesNotThrow(() => checkRecord({ version: "v", styles: [style], entries: [entry] }, VERSION, "v"));
});
