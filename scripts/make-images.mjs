#!/usr/bin/env node
// Builds the image library from manifest.yml: generates missing pictures with OpenAI's image API
// (or copies them from a file), writes images/<kind>/<id>.webp and regenerates index.json. The
// pictures are not in Git: they are served from the docs site's bucket (--upload) and attached to
// releases as a tarball (--tar); index.json names each by its URL.
//
//   node scripts/make-images.mjs --dry-run [--only <id|kind>]   prompts and the estimated cost, nothing sent
//   node scripts/make-images.mjs [--only <id|kind|tag>]          copies `from:` entries, generates the rest directly
//   node scripts/make-images.mjs --batch submit|status|fetch     the Batch API (half price, within 24 h)
//   node scripts/make-images.mjs --sheet [--out <dir>]           a contact sheet per kind, in sheets/ and <dir>
//   node scripts/make-images.mjs --upload                        images/ to the docs bucket (SMITHABLE_DOCS_BUCKET)
//   node scripts/make-images.mjs --tar                           images-<date>.tar, for a release asset
//   node scripts/make-images.mjs --index                         copies `from:` entries and writes index.json; nothing sent
//
// The key is read from OPENAI_API_KEY or ~/.config/smithable/openai.env and never printed.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { parse } from "yaml";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const IMAGES_URL = "https://docs.smithable.ai/images";
const API = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"; // a stand-in server for tests

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    only: { type: "string" },
    batch: { type: "string" },
    sheet: { type: "boolean" },
    upload: { type: "boolean" },
    tar: { type: "boolean" },
    index: { type: "boolean" },
    out: { type: "string", default: "/mnt/c/Users/johan/Pictures/claude/images" },
    concurrency: { type: "string", default: "4" },
  },
});

// What each kind is generated at and stored as.
const KINDS = {
  hero: { size: "1536x1024", long: 1600, quality: 80 },
  sample: { size: "1536x1024", long: 900, quality: 80 }, // 3:2, as cards show them
  logo: { size: "1024x1024", long: 512, quality: 90, transparent: true },
  icon: { size: "1024x1024", long: 256, quality: 90, transparent: true },
};

// USD per picture, from OpenAI's pricing page (checked 2026-10-02); check again before a big run.
const PRICE = {
  "gpt-image-1": { low: [0.011, 0.016], medium: [0.042, 0.063], high: [0.167, 0.25] },
  "gpt-image-1-mini": { low: [0.005, 0.006], medium: [0.011, 0.015], high: [0.036, 0.052] },
  "gpt-image-1.5": { low: [0.009, 0.013], medium: [0.034, 0.05], high: [0.133, 0.2] },
  "gpt-image-2": { low: [0.006, 0.005], medium: [0.053, 0.041], high: [0.211, 0.165] },
};
const BATCH_MODELS = new Set(["gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5"]);

const manifest = parse(readFileSync(join(ROOT, "manifest.yml"), "utf8"));
const defaults = manifest.defaults ?? {};
const entries = manifest.images.map((e) => {
  if (!KINDS[e.kind]) throw new Error(`${e.id}: unknown kind ${e.kind}`);
  if (!e.prompt === !e.from) throw new Error(`${e.id}: give either prompt or from`);
  if (!e.alt || !e.tags?.length) throw new Error(`${e.id}: alt and tags are required`);
  return {
    ...e,
    model: e.model ?? defaults.models?.[e.kind] ?? "gpt-image-1-mini",
    quality: e.quality ?? defaults.quality ?? "medium",
    file: join(ROOT, "images", e.kind, `${e.id}.webp`),
  };
});
const ids = new Set();
for (const e of entries) {
  if (ids.has(e.id)) throw new Error(`duplicate id ${e.id}`);
  ids.add(e.id);
}
const selected = entries.filter((e) => !args.only || e.id === args.only || e.kind === args.only || e.tags.includes(args.only));
// Pictures already served are cached for a year, so an uploaded id never gets a new picture:
// a rejected one is replaced under a new id (cafe-1 → cafe-1-b) and --upload deletes the old object.
const UPLOADED = join(ROOT, "uploaded.json");
const uploaded = existsSync(UPLOADED) ? JSON.parse(readFileSync(UPLOADED, "utf8")) : {};
const missing = selected.filter((e) => !existsSync(e.file));
const reused = missing.filter((e) => uploaded[e.id]);
if (reused.length && !args.upload && !args["dry-run"])
  throw new Error(
    `${reused.map((e) => e.id).join(", ")}: already uploaded and cached for a year; give the new picture a new id (e.g. ${reused[0].id}-b)`,
  );

