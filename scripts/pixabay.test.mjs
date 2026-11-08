import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { collect } from "./collect.mjs";
import { pixabayEvidenceHolds, refusal, THRESHOLD_ID, uploadDate } from "./pixabay.mjs";
import { reviewSheets } from "./review-sheet.mjs";

const big = await sharp({ create: { width: 1280, height: 853, channels: 3, background: "#888" } }).jpeg().toBuffer();

/** A Pixabay hit: a photograph uploaded in 2017 unless said otherwise. */
const hit = (id, more = {}) => ({
  id,
  pageURL: `https://pixabay.com/photos/lamp-old-${id}/`,
  previewURL: `https://cdn.pixabay.com/photo/2017/05/03/10/20/lamp-${id}_150.jpg`,
  largeImageURL: `https://pixabay.com/get/${id}_1280.jpg`,
  user: "someone",
  type: "photo",
  tags: "lamp, old, light",
  imageWidth: 4000,
  imageHeight: 2667,
  isGRated: true,
  ...more,
});

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "pixabay-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "subjects.txt"), "vintage lamp\n");
  return { subjects: join(dir, "subjects.txt"), out: join(dir, "out"), wait: 0, sleep: async () => {} };
}

function fetcher(hits, snapshot) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (url.includes("api.openverse.org")) return Response.json({ results: [] });
    if (url.startsWith("https://pixabay.com/api/")) return Response.json({ hits });
    if (url.startsWith("https://archive.org/wayback/"))
      return Response.json({ archived_snapshots: snapshot ? { closest: { available: true, ...snapshot } } : {} });
    return new Response(big);
  };
  fn.calls = calls;
  return fn;
}
const noCommons = async () => ({ query: { pages: {} } });
const quiet = (t) => t.mock.method(console, "log", () => {});

test("the upload date is read from the preview's path", () => {
  assert.equal(uploadDate("https://cdn.pixabay.com/photo/2018/12/25/09/00/x-3895010_150.jpg"), "2018-12-25");
  assert.equal(uploadDate("https://cdn.pixabay.com/other/x.jpg"), undefined);
});

test("only a plain photograph from before the margin, without people, may be kept", () => {
  assert.equal(refusal(hit(1834265)), undefined);
  assert.match(refusal(hit(3922314, { previewURL: "https://cdn.pixabay.com/photo/2019/01/08/1/1/x_150.jpg" })), /uploaded 2019-01-08/);
  assert.match(refusal(hit(THRESHOLD_ID + 1)), /id over/);
  assert.match(refusal(hit(1, { previewURL: "https://cdn.pixabay.com/x.jpg" })), /no upload date/);
  assert.match(refusal(hit(1, { tags: "lamp, woman, room" })), /people/);
  assert.match(refusal(hit(1, { type: "illustration" })), /plain photograph/);
  assert.match(refusal(hit(7, { previewURL: "https://cdn.pixabay.com/photo/2017/05/03/10/20/lamp-8_150.jpg" })), /another picture/);
  assert.match(refusal(hit(1, { isAiGenerated: true })), /plain photograph/);
});

test("without a key Pixabay is not asked", async (t) => {
  quiet(t);
  const o = setup(t);
  const fetchFn = fetcher([hit(1834265)]);
  await collect({ ...o, fetchFn, commonsSearch: noCommons });
  assert.ok(!fetchFn.calls.some((u) => u.includes("pixabay")));
});

test("a kept picture has its evidence beside it, and the key is in no file", async (t) => {
  quiet(t);
  const o = setup(t);
  const fetchFn = fetcher([hit(1834265), hit(THRESHOLD_ID + 5), hit(42, { tags: "lamp, man" })], { url: "http://web.archive.org/web/20180601000000/x", timestamp: "20180601000000" });
  await collect({ ...o, fetchFn, commonsSearch: noCommons, pixabayKey: "SECRETKEY" });
  const files = readdirSync(join(o.out, "vintage-lamp")).sort();
  assert.deepEqual(files, ["pixabay-1834265.json", "pixabay-1834265.webp"]);
  const prov = JSON.parse(readFileSync(join(o.out, "vintage-lamp", "pixabay-1834265.json"), "utf8"));
  assert.equal(prov.evidence.pixabayId, 1834265);
  assert.equal(prov.evidence.uploaded, "2017-05-03");
  assert.equal(prov.evidence.wayback.snapshot.timestamp, "20180601000000");
  assert.equal(prov.width, 1280);
  assert.ok(pixabayEvidenceHolds(prov));
  for (const f of readdirSync(o.out, { recursive: true }))
    if (String(f).endsWith(".json")) assert.ok(!readFileSync(join(o.out, String(f)), "utf8").includes("SECRETKEY"));
});

