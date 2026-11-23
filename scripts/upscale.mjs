// T1040: AI upscaling of the library's pictures, as a resumable background queue.
//
// A picture is upscaled when its width is below the minimum of one of its uses (hero 2400, filler and item page
// 1600). Real-ESRGAN (realesrgan-x4plus, ncnn-vulkan v0.2.5.0) makes a 4x PNG in a temporary folder; from it come a
// master (at most 3200 wide, WebP q92) and the widths its uses serve, each written to a temporary name and renamed.
// The 4x PNG is deleted. One line per picture goes to images/upscaled/results.jsonl; a rerun skips every picture
// whose source (by its sha256) already has a line there.
//
// Order: pictures given with --dir or --list (newly generated app pictures, which need not be in the manifest), the
// starters' heroes, other heroes, samples with marked uses, other samples. Logos and icons are never upscaled.
//
// Engines: the Windows build on the GPU when C:\Users\johan\upscale\realesrgan\realesrgan-ncnn-vulkan.exe is there
// (about 50 s a picture), else the Linux build on the CPU (UPSCALE_CPU_BIN, about 15 min a picture) at the lowest
// priority on at most 3 threads. UPSCALE_ENGINE=cpu|gpu chooses. Either way one picture at a time, and while a gate
// holds /var/lib/smithable-gate/.gate-lock no picture starts; a CPU run in progress is stopped (SIGSTOP) until the
// gate ends (SIGCONT). The lock is only looked at in /proc/locks, never taken.
//
// Check: the 4x result scaled back to the source's size is compared with the source (mean absolute difference per
// channel, 0 to 255); above OUTLIER the picture is logged as an outlier and its upscale is not used.
//
// Usage: node scripts/upscale.mjs [--limit N] [--only id,id] [--dir folder | --list file] [--dry-run]
//        node scripts/upscale.mjs --sheet [N]   crop sheet of the last N results (default 12) into sheets/upscale/
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import sharp from "sharp";
import { parse } from "yaml";
import { encodedPicture } from "./image-provenance.mjs";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const OUT = join(ROOT, "images", "upscaled");
const RESULTS = join(OUT, "results.jsonl");
const MIN = { hero: 2400, filler: 1600, item: 1600 };
// Served widths (fact decisions.upscaling-plan): the master of up to 3200 is kept, not served.
const SERVE = { hero: [800, 1600, 2400], filler: [800, 1200, 1600], item: [800, 1200, 1600] };
const MASTER = 3200;
const OUTLIER = Number(process.env.UPSCALE_OUTLIER ?? 6);
const GATE_LOCK = "/var/lib/smithable-gate/.gate-lock";
const GPU_DIR = "/mnt/c/Users/johan/upscale/realesrgan";
const CPU_BIN = process.env.UPSCALE_CPU_BIN ?? join(homedir(), "repos/.session-scripts/c/upscale/bin/realesrgan-ncnn-vulkan");

// The uses of an entry: marked ones (`uses:` in the manifest), else a hero is a hero and a sample an item page.
export function usesOf(e) {
  if (e.uses?.length) return e.uses;
  return e.kind === "hero" ? ["hero"] : e.kind === "sample" ? ["item"] : [];
}

// Priority class (lower first) and whether the picture is below one of its uses' minimum width.
export function classOf(e) {
  if (e.app) return 0;
  const starter = e.tags?.some((t) => t.startsWith("starter-"));
  if (e.kind === "hero") return starter ? 1 : 2;
  if (usesOf(e).includes("hero")) return 2;
  return e.uses?.length ? 3 : 4;
}
export const needs = (e) => usesOf(e).some((u) => e.width < MIN[u]);

// The widths served for an entry: those of its uses, up to the master's width, above the source's own width.
export function widthsFor(e, master) {
  const all = new Set(usesOf(e).flatMap((u) => SERVE[u]));
  return [...all].filter((w) => w <= master && w > e.width).sort((a, b) => a - b);
}

export function queue(entries, done) {
  return entries
    .filter((e) => usesOf(e).length && needs(e) && !done.has(e.sha256))
    .sort((a, b) => classOf(a) - classOf(b) || a.id.localeCompare(b.id));
}

