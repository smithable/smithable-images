import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { plainReasons, readingReasons, reviewSheets } from "./review-sheet.mjs";

const good = { onSubject: true, photograph: true, logo: false, textOver: false, watermark: false, person: false, note: "a lamp" };

async function picture(review, slug, name, extra = {}) {
  mkdirSync(join(review, slug), { recursive: true });
  await sharp({ create: { width: 64, height: 48, channels: 3, background: "#888888" } }).webp().toFile(join(review, slug, `${name}.webp`));
  writeFileSync(join(review, slug, `${name}.json`), JSON.stringify({ source: "commons", pageUrl: "https://commons.wikimedia.org/wiki/File:x.jpg", width: 1600, height: 1200, subject: "vintage lamp", ...extra }));
}

function folders() {
  const root = mkdtempSync(join(tmpdir(), "review-sheet-"));
  return { review: join(root, "review"), out: join(root, "out") };
}

test("the plain rules refuse a small or a narrow picture", () => {
  assert.deepEqual(plainReasons({ width: 1600, height: 1200 }), []);
  assert.deepEqual(plainReasons({ width: 1000, height: 800 }), ["under 1280 px"]);
  assert.deepEqual(plainReasons({ width: 1600, height: 500 }), ["too narrow"]);
  assert.deepEqual(plainReasons({}), ["no size"]);
});

test("each thing the model reads can refuse a picture", () => {
  assert.deepEqual(readingReasons(good), []);
  assert.deepEqual(
    readingReasons({ onSubject: false, photograph: false, logo: true, textOver: true, watermark: true, person: true, note: "" }),
    ["off subject", "not a photograph", "a logo", "text over it", "a watermark", "a recognisable person"],
  );
});

test("a good reading is a pre-pick; the list and the sheet say which", async () => {
  const { review, out } = folders();
  await picture(review, "vintage-lamp", "commons-1");
  await picture(review, "vintage-lamp", "openverse-2");
  const read = async (file) => (file.includes("openverse") ? { ...good, onSubject: false } : good);
  const [s] = await reviewSheets({ review, out, read });
  assert.deepEqual(s.candidates.map((c) => [c.n, c.prePick, c.reasons]), [[1, true, []], [2, false, ["off subject"]]]);
  assert.ok(existsSync(join(out, "sheet-vintage-lamp.webp")));
  assert.equal(JSON.parse(readFileSync(join(out, "candidates.json"), "utf8"))[0].candidates[0].source, "commons");
});

test("a picture the model could not read is shown, not pre-picked", async () => {
  const { review, out } = folders();
  await picture(review, "vintage-lamp", "commons-1");
  await picture(review, "vintage-lamp", "commons-2");
  let calls = 0;
  const read = async () => { if (++calls === 1) throw new Error("529 busy"); return good; };
  const [s] = await reviewSheets({ review, out, read });
  assert.equal(s.candidates[0].prePick, false);
  assert.deepEqual(s.candidates[0].reasons, ["not read"]);
  assert.equal(s.candidates[0].note, "529 busy");
  assert.equal(s.candidates[1].prePick, true);
});

test("a run where no picture could be read stops, makes no sheet and marks nothing shown", async () => {
  const { review, out } = folders();
  await picture(review, "vintage-lamp", "commons-1");
  await assert.rejects(reviewSheets({ review, out, read: async () => { throw new Error("401"); } }), /no picture could be read: 401/);
  assert.equal(existsSync(out), false);
  assert.equal(existsSync(join(review, "shown.json")), false);
});

test("a sidecar cannot override the verdict or the file", async () => {
  const { review, out } = folders();
  await picture(review, "vintage-lamp", "commons-1", { prePick: true, file: "elsewhere.webp", n: 9 });
  const [s] = await reviewSheets({ review, out, read: async () => ({ ...good, logo: true }) });
  assert.equal(s.candidates[0].prePick, false);
  assert.equal(s.candidates[0].file, "vintage-lamp/commons-1.webp");
  assert.equal(s.candidates[0].n, 1);
});

test("a picture that fails the plain rules costs no model call", async () => {
  const { review, out } = folders();
  await picture(review, "vintage-lamp", "commons-1", { width: 800, height: 600 });
  let calls = 0;
  const [s] = await reviewSheets({ review, out, read: async () => { calls++; return good; } });
  assert.equal(calls, 0);
  assert.deepEqual(s.candidates[0].reasons, ["under 1280 px"]);
});

test("without a model nothing is pre-picked", async () => {
  const { review, out } = folders();
  await picture(review, "vintage-lamp", "commons-1");
  const [s] = await reviewSheets({ review, out });
  assert.equal(s.candidates[0].prePick, false);
});

test("a shown picture does not come back; a new one does", async () => {
  const { review, out } = folders();
  await picture(review, "vintage-lamp", "commons-1");
  await reviewSheets({ review, out, read: async () => good });
  assert.deepEqual(await reviewSheets({ review, out: `${out}-2`, read: async () => good }), []);
  assert.equal(existsSync(`${out}-2`), false);
  await picture(review, "vintage-lamp", "commons-2");
  const [s] = await reviewSheets({ review, out: `${out}-3`, read: async () => good });
  assert.deepEqual(s.candidates.map((c) => c.file), ["vintage-lamp/commons-2.webp"]);
});

test("a subject over the cap keeps the rest for next time", async () => {
  const { review, out } = folders();
  await picture(review, "vintage-lamp", "commons-1");
  await picture(review, "vintage-lamp", "commons-2");
  const [s] = await reviewSheets({ review, out, perSubject: 1, read: async () => good });
  assert.deepEqual(s.candidates.map((c) => c.file), ["vintage-lamp/commons-1.webp"]);
  const [next] = await reviewSheets({ review, out: `${out}-2`, perSubject: 1, read: async () => good });
  assert.deepEqual(next.candidates.map((c) => c.file), ["vintage-lamp/commons-2.webp"]);
});

test("a picture from outside Commons never reaches the model or the sheet", async () => {
  const { review, out } = folders();
  await picture(review, "vintage-lamp", "openverse-1", { pageUrl: "https://www.rawpixel.com/image/1" });
  await picture(review, "vintage-lamp", "openverse-2", { pageUrl: "https://commons.wikimedia.org.evil.example/x" });
  await picture(review, "vintage-lamp", "openverse-3", { pageUrl: undefined });
  await picture(review, "vintage-lamp", "openverse-4");
  const asked = [];
  const [s] = await reviewSheets({ review, out, read: async (file) => { asked.push(file); return good; } });
  assert.equal(asked.length, 1);
  assert.deepEqual(s.candidates.map((c) => c.file), ["vintage-lamp/openverse-4.webp"]);
});