test("a snapshot from after the change is not evidence", async (t) => {
  quiet(t);
  const o = setup(t);
  await collect({ ...o, fetchFn: fetcher([hit(1834265)], { url: "http://web.archive.org/web/2023/x", timestamp: "20231101000000" }), commonsSearch: noCommons, pixabayKey: "k" });
  const prov = JSON.parse(readFileSync(join(o.out, "vintage-lamp", "pixabay-1834265.json"), "utf8"));
  assert.equal(prov.evidence.wayback.snapshot, null);
  assert.equal(prov.evidence.wayback.asked.length, 2);
});

test("a few pictures of a subject at most, and one search", async (t) => {
  quiet(t);
  const o = setup(t);
  const fetchFn = fetcher(Array.from({ length: 20 }, (_, i) => hit(1000 + i)));
  await collect({ ...o, fetchFn, commonsSearch: noCommons, pixabayKey: "k" });
  assert.equal(readdirSync(join(o.out, "vintage-lamp")).filter((f) => f.endsWith(".webp")).length, 6);
  assert.equal(fetchFn.calls.filter((u) => u.startsWith("https://pixabay.com/api/")).length, 1);
  await collect({ ...o, fetchFn, commonsSearch: noCommons, pixabayKey: "k" });
  assert.equal(fetchFn.calls.filter((u) => u.startsWith("https://pixabay.com/api/")).length, 1);
});

test("the sheet shows Pixabay's pictures only with evidence that holds", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pixabay-sheet-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const review = join(dir, "review");
  mkdirSync(join(review, "vintage-lamp"), { recursive: true });
  const put = async (name, prov) => {
    await sharp(big).webp().toFile(join(review, "vintage-lamp", `${name}.webp`));
    writeFileSync(join(review, "vintage-lamp", `${name}.json`), JSON.stringify({ source: "pixabay", width: 1280, height: 853, subject: "vintage lamp", ...prov }));
  };
  const page = "https://pixabay.com/photos/lamp-1/";
  await put("pixabay-1", { pageUrl: page, evidence: { pixabayId: 1, uploaded: "2017-05-03", uploadedFrom: "/photo/2017/05/03/10/20/lamp-1_150.jpg", rule: "r" } });
  await put("pixabay-2", { pageUrl: page, evidence: { pixabayId: THRESHOLD_ID + 1, uploaded: "2017-05-03", uploadedFrom: "/photo/2017/05/03/10/20/lamp-x_150.jpg", rule: "r" } });
  await put("pixabay-3", { pageUrl: page, evidence: { pixabayId: 3, uploaded: "2019-02-01", uploadedFrom: "/photo/2019/02/01/10/20/lamp-3_150.jpg", rule: "r" } });
  await put("pixabay-4", { pageUrl: page });
  await put("pixabay-6", { pageUrl: page, evidence: { pixabayId: 6, uploaded: "2017-05-03" } });
  await put("pixabay-5", { pageUrl: "https://pixabay.com.evil.example/x", evidence: { pixabayId: 5, uploaded: "2017-05-03", uploadedFrom: "/photo/2017/05/03/10/20/lamp-5_150.jpg", rule: "r" } });
  const subjects = await reviewSheets({ review, out: join(dir, "out") });
  assert.deepEqual(subjects[0].candidates.map((c) => c.file), ["vintage-lamp/pixabay-1.webp"]);
  assert.ok(existsSync(join(dir, "out", "sheet-vintage-lamp.webp")));
});

test("a night asks Pixabay at most twenty times, and the rest wait their turn", async (t) => {
  quiet(t);
  const o = setup(t);
  writeFileSync(o.subjects, Array.from({ length: 25 }, (_, i) => `subject ${i}`).join("\n"));
  const fetchFn = fetcher([]);
  await collect({ ...o, fetchFn, commonsSearch: noCommons, pixabayKey: "k" });
  assert.equal(fetchFn.calls.filter((u) => u.startsWith("https://pixabay.com/api/")).length, 20);
  await collect({ ...o, fetchFn, commonsSearch: noCommons, pixabayKey: "k" });
  assert.equal(fetchFn.calls.filter((u) => u.startsWith("https://pixabay.com/api/")).length, 25);
});