// Is the gate lock held? Read-only: the lock's inode in /proc/locks.
function gateRunning() {
  if (!existsSync(GATE_LOCK)) return false;
  const ino = statSync(GATE_LOCK).ino;
  return readFileSync("/proc/locks", "utf8").split("\n").some((l) => l.split(/\s+/)[5]?.endsWith(`:${ino}`));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const engine = () => (process.env.UPSCALE_ENGINE ?? (existsSync(join(GPU_DIR, "realesrgan-ncnn-vulkan.exe")) ? "gpu" : "cpu"));
const winPath = (p) => spawnSync("wslpath", ["-w", p], { encoding: "utf8" }).stdout.trim();

let child = null;
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(sig, () => {
    if (child) {
      child.kill("SIGCONT");
      child.kill("SIGTERM");
    }
    process.exit(130);
  });

// Runs Real-ESRGAN 4x from src to dst (a PNG); on the CPU route, paused while a gate runs.
async function upscale4x(src, dst) {
  const gpu = engine() === "gpu";
  const [cmd, args, opts] = gpu
    ? ["./realesrgan-ncnn-vulkan.exe", ["-i", winPath(src), "-o", winPath(dst), "-n", "realesrgan-x4plus"], { cwd: GPU_DIR }]
    : ["nice", ["-n", "19", CPU_BIN, "-i", src, "-o", dst, "-n", "realesrgan-x4plus", "-m", join(dirname(CPU_BIN), "models"), "-j", "1:1:1"],
       { env: { ...process.env, LP_NUM_THREADS: "3" } }];
  child = spawn(cmd, args, { ...opts, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
  let stopped = false;
  const watch = gpu ? null : setInterval(() => {
    const g = gateRunning();
    if (g !== stopped) child.kill(g ? "SIGSTOP" : "SIGCONT");
    stopped = g;
  }, 5000);
  const code = await new Promise((r) => child.on("close", r));
  clearInterval(watch);
  child = null;
  if (code !== 0 || !existsSync(dst)) throw new Error(`Real-ESRGAN exit ${code}: ${err.trim().split("\n").pop()}`);
}

// Writes buf to file by a temporary name and a rename, so a reader never sees half a picture.
function put(file, buf) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, buf);
  renameSync(`${file}.tmp`, file);
}

async function one(e, tmp) {
  const t0 = Date.now();
  const big = join(tmp, `${e.id}-4x.png`);
  await upscale4x(e.file, big);
  const seconds = Math.round((Date.now() - t0) / 1000);
  // Check: scaled back to the source's size, how far is it from the source?
  const back = await sharp(big).resize(e.width, e.height, { kernel: "lanczos3" }).removeAlpha().raw().toBuffer();
  const orig = await sharp(e.file).removeAlpha().raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < orig.length; i++) sum += Math.abs(orig[i] - back[i]);
  const diff = +(sum / orig.length).toFixed(2);
  const row = { id: e.id, kind: e.kind, sha256: e.sha256, from: e.width, engine: engine(), seconds, diff, at: new Date().toISOString() };
  if (diff > OUTLIER) {
    rmSync(big);
    return { ...row, status: "outlier" };
  }
  const meta = await sharp(big).metadata();
  const master = Math.min(MASTER, meta.width);
  const dir = join(OUT, e.kind);
  const masterFile = join(dir, `${e.id}.webp`);
  put(masterFile, await encodedPicture(sharp(big).resize(master).webp({ quality: 92, effort: 6 }), e.generated, masterFile));
  const widths = widthsFor(e, master);
  for (const w of widths) {
    const file = join(dir, `${e.id}-${w}.webp`);
    const output = sharp(big).resize(w, null, { kernel: "lanczos3" }).webp({ quality: 82, effort: 6 });
    put(file, await encodedPicture(output, e.generated, file));
  }
  rmSync(big);
  return { ...row, status: "done", master, widths };
}

function done() {
  if (!existsSync(RESULTS)) return new Set();
  return new Set(readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).sha256));
}

// The library's entries with their files and sizes (index.json), joined with the manifest's marks.
async function libraryEntries() {
  const index = JSON.parse(readFileSync(join(ROOT, "index.json"), "utf8"));
  const marks = new Map(parse(readFileSync(join(ROOT, "manifest.yml"), "utf8")).images.map((m) => [m.id, m]));
  return index.map((x) => ({ ...x, uses: marks.get(x.id)?.uses, file: join(ROOT, "images", x.kind, `${x.id}.webp`) })).filter((x) => existsSync(x.file));
}

// Pictures outside the manifest (newly generated app pictures): a folder, or a file with one path a line.
async function appEntries(paths) {
  const out = [];
  for (const file of paths) {
    const { width, height } = await sharp(file).metadata();
    const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
    out.push({ id: basename(file).replace(/\.\w+$/, ""), kind: "app", app: true, uses: ["hero"], file, width, height, sha256 });
  }
  return out;
}

