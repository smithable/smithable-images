import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { collect } from "./collect.mjs";

const jpeg = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: "#888" } }).jpeg().toBuffer();
const big = await jpeg(2000, 1500);

/** A result of Openverse's, large and CC0 unless said otherwise. */
const ov = (id, more = {}) => ({
  id,
  foreign_landing_url: `https://commons.wikimedia.org/w/index.php?curid=${id}`,
  url: `https://img.example/${id}.jpg`,
  creator: "A Person",
  license: "cc0",
  license_version: "1.0",
  source: "wikimedia",
  width: 2000,
  height: 1500,
  ...more,
});
const commons = (pages) => async () => ({ query: { pages } });
const noCommons = commons({});

function setup(t, { subjects = "bike\n", misses } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "collect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const subjectsFile = join(dir, "subjects.txt");
  writeFileSync(subjectsFile, subjects);
  const missesFile = join(dir, "misses.jsonl");
  if (misses) writeFileSync(missesFile, misses.map((m) => JSON.stringify(m)).join("\n"));
  return { subjects: subjectsFile, misses: missesFile, out: join(dir, "out"), wait: 0, sleep: async () => {} };
}

/** A fetch answering Openverse's search per subject, and images by URL. */
function fetcher(results, images = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (url.includes("api.openverse.org")) {
      const q = new URL(url).searchParams.get("q");
      if (results.status) return new Response("", { status: results.status });
      return Response.json({ results: results[q] ?? [] });
    }
    const image = images[url] ?? big;
    return typeof image === "number" ? new Response("", { status: image }) : new Response(image);
  };
  fn.calls = calls;
  return fn;
}
const folder = (o, subject) => (existsSync(join(o.out, subject)) ? readdirSync(join(o.out, subject)).sort() : []);
const quiet = (t) => t.mock.method(console, "log", () => {});

test("the list comes first and in order, then the misses, without repeats", async (t) => {
  quiet(t);
  const o = setup(t, {
    subjects: "bike\nsofa\nbike\n",
    misses: [
      { description: "a bakery site", app: "Crumb", hero: true, logo: false, models: ["ClassType", "Sofa"] },
      { description: "not this", app: "X", hero: false, logo: true, models: [] },
    ],
  });
  const fetchFn = fetcher({});
  await collect({ ...o, fetchFn, commonsSearch: noCommons });
  const asked = fetchFn.calls.map((u) => new URL(u).searchParams.get("q"));
  assert.deepEqual(asked, ["bike", "sofa", "a bakery site", "class type"]);
});

test("a missing misses file gives no subjects and is no error", async (t) => {
  quiet(t);
  const o = setup(t);
  const fetchFn = fetcher({});
  await collect({ ...o, fetchFn, commonsSearch: noCommons });
  assert.equal(fetchFn.calls.length, 1);
});

test("what is saved: a scaled WebP and where it came from", async (t) => {
  quiet(t);
  const o = setup(t);
  await collect({ ...o, fetchFn: fetcher({ bike: [ov("a")] }), commonsSearch: noCommons });
  assert.deepEqual(folder(o, "bike"), ["openverse-a.json", "openverse-a.webp"]);
  const { width, format } = await sharp(join(o.out, "bike", "openverse-a.webp")).metadata();
  assert.equal(format, "webp");
  assert.equal(width, 1600);
  const p = JSON.parse(readFileSync(join(o.out, "bike", "openverse-a.json"), "utf8"));
  assert.equal(p.source, "openverse");
  assert.equal(p.via, "wikimedia");
  assert.equal(p.pageUrl, "https://commons.wikimedia.org/w/index.php?curid=a");
  assert.equal(p.imageUrl, "https://img.example/a.jpg");
  assert.equal(p.author, "A Person");
  assert.equal(p.licence, "cc0 1.0");
  assert.equal(p.query, "bike");
  assert.equal(p.subject, "bike");
  assert.ok(p.collectedAt);
});

