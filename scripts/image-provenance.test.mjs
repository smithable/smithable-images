import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import sharp from "sharp";
import { assertGeneratedWebp, backfillGeneratedWebp, encodedPicture } from "./image-provenance.mjs";
import { appEntries } from "./upscale.mjs";

const image = () => sharp({ create: { width: 40, height: 24, channels: 3, background: "#bd6a2f" } });

test("the XMP statement is in the final generated WebP at native and reduced widths", async () => {
  for (const width of [40, 20]) {
    const bytes = await encodedPicture(image().resize(width).webp(), true, "generated picture");
    await assertGeneratedWebp(bytes, "generated picture");
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, width);
    assert.match(metadata.xmp.toString("utf8"), /DigitalSourceType[^>]+trainedAlgorithmicMedia/);
  }
});

test("an unstamped WebP and a file of another format fail the generated-picture check", async () => {
  const unstamped = await encodedPicture(image().webp(), false, "photograph");
  assert.equal((await sharp(unstamped).metadata()).xmp, undefined);
  await assert.rejects(assertGeneratedWebp(unstamped, "missing.webp"), /missing.webp.*IPTC/);
  await assert.rejects(encodedPicture(image().png(), true, "wrong.png"), /wrong.png.*WebP/);
});

test("the backfill preserves simple and alpha WebP image data and is idempotent", async () => {
  const translucent = () => sharp({
    create: { width: 40, height: 24, channels: 4, background: { r: 255, g: 5, b: 9, alpha: 0.5 } },
  });
  for (const source of [image(), translucent()]) {
    const before = await source.webp().toBuffer();
    const after = await backfillGeneratedWebp(before, "existing.webp");
    assert.notDeepEqual(after, before);
    assert.deepEqual(await sharp(after).raw().toBuffer(), await sharp(before).raw().toBuffer());
    assert.equal(await backfillGeneratedWebp(after, "existing.webp"), after);
    await assert.rejects(backfillGeneratedWebp(before.subarray(0, -1), "broken.webp"), /invalid WebP/);
  }
});

test("a version requires marked files and keeps a generated filler and its resized copies", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "smithable-provenance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(fileURLToPath(new URL(".", import.meta.url)), join(root, "scripts"), { recursive: true });
  symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"), "dir");
  writeFileSync(join(root, "manifest.yml"), `styles:
  - id: photographs
    kind: photograph
    generated: false
    words: {en: {name: Photographs, line: CC0 pictures}}
images:
  - id: tour
    kind: hero
    style: photographs
    subject: tour
    prompt: An empty workshop
    alt: An empty workshop
    tags: [shop]
`);
  const originalPath = join(root, "images/hero/tour.webp");
  const widthPath = join(root, "images/upscaled/hero/tour-800.webp");
  mkdirSync(join(root, "images/hero"), { recursive: true });
  mkdirSync(join(root, "images/upscaled/hero"), { recursive: true });
  const original = await image().webp().toBuffer();
  const enlarged = await image().resize(800).webp().toBuffer();
  writeFileSync(originalPath, original);
  writeFileSync(widthPath, enlarged);
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const results = join(root, "images/upscaled/results.jsonl");
  writeFileSync(results, JSON.stringify({
    id: "tour", kind: "hero", sha256: sha256(original), status: "done", master: 800, widths: [800],
  }) + "\n");
  const run = (option) => spawnSync(process.execPath, [join(root, "scripts/make-images.mjs"), option], { cwd: root, encoding: "utf8" });
  const failed = run("--version");
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /tour: missing the generated-picture IPTC statement/);
  const backfilled = run("--backfill-provenance");
  assert.equal(backfilled.status, 0, backfilled.stderr);
  assert.match(backfilled.stdout, /1 generated originals and 1 local upscale copies/);
  const resultText = readFileSync(results, "utf8");
  const repeated = run("--backfill-provenance");
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(readFileSync(results, "utf8"), resultText);
  const published = run("--version");
  assert.equal(published.status, 0, published.stderr);
  const { index } = JSON.parse(readFileSync(join(root, "latest.json"), "utf8"));
  const { styles, entries: [entry] } = JSON.parse(readFileSync(join(root, index), "utf8"));
  assert.equal(styles[0].kind, "photograph");
  assert.equal(entry.kind, "hero");
  assert.equal(entry.pictureKind, "ai-realistic");
  assert.equal(entry.sha256, sha256(readFileSync(originalPath)));
  assert.equal(entry.widths[0].sha256, sha256(readFileSync(widthPath)));
  await assertGeneratedWebp(originalPath, "original");
  await assertGeneratedWebp(widthPath, "copy");
});

test("an app image supplied to the upscaler is encoded as generated", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "smithable-app-picture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "tour.png");
  await image().png().toFile(file);
  const [entry] = await appEntries([file]);
  assert.equal(entry.generated, true);
  for (const width of [80, 20]) {
    const copy = await encodedPicture(sharp(entry.file).resize(width).webp(), entry.generated, entry.id);
    await assertGeneratedWebp(copy, `upscaled app picture at ${width}px`);
  }
});
