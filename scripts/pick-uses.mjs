#!/usr/bin/env node
// Pre-picks samples that may also serve as a hero or a filler (T1040 step 4), by rule, and makes contact sheets of
// the candidates for a person to judge. The marks themselves are written by hand into manifest.yml as
// `uses: [hero, filler]`; this script only proposes.
//
//   node scripts/pick-uses.mjs [--sheets]   writes images/upscaled/picks.json (and contact sheets with --sheets)
//
// The rule, on a grid of detail (mean absolute neighbour difference of a small grey copy):
// - hero: landscape, a calm area for text (the left, right or top part of the picture well below the picture's
//   own detail and low in absolute terms), and no small central subject (the centre does not hold most of the
//   detail while the rest is empty).
// - filler (beside text, not under it): landscape or square, and no small central subject.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
export const COLS = 12, ROWS = 8;
const CALM = 6; // the calm area's mean detail, at most (0-255 scale)
const CALM_SHARE = 0.6; // and at most this share of the picture's mean detail
const CENTRE_SHARE = 0.5; // a small central subject: the centre's 4x4 cells hold more than this share of all detail

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const cells = (grid, x0, x1, y0, y1) => grid.slice(y0, y1).flatMap((row) => row.slice(x0, x1));

// grid: ROWS rows of COLS numbers. Returns the measures and the verdict for one picture.
export function judge(grid, orientation) {
  const all = mean(grid.flat());
  const areas = {
    left: mean(cells(grid, 0, 5, 0, ROWS)),
    right: mean(cells(grid, COLS - 5, COLS, 0, ROWS)),
    top: mean(cells(grid, 0, COLS, 0, 3)),
  };
  const [calmSide, calmest] = Object.entries(areas).sort((a, b) => a[1] - b[1])[0];
  const total = grid.flat().reduce((a, b) => a + b, 0);
  const centre = cells(grid, 4, 8, 2, 6).reduce((a, b) => a + b, 0) / Math.max(1e-9, total);
  const smallSubject = centre > CENTRE_SHARE;
  const calm = calmest <= CALM && calmest <= all * CALM_SHARE;
  const uses = [];
  if (orientation === "landscape" && calm && !smallSubject) uses.push("hero");
  if (orientation !== "portrait" && !smallSubject) uses.push("filler");
  return { detail: +all.toFixed(2), calmSide, calmest: +calmest.toFixed(2), centre: +centre.toFixed(2), uses };
}

async function gridOf(file) {
  const w = COLS * 8, h = ROWS * 8;
  const { data } = await sharp(file).greyscale().resize(w, h, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const p = y * w + x;
      grid[Math.floor(y / 8)][Math.floor(x / 8)] += (Math.abs(data[p] - data[p + 1]) + Math.abs(data[p] - data[p + w])) / 128;
    }
  return grid;
}

async function contactSheet(rows, file, title) {
  const tw = 300, th = 200, lh = 18, cols = 6;
  const tiles = [];
  for (const [i, r] of rows.entries()) {
    const left = (i % cols) * tw, top = 30 + Math.floor(i / cols) * (th + lh);
    tiles.push({ input: await sharp(r.file).resize(tw - 4, th - 4, { fit: "cover" }).toBuffer(), left: left + 2, top: top + 2 });
    const text = `${i + 1}. ${r.id} (${r.calmSide})`.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    tiles.push({ input: Buffer.from(`<svg width="${tw}" height="${lh}"><text x="3" y="13" font-family="sans-serif" font-size="12" fill="#eee">${text}</text></svg>`), left, top: top + th });
  }
  tiles.push({ input: Buffer.from(`<svg width="${tw * cols}" height="30"><text x="4" y="21" font-family="sans-serif" font-size="18" fill="#fff">${title}</text></svg>`), left: 0, top: 0 });
  await sharp({ create: { width: tw * cols, height: 30 + Math.ceil(rows.length / cols) * (th + lh), channels: 3, background: "#222" } })
    .composite(tiles)
    .jpeg({ quality: 80 })
    .toFile(file);
}

async function main() {
  const index = JSON.parse(readFileSync(join(ROOT, "index.json"), "utf8"));
  const picks = [];
  for (const e of index.filter((x) => x.kind === "sample")) {
    const file = join(ROOT, "images", e.kind, `${e.id}.webp`);
    picks.push({ id: e.id, orientation: e.orientation, file, ...judge(await gridOf(file), e.orientation) });
  }
  const out = join(ROOT, "images", "upscaled");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "picks.json"), `${JSON.stringify(picks.map(({ file, ...p }) => p), null, 1)}\n`);
  const heroes = picks.filter((p) => p.uses.includes("hero"));
  const fillers = picks.filter((p) => !p.uses.includes("hero") && p.uses.includes("filler"));
  console.log(`${picks.length} samples: ${heroes.length} hero candidates, ${fillers.length} more filler candidates`);
  if (process.argv.includes("--sheets")) {
    const dir = join(out, "sheets", "picks");
    mkdirSync(dir, { recursive: true });
    for (const [name, rows] of [["hero", heroes], ["filler", fillers]])
      for (let i = 0; i < rows.length; i += 48) {
        const file = join(dir, `${name}-${i / 48 + 1}.jpg`);
        await contactSheet(rows.slice(i, i + 48), file, `${name} candidates ${i + 1}-${Math.min(rows.length, i + 48)} of ${rows.length}`);
        console.log(file);
      }
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
