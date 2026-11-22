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
function checkRecord(value, shape, where, required = []) {
  assert.ok(isRecord(value), `${where} is a record`);
  for (const key of required) assert.ok(Object.hasOwn(value, key), `${where} has its ${key}`);
  for (const [key, v] of Object.entries(value)) {
    assert.ok(Object.hasOwn(shape, key), `${where} has the key ${key}`);
    shape[key](v, `${where}.${key}`);
  }
}
const leaf = (check) => (v, where) => assert.ok(check(v), `${where} has a value of the wrong shape`);
const CREDIT = Object.fromEntries(["page", "author", "licence", "licenceUrl", "uploaded", "evidence", "fetched", "enlarged"].map((k) => [k, leaf(text)]));
const ENTRY = {
  ...Object.fromEntries(
    ["id", "kind", "url", "alt", "style", "subject", "sha256", "orientation", "tone", "temperature", "color", "source"].map((k) => [k, leaf(text)]),
  ),
  ...Object.fromEntries(["width", "height", "bytes"].map((k) => [k, leaf(number)])),
  photo: leaf(flag),
  generated: leaf(flag),
  tags: leaf(texts),
  credit: (v, where) => checkRecord(v, CREDIT, where, ["page", "author", "licence", "fetched"]),
  // A sample marked for the landing page or as filler, and the enlarged copies served beside it.
  uses: leaf((v) => texts(v) && v.length > 0 && v.every((u) => u === "hero" || u === "filler")),
  upscaled: leaf(flag),
  widths: (v, where) => list(WIDTH, Object.keys(WIDTH))(v, where),
};
const WIDTH = { width: leaf(number), height: leaf(number), url: leaf(text), sha256: leaf(text) };
// A style's words: per language, exactly a name and a line. Three versions of 2026-11-18 were
// published before make-images.mjs refused an unquoted comma in YAML, so their English line for
// photographs split into a second, empty key; they stay as published, and only that key is let by.
const WORDS = { name: leaf(text), line: leaf(text) };
const SPLIT_LINE = "dedicated to the public domain by their authors.";
const SPLIT_IN = ["versions/2026-11-18.1.json", "versions/2026-11-18.2.json", "versions/2026-11-18.3.json"];
// Language codes as the publisher writes them (en, sv, pt-BR), each with exactly a name and a line.
const words = (splitLetBy) => (v, where) => {
  assert.ok(isRecord(v), `${where} is a record`);
  assert.ok(Object.hasOwn(v, "en"), `${where} has English`);
  for (const [lang, w] of Object.entries(v)) {
    assert.match(lang, /^[a-z]{2}(-[A-Z]{2})?$/, `${where} has a language code`);
    const shape = splitLetBy && lang === "en" ? { ...WORDS, [SPLIT_LINE]: leaf((x) => x === null) } : WORDS;
    checkRecord(w, shape, `${where}.${lang}`, ["name", "line"]);
  }
};
const STYLE = { id: leaf(text), generated: leaf(flag), drawn: leaf(flag), washHue: leaf((value) => Number.isFinite(value) && value >= 0 && value < 360), words: words(false) };
const STYLE_REQUIRED = ["id", "generated", "words"];
const ENTRY_REQUIRED = ["id", "kind", "url", "alt", "tags", "sha256", "width", "height", "bytes", "source", "photo", "generated"];
const list = (shape, required) => (v, where) => {
  assert.ok(Array.isArray(v), `${where} is a list`);
  v.forEach((item, i) => checkRecord(item, shape, `${where}[${i}]`, required));
};
// The split key is let by only on the photographs style of those three files.
const styles = (v, where) => {
  assert.ok(Array.isArray(v), `${where} is a list`);
  const file = where.slice(0, -".styles".length);
  v.forEach((s, i) => {
    const splitLetBy = SPLIT_IN.includes(file) && isRecord(s) && s.id === "photographs";
    checkRecord(s, splitLetBy ? { ...STYLE, words: words(true) } : STYLE, `${where}[${i}]`, STYLE_REQUIRED);
    if (Object.hasOwn(s, "washHue")) assert.ok(s.drawn && s.generated, `${where}[${i}] has a wash hue only for a generated drawn style`);
  });
};
const VERSION = { version: leaf(text), styles, entries: list(ENTRY, ENTRY_REQUIRED) };
const checkVersion = (v, where) => checkRecord(v, VERSION, where, ["version", "styles", "entries"]);
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
  checkRecord(latest, { version: leaf(text), index: leaf(text) }, "latest.json", ["version", "index"]);
  assert.equal(latest.index, `versions/${latest.version}.json`);
  assert.ok(versionFiles().includes(latest.index), `${latest.index} is in versions/`);
});