const promptOf = (e) => [e.prompt, defaults.style?.[e.kind] ?? defaults.style?.all].filter(Boolean).join(" ");
const priceOf = (e) => {
  const p = PRICE[e.model]?.[e.quality];
  if (!p) throw new Error(`${e.id}: no price for ${e.model} at ${e.quality}`);
  return KINDS[e.kind].size === "1024x1024" ? p[0] : p[1];
};

function requestBody(e) {
  const body = { model: e.model, prompt: promptOf(e), size: KINDS[e.kind].size, quality: e.quality, n: 1 };
  // Photographs come back as high-quality JPEG (a tenth of a PNG's size; they are re-encoded as
  // WebP anyway), so a batch's output file stays small. Transparent ones need PNG.
  if (KINDS[e.kind].transparent) Object.assign(body, { output_format: "png", background: "transparent" });
  else Object.assign(body, { output_format: "jpeg", output_compression: 95 });
  return body;
}

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const file = join(homedir(), ".config/smithable/openai.env");
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.trim().startsWith("OPENAI_API_KEY="));
  if (!line) throw new Error(`OPENAI_API_KEY not found in ${file}`);
  return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
}

async function api(path, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${apiKey()}`, ...init.headers } });
    if (res.ok) return res;
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${path}: ${res.status} ${text.slice(0, 500)}`);
  }
}

// Scales to the kind's long side (never up), encodes WebP, and writes the file.
async function store(e, input) {
  const kind = KINDS[e.kind];
  mkdirSync(dirname(e.file), { recursive: true });
  await sharp(input)
    .rotate()
    .resize({ width: kind.long, height: kind.long, fit: "inside", withoutEnlargement: true })
    .webp({ quality: kind.quality, effort: 6, alphaQuality: 90 })
    .toFile(e.file);
}