test("a picture smaller than 1600 is not enlarged", async (t) => {
  quiet(t);
  const o = setup(t);
  const small = ov("s", { width: 1300, height: 900 });
  const fetchFn = fetcher({ bike: [small] }, { [small.url]: await jpeg(1300, 900) });
  await collect({ ...o, fetchFn, commonsSearch: noCommons });
  const { width } = await sharp(join(o.out, "bike", "openverse-s.webp")).metadata();
  assert.equal(width, 1300);
});

test("not CC0, too small, no size or not https: not fetched", async (t) => {
  quiet(t);
  const o = setup(t);
  const fetchFn = fetcher({
    bike: [
      ov("by", { license: "by" }),
      ov("small", { width: 1000, height: 800 }),
      ov("nosize", { width: undefined, height: undefined }),
      ov("plain", { url: "http://img.example/plain.jpg" }),
      ov("barred", { source: "pixabay" }),
      ov("linked", { foreign_landing_url: "https://www.pexels.com/photo/1" }),
    ],
  });
  await collect({ ...o, fetchFn, commonsSearch: noCommons });
  assert.equal(fetchFn.calls.length, 1);
  assert.deepEqual(folder(o, "bike"), []);
});

test("Commons: restrictions and other licences are dropped", async (t) => {
  quiet(t);
  const o = setup(t);
  const page = (pageid, meta) => ({
    pageid,
    title: `File:${pageid}.jpg`,
    imageinfo: [
      {
        url: `https://c.example/${pageid}.jpg`,
        thumburl: `https://c.example/thumb/${pageid}.jpg`,
        descriptionurl: `https://c.example/page/${pageid}`,
        width: 3000,
        height: 2000,
        extmetadata: meta,
      },
    ],
  });
  const cc0 = { License: { value: "cc0" }, LicenseShortName: { value: "CC0" }, Artist: { value: "Someone" } };
  await collect({
    ...o,
    fetchFn: fetcher({}),
    commonsSearch: commons({
      1: page(1, cc0),
      2: page(2, { ...cc0, Restrictions: { value: "personality" } }),
      3: page(3, { License: { value: "cc-by-sa-4.0" } }),
    }),
  });
  assert.deepEqual(folder(o, "bike"), ["commons-1.json", "commons-1.webp"]);
});

test("the cap stops the run, and the next run goes on past what was done", async (t) => {
  quiet(t);
  const o = setup(t);
  const results = { bike: [ov("a"), ov("b"), ov("c")] };
  await collect({ ...o, max: 2, fetchFn: fetcher(results), commonsSearch: noCommons });
  assert.equal(folder(o, "bike").length, 4);
  const again = fetcher(results);
  await collect({ ...o, max: 2, fetchFn: again, commonsSearch: noCommons });
  assert.equal(folder(o, "bike").length, 6);
  assert.deepEqual(again.calls.filter((u) => u.includes("img.example")), ["https://img.example/c.jpg"]);
  const third = fetcher(results);
  await collect({ ...o, max: 2, fetchFn: third, commonsSearch: noCommons });
  assert.equal(third.calls.length, 0, "a subject searched in every source is not searched again");
});

test("every request waits its turn and says who it is", async (t) => {
  quiet(t);
  const o = setup(t);
  const at = [];
  const seen = [];
  const inner = fetcher({ bike: [ov("a"), ov("b")] });
  const fetchFn = (url, options) => {
    at.push(Date.now());
    seen.push(options.headers["user-agent"]);
    return inner(url, options);
  };
  await collect({ ...o, wait: 50, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), fetchFn, commonsSearch: noCommons });
  assert.equal(seen.length, 3);
  assert.ok(seen.every((ua) => /Smithable/.test(ua)));
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 45, `gap ${at[i] - at[i - 1]}`);
});

test("a failed download or unreadable bytes skip that one and the run goes on", async (t) => {
  quiet(t);
  const o = setup(t);
  const fetchFn = fetcher(
    { bike: [ov("gone"), ov("junk"), ov("ok")] },
    { "https://img.example/gone.jpg": 404, "https://img.example/junk.jpg": Buffer.from("not a picture") },
  );
  await collect({ ...o, fetchFn, commonsSearch: noCommons });
  assert.deepEqual(folder(o, "bike"), ["openverse-ok.json", "openverse-ok.webp"]);
});