test("index.json and every version carry only the index's own keys, down to their leaves", () => {
  list(ENTRY, ENTRY_REQUIRED)(read("index.json"), "index.json");
  const files = versionFiles();
  assert.ok(files.length > 0, "versions/ holds the published versions");
  for (const file of files) checkVersion(read(file), file);
});

test("the latest Ink wash style names its wash hue", () => {
  const { styles: current } = read(read("latest.json").index);
  assert.equal(current.find((style) => style.id === "ink-wash")?.washHue, 300);
  assert.equal(current.filter((style) => Object.hasOwn(style, "washHue")).length, 1);
});

test("the checks catch a key or a value out of shape at any depth", () => {
  const entry = { id: "a", kind: "photo", url: "u", alt: "A", tags: ["x"], sha256: "h", width: 1, height: 1, bytes: 1, source: "s", photo: true, generated: false, credit: { page: "p", author: "a", licence: "l", fetched: "f" } };
  const bad = [
    { ...entry, points: ["booking"] },
    { ...entry, tags: [{ people: true }] },
    { ...entry, credit: { ...entry.credit, count: 3 } },
    { ...entry, credit: [] },
    { ...entry, credit: {} },
    42,
    { ...entry, url: undefined },
  ];
  delete bad[6].url;
  for (const b of bad) assert.throws(() => list(ENTRY, ENTRY_REQUIRED)([b], "x"));
  assert.doesNotThrow(() => list(ENTRY, ENTRY_REQUIRED)([entry], "x"));
  const style = { id: "s", generated: false, words: { en: { name: "N", line: "L" } } };
  assert.throws(() => checkVersion({ version: "v", styles: [{ ...style, words: { en: { name: "N", line: "L", slot: "x" } } }], entries: [] }, "v"));
  assert.throws(() => checkVersion({ version: "v", styles: [false], entries: [] }, "v"));
  assert.throws(() => checkVersion({ version: "v", styles: [{ ...style, words: { en: { name: "N", line: "L" }, people: { name: "N", line: "L" } } }], entries: [] }, "v"));
  assert.throws(() => checkVersion({ version: "v", styles: [{ ...style, words: { en: {} } }], entries: [] }, "v"));
  assert.throws(() => checkVersion({}, "v"));
  const split = { id: "photographs", generated: false, words: { en: { name: "N", line: "L", [SPLIT_LINE]: { people: true } } } };
  assert.throws(() => checkVersion({ version: "v", styles: [split], entries: [] }, SPLIT_IN[0]));
  const other = { ...split, id: "lifelike", words: { en: { name: "N", line: "L", [SPLIT_LINE]: null } } };
  assert.throws(() => checkVersion({ version: "v", styles: [other], entries: [] }, SPLIT_IN[0]));
  assert.doesNotThrow(() => checkVersion({ version: "v", styles: [{ ...split, words: { en: { name: "N", line: "L", [SPLIT_LINE]: null } } }], entries: [] }, SPLIT_IN[0]));
  const nullSplit = { ...split, words: { en: { name: "N", line: "L", [SPLIT_LINE]: null } } };
  assert.throws(() => checkVersion({ version: "v", styles: [nullSplit], entries: [] }, "versions/2026-11-21.2.json"));
  assert.throws(() => checkVersion({ version: "v", styles: [{ ...split, words: { en: { name: "N", line: "L" }, sv: { name: "N", line: "L", [SPLIT_LINE]: null } } }], entries: [] }, SPLIT_IN[0]));
  assert.doesNotThrow(() => checkVersion({ version: "v", styles: [style], entries: [entry] }, "v"));
});