async function describe(e) {
  const img = sharp(e.file);
  const { width, height } = await img.metadata();
  const { dominant, channels } = await img.stats();
  const hex = `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const mean = channels.slice(0, 3).map((c) => c.mean);
  const luminance = (0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2]) / 255;
  const warmth = mean[0] - mean[2];
  return {
    id: e.id,
    kind: e.kind,
    url: `${IMAGES_URL}/${e.kind}/${e.id}.webp`,
    alt: e.alt,
    tags: e.tags,
    width,
    height,
    bytes: readFileSync(e.file).length,
    orientation: width > height * 1.1 ? "landscape" : height > width * 1.1 ? "portrait" : "square",
    tone: luminance > 0.6 ? "light" : luminance < 0.3 ? "dark" : "mid",
    temperature: warmth > 15 ? "warm" : warmth < -10 ? "cool" : "neutral",
    color: hex,
    source: e.from ? "file" : e.model,
  };
}

async function writeIndex() {
  const present = entries.filter((e) => existsSync(e.file));
  const index = [];
  for (const e of present) index.push(await describe(e));
  index.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(ROOT, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`index.json: ${index.length} of ${entries.length} pictures`);
}

async function pool(items, n, fn) {
  const queue = [...items];
  const failures = [];
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        try {
          await fn(e);
        } catch (err) {
          failures.push(e.id);
          console.error(`✗ ${e.id}: ${err.message}`);
        }
      }
    }),
  );
  return failures;
}

function dryRun() {
  const toMake = missing.filter((e) => e.prompt);
  const byModel = {};
  for (const e of toMake) {
    const key = `${e.model} ${e.quality} ${KINDS[e.kind].size}`;
    byModel[key] ??= { count: 0, cost: 0 };
    byModel[key].count++;
    byModel[key].cost += priceOf(e);
  }
  for (const e of missing) console.log(`${e.kind}/${e.id}  ${e.from ? `from ${e.from}` : `${e.model} ${e.quality}: ${promptOf(e)}`}`);
  console.log(`\n${missing.length - toMake.length} to copy, ${toMake.length} to generate, ${selected.length - missing.length} present`);
  let total = 0;
  for (const [key, { count, cost }] of Object.entries(byModel)) {
    console.log(`  ${String(count).padStart(4)} × ${key}: $${cost.toFixed(2)}`);
    total += cost;
  }
  const batchable = toMake.filter((e) => BATCH_MODELS.has(e.model)).reduce((s, e) => s + priceOf(e), 0);
  console.log(`  total $${total.toFixed(2)} direct; $${(total - batchable / 2).toFixed(2)} with --batch (${[...BATCH_MODELS].join(", ")} at half price)`);
}

async function copyFiles() {
  for (const e of missing.filter((m) => m.from)) {
    const source = resolve(ROOT, e.from.replace(/^~(?=\/)/, homedir()));
    await store(e, source);
    console.log(`✓ ${e.kind}/${e.id} (from ${e.from})`);
  }
}

async function generate() {
  await copyFiles();
  const toMake = missing.filter((e) => e.prompt);
  let tokens = 0;
  const failures = await pool(toMake, Number(args.concurrency), async (e) => {
    const res = await api("/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody(e)),
    });
    const json = await res.json();
    tokens += json.usage?.output_tokens ?? 0;
    await store(e, Buffer.from(json.data[0].b64_json, "base64"));
    console.log(`✓ ${e.kind}/${e.id}`);
  });
  console.log(`${toMake.length - failures.length} generated, ${failures.length} failed${failures.length ? `: ${failures.join(", ")}` : ""}; ${tokens} image tokens`);
}

// One batch per model (the Batch API takes one model per file); the batch ids are kept in batches.json.
const BATCHES = join(ROOT, "batches.json");
const readBatches = () => (existsSync(BATCHES) ? JSON.parse(readFileSync(BATCHES, "utf8")) : []);

async function batch(step) {
  if (step === "submit") {
    await copyFiles();
    const toMake = missing.filter((e) => e.prompt);
    const direct = toMake.filter((e) => !BATCH_MODELS.has(e.model));
    if (direct.length) console.log(`${direct.length} entries use a model the Batch API does not take (${direct[0].model}); run them without --batch`);
    const batches = readBatches();
    for (const model of new Set(toMake.map((e) => e.model).filter((m) => BATCH_MODELS.has(m)))) {
      const lines = toMake
        .filter((e) => e.model === model)
        .map((e) => JSON.stringify({ custom_id: e.id, method: "POST", url: "/v1/images/generations", body: requestBody(e) }));
      const form = new FormData();
      form.append("purpose", "batch");
      form.append("file", new Blob([`${lines.join("\n")}\n`]), `${model}.jsonl`);
      const file = await (await api("/files", { method: "POST", body: form })).json();
      const created = await (
        await api("/batches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input_file_id: file.id, endpoint: "/v1/images/generations", completion_window: "24h" }),
        })
      ).json();
      batches.push({ id: created.id, model, count: lines.length, submitted: new Date().toISOString() });
      console.log(`submitted ${created.id}: ${lines.length} × ${model}`);
    }
    writeFileSync(BATCHES, `${JSON.stringify(batches, null, 2)}\n`);
    return;
  }
  const batches = readBatches();
  for (const b of batches.filter((x) => !x.fetched)) {
    const info = await (await api(`/batches/${b.id}`)).json();
    console.log(`${b.id} (${b.count} × ${b.model}): ${info.status}, ${info.request_counts?.completed ?? 0} done, ${info.request_counts?.failed ?? 0} failed`);
    if (step !== "fetch" || info.status !== "completed") continue;
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const fileId of [info.output_file_id, info.error_file_id].filter(Boolean)) {
      // Line by line: the output file holds every picture in base64 and may be hundreds of MB.
      const res = await api(`/files/${fileId}/content`);
      for await (const line of createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity })) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        const e = byId.get(row.custom_id);
        const data = row.response?.body?.data?.[0]?.b64_json;
        if (!e || !data) {
          console.error(`✗ ${row.custom_id}: ${JSON.stringify(row.error ?? row.response?.body?.error ?? "no picture")}`);
          continue;
        }
        await store(e, Buffer.from(data, "base64"));
        console.log(`✓ ${e.kind}/${e.id}`);
      }
    }
    b.fetched = new Date().toISOString();
  }
  if (step === "fetch") writeFileSync(BATCHES, `${JSON.stringify(batches, null, 2)}\n`);
}

// A grid of thumbnails per kind with each id under its picture.
async function sheets() {
  for (const dir of [join(ROOT, "sheets"), args.out]) mkdirSync(dir, { recursive: true });
  const cell = 300;
  const label = 22;
  const cols = 6;
  for (const kind of Object.keys(KINDS)) {
    const present = selected.filter((e) => e.kind === kind && existsSync(e.file));
    if (!present.length) continue;
    for (let page = 0; page * 48 < present.length; page++) {
      const slice = present.slice(page * 48, page * 48 + 48);
      const rows = Math.ceil(slice.length / cols);
      const height = KINDS[kind].size === "1536x1024" ? Math.round(cell * (2 / 3)) : cell;
      const composites = [];
      for (const [i, e] of slice.entries()) {
        const left = (i % cols) * cell;
        const top = Math.floor(i / cols) * (height + label);
        composites.push({ input: await sharp(e.file).resize(cell - 4, height - 4, { fit: "cover" }).toBuffer(), left: left + 2, top: top + 2 });
        const text = e.id.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        composites.push({
          input: Buffer.from(`<svg width="${cell}" height="${label}"><text x="4" y="16" font-family="sans-serif" font-size="13" fill="#ddd">${text}</text></svg>`),
          left,
          top: top + height,
        });
      }
      const name = `sheet-${kind}${page ? `-${page + 1}` : ""}.jpg`;
      const jpeg = await sharp({ create: { width: cols * cell, height: rows * (height + label), channels: 3, background: "#222" } })
        .composite(composites)
        .jpeg({ quality: 85 })
        .toBuffer();
      // In the repository for anyone browsing it, and in --out for review.
      for (const dir of [join(ROOT, "sheets"), args.out]) writeFileSync(join(dir, name), jpeg);
      console.log(`${name}: ${slice.length} pictures`);
    }
  }
}

function run(command, commandArgs, env = process.env) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: "inherit", env });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed`);
}