test("a host that says stop is left for the night; its source and other hosts go on", async (t) => {
  quiet(t);
  const o = setup(t);
  const fetchFn = fetcher(
    {
      bike: [
        ov("one", { url: "https://busy.example/one.jpg" }),
        ov("two", { url: "https://busy.example/two.jpg" }),
        ov("ok"),
      ],
    },
    { "https://busy.example/one.jpg": 429 },
  );
  await collect({ ...o, fetchFn, commonsSearch: noCommons });
  assert.ok(!fetchFn.calls.includes("https://busy.example/two.jpg"));
  assert.deepEqual(folder(o, "bike"), ["openverse-ok.json", "openverse-ok.webp"]);
});

test("a picture that is no photograph is left out", async (t) => {
  quiet(t);
  const o = setup(t);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1500"><rect width="9" height="9"/></svg>');
  await collect({
    ...o,
    fetchFn: fetcher({ bike: [ov("v")] }, { "https://img.example/v.jpg": svg }),
    commonsSearch: noCommons,
  });
  assert.deepEqual(folder(o, "bike"), []);
});

test("a 429 stops that source for the night, the other goes on, and it is searched next time", async (t) => {
  const log = quiet(t);
  const o = setup(t, { subjects: "bike\nsofa\n" });
  const fetchFn = fetcher({ status: 429 });
  const searched = [];
  const commonsSearch = async (q) => {
    searched.push(q);
    return { query: { pages: {} } };
  };
  await collect({ ...o, fetchFn, commonsSearch });
  assert.equal(fetchFn.calls.length, 1);
  assert.deepEqual(searched, ["bike", "sofa"]);
  assert.match(log.mock.calls[0].arguments[0], /stopped sources: openverse/);
  const state = JSON.parse(readFileSync(join(o.out, "state.json"), "utf8"));
  assert.deepEqual(state.searched.bike, ["commons"]);
});

test("a dry run writes and downloads nothing", async (t) => {
  quiet(t);
  const o = setup(t);
  const fetchFn = fetcher({ bike: [ov("a")] });
  await collect({ ...o, dryRun: true, fetchFn, commonsSearch: noCommons });
  assert.equal(fetchFn.calls.length, 1);
  assert.deepEqual(folder(o, "bike"), []);
  assert.ok(!existsSync(join(o.out, "state.json")));
});

test("a long description makes a short folder", async (t) => {
  quiet(t);
  const long = `${"a very long description of a site ".repeat(12)}`.trim();
  const o = setup(t, { subjects: `${long}\n` });
  await collect({ ...o, fetchFn: fetcher({ [long]: [ov("a")] }), commonsSearch: noCommons });
  const [name] = readdirSync(o.out).filter((n) => n !== "state.json");
  assert.ok(name.length <= 60);
  assert.equal(readdirSync(join(o.out, name)).length, 2);
});

test("a photograph is saved the way up its camera says", async (t) => {
  const o = setup(t);
  const sideways = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#888" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const fetchFn = fetcher({ bike: [ov("a")] }, { "https://img.example/a.jpg": sideways });
  await collect({ ...o, fetchFn, commonsSearch: noCommons });
  const { width, height } = await sharp(join(o.out, "bike", "openverse-a.webp")).metadata();
  assert.ok(height > width, `${width}x${height}`);
});

test("a CC0 mark outside Commons is not fetched", async (t) => {
  const o = setup(t);
  const fetchFn = fetcher({ bike: [ov("a", { source: "flickr", foreign_landing_url: "https://www.flickr.com/photos/a" })] });
  await collect({ ...o, fetchFn, commonsSearch: noCommons });
  assert.ok(!fetchFn.calls.includes("https://img.example/a.jpg"));
  assert.equal(existsSync(join(o.out, "bike")), false);
});