// The top-left corner of the crop px square with the most detail (sum of absolute neighbour differences in grey).
async function busiest(file, crop) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let best = [0, 0], most = -1;
  for (let y = 0; y + crop <= h; y += Math.max(1, Math.round(crop / 4)))
    for (let x = 0; x + crop <= w; x += Math.max(1, Math.round(crop / 4))) {
      let sum = 0;
      for (let j = y; j < y + crop - 1; j += 2) for (let i = x; i < x + crop - 1; i += 2) { const p = j * w + i; sum += Math.abs(data[p] - data[p + 1]) + Math.abs(data[p] - data[p + w]); }
      if (sum > most) [most, best] = [sum, [x, y]];
    }
  return best;
}

async function sheet(n) {
  const kept = new Set(readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.status === "kept").map((r) => r.sha256));
  const rows = readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.status === "done" && !kept.has(r.sha256)).slice(-n);
  const all = new Map((await libraryEntries()).map((e) => [e.id, e]));
  const cell = 384, gap = 8, label = 24, W = 4 * (cell + gap) + 3 * gap;
  const tiles = [];
  for (const [i, r] of rows.entries()) {
    const e = all.get(r.id);
    if (!e) continue;
    // Judged at the served size (Fable, 2026-11-20): two spots at 100% of the largest served width, Lanczos from
    // the source beside the AI's file of that width: the most detailed spot and the centre, where a face or a
    // subject usually is.
    const w = Math.max(...widthsFor(e, r.master)), k = w / e.width, src = Math.round(cell / k);
    const served = join(OUT, e.kind, `${e.id}-${w}.webp`);
    const spots = [await busiest(e.file, src), [Math.round((e.width - src) / 2), Math.round((e.height - src) / 2)]];
    const parts = [];
    for (const [left, top] of spots) {
      const at = { left: Math.round(left * k), top: Math.round(top * k), width: cell, height: cell };
      parts.push(await sharp(await sharp(e.file).resize(w, null, { kernel: "lanczos3" }).toBuffer()).extract(at).toBuffer());
      parts.push(await sharp(served).extract(at).toBuffer());
    }
    const y = i * (cell + label + gap);
    const text = `${r.id}  ${r.from}→${w}px at 100%  diff ${r.diff}   detail: Lanczos | AI     centre: Lanczos | AI`;
    tiles.push({ input: Buffer.from(`<svg width="${W}" height="${label}"><text x="2" y="17" font-family="sans-serif" font-size="15" fill="#eee">${text}</text></svg>`), left: 0, top: y });
    parts.forEach((input, j) => tiles.push({ input, left: j * (cell + gap) + (j > 1 ? gap * 3 : 0), top: y + label }));
  }
  const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Mariehamn" }).slice(0, 16).replace(" ", "-").replace(":", "");
  const file = join(ROOT, "images", "upscaled", "sheets", `${stamp}.jpg`);
  mkdirSync(dirname(file), { recursive: true });
  await sharp({ create: { width: W, height: Math.max(1, tiles.length / 5) * (cell + label + gap), channels: 3, background: "#222" } })
    .composite(tiles).jpeg({ quality: 88 }).toFile(file);
  console.log(file);
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  if (process.argv.includes("--sheet")) return sheet(Number(arg("--sheet")) || 12);
  const dir = arg("--dir"), list = arg("--list");
  const app = dir ? readdirSync(dir).filter((f) => /\.(webp|png|jpe?g)$/i.test(f)).map((f) => join(dir, f))
    : list ? readFileSync(list, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : [];
  const only = arg("--only")?.split(",");
  let todo = queue([...(await appEntries(app)), ...(await libraryEntries())], done());
  if (only) todo = todo.filter((e) => only.includes(e.id));
  todo = todo.slice(0, Number(arg("--limit")) || Infinity);
  console.log(`${todo.length} to upscale on the ${engine().toUpperCase()}`);
  if (process.argv.includes("--dry-run")) return todo.forEach((e) => console.log(classOf(e), e.id, e.width));
  // The Windows build cannot write into the Linux file system: its work folder is on the Windows drive.
  const tmp = engine() === "gpu" ? join(GPU_DIR, "..", "work") : join(OUT, ".work");
  mkdirSync(tmp, { recursive: true });
  for (const e of todo) {
    while (gateRunning()) await sleep(30000);
    try {
      const row = await one(e, tmp);
      appendFileSync(RESULTS, `${JSON.stringify(row)}\n`);
      console.log(`${row.status} ${e.id} ${row.seconds}s diff ${row.diff}`);
    } catch (err) {
      appendFileSync(RESULTS.replace(".jsonl", "-errors.jsonl"), `${JSON.stringify({ id: e.id, error: String(err.message ?? err), at: new Date().toISOString() })}\n`);
      console.log(`error ${e.id}: ${err.message ?? err}`);
    }
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