// The pictures to the docs site's bucket, cached for a year: a picture's id never changes what it shows.
async function upload() {
  const bucket = process.env.SMITHABLE_DOCS_BUCKET;
  if (!bucket) throw new Error("set SMITHABLE_DOCS_BUCKET to the docs site's bucket name");
  // A key limited to images/ in ~/.config/smithable/images.env when there is one (KEY=value lines),
  // else the default AWS profile. Its values are passed to aws, never printed.
  const file = join(homedir(), ".config/smithable/images.env");
  const scoped = existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, "utf8")
          .split("\n")
          .map((l) => l.trim().match(/^([A-Z_]+)=["']?(.*?)["']?$/))
          .filter(Boolean)
          .map((m) => [m[1], m[2]]),
      )
    : {};
  console.log(existsSync(file) ? `using the key in ${file}` : "using the default AWS profile");
  const env = { ...process.env, ...scoped };
  run("aws", ["s3", "sync", "images/", `s3://${bucket}/images/`, "--cache-control", "public, max-age=31536000", "--content-type", "image/webp", "--exclude", "*", "--include", "*.webp"], env);
  // Ids gone from the manifest (rejected and replaced under a new id) leave the bucket.
  const inManifest = new Map(entries.map((e) => [e.id, e.kind]));
  for (const [id, kind] of Object.entries(uploaded))
    if (!inManifest.has(id)) {
      run("aws", ["s3", "rm", `s3://${bucket}/images/${kind}/${id}.webp`], env);
      delete uploaded[id];
    }
  for (const e of entries) if (existsSync(e.file)) uploaded[e.id] = e.kind;
  const sorted = Object.fromEntries(Object.entries(uploaded).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(UPLOADED, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`uploaded.json: ${Object.keys(sorted).length} pictures served; commit it`);
  // The index too, where the CLI and the service fetch it: cached for a day, not a year, and
  // invalidated at CloudFront when SMITHABLE_DOCS_DISTRIBUTION names the distribution.
  await writeIndex();
  run("aws", ["s3", "cp", "index.json", `s3://${bucket}/images/index.json`, "--content-type", "application/json", "--cache-control", "public, max-age=86400"], env);
  const distribution = process.env.SMITHABLE_DOCS_DISTRIBUTION;
  if (distribution) run("aws", ["cloudfront", "create-invalidation", "--distribution-id", distribution, "--paths", "/images/index.json", "--query", "Invalidation.Id", "--output", "text"], env);
  else console.log("set SMITHABLE_DOCS_DISTRIBUTION to refresh the cached index at once; otherwise it updates within a day");
}

// Every picture and the index in one tarball, to attach to a GitHub release for offline use.
function tar() {
  const name = `images-${new Date().toISOString().slice(0, 10)}.tar`;
  run("tar", ["-cf", name, "images", "index.json"]);
  console.log(`${name}: gh release create images-${name.slice(7, 17)} ${name}`);
}

if (args["dry-run"]) dryRun();
else if (args.upload) await upload();
else if (args.tar) tar();
else if (args.sheet) await sheets();
else if (args.index) {
  await copyFiles();
  await writeIndex();
}
else {
  if (args.batch) await batch(args.batch);
  else await generate();
  await writeIndex();
}
