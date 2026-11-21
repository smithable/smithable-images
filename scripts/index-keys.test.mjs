import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The published index carries what an app needs to place a picture and credit it, nothing more.
// The needs file gaps.mjs reads with --needs is kept outside this library, and none of its keys may
// reach the index: every key an entry carries must be one make-images.mjs writes, so a new key is
// added here on purpose, never by a stray merge of the two.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY_KEYS = new Set([
  "id",
  "kind",
  "url",
  "alt",
  "tags",
  "style",
  "subject",
  "sha256",
  "width",
  "height",
  "bytes",
  "orientation",
  "tone",
  "temperature",
  "color",
  "source",
  "photo",
  "generated",
  "credit",
]);
const CREDIT_KEYS = new Set(["page", "author", "licence", "licenceUrl", "uploaded", "evidence", "fetched"]);
// A version file is { version, styles, entries }: the styles as the manifest names them, and the index.
const VERSION_KEYS = new Set(["version", "styles", "entries"]);
const STYLE_KEYS = new Set(["id", "generated", "words", "drawn"]);
// The needs file's own keys, as gaps.mjs describes them (kind and subject are the library's words,
// which the needs borrow).
const NEEDS_KEYS = ["name", "trade", "class", "count", "pictures", "slot", "target", "people"];

const published = () => {
  const files = ["index.json"];
  const latest = JSON.parse(readFileSync(join(ROOT, "latest.json"), "utf8"));
  files.push(latest.index);
  if (existsSync(join(ROOT, "versions")))
    for (const f of readdirSync(join(ROOT, "versions")).sort()) if (f.endsWith(".json")) files.push(`versions/${f}`);
  return [...new Set(files)];
};

test("the allowed keys and the needs file's keys do not overlap", () => {
  for (const key of NEEDS_KEYS) for (const allowed of [ENTRY_KEYS, CREDIT_KEYS, VERSION_KEYS, STYLE_KEYS]) assert.ok(!allowed.has(key), key);
});

test("the published index and every version carry no key of the needs file, and only the index's own keys", () => {
  const files = published();
  assert.ok(files.length >= 2, "index.json and the latest version");
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(ROOT, file), "utf8"));
    let entries = data;
    if (file !== "index.json") {
      for (const key of Object.keys(data)) assert.ok(VERSION_KEYS.has(key), `${file} has the key ${key}`);
      assert.ok(Array.isArray(data.styles), `${file}: its styles`);
      for (const s of data.styles) for (const key of Object.keys(s)) assert.ok(STYLE_KEYS.has(key), `${file}: the style ${s.id} has the key ${key}`);
      entries = data.entries;
    }
    assert.ok(Array.isArray(entries) && entries.length > 0, `${file}: a list of entries`);
    for (const e of entries) {
      for (const key of Object.keys(e)) assert.ok(ENTRY_KEYS.has(key), `${file}: ${e.id} has the key ${key}`);
      if (e.credit !== undefined) {
        assert.equal(typeof e.credit, "object", `${file}: ${e.id}'s credit`);
        for (const key of Object.keys(e.credit)) assert.ok(CREDIT_KEYS.has(key), `${file}: ${e.id}'s credit has the key ${key}`);
      }
    }
  }
});
