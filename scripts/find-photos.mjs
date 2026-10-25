#!/usr/bin/env node
// Candidates for a real photograph in the library: searches Wikimedia Commons for files whose
// structured data says CC0 or public domain, keeps those whose own licence line agrees and that
// carry no restrictions (personality rights, trademarks), and writes a numbered contact sheet and
// the list (candidates.json) into --out. Nothing is added to the library: a picked file goes in
// manifest.yml as `photo: <its Commons page>` and make-images.mjs fetches it.
//
//   node scripts/find-photos.mjs "intitle:sideboard teak" [--pd] [--limit 24] [--min 1200] [--out <dir>]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { commonsLicence, commonsQuery, UA } from "./commons.mjs";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: "string", default: "24" },
    min: { type: "string", default: "1200" },
    out: { type: "string", default: "candidates" },
    pd: { type: "boolean" },
  },
});
const query = positionals.join(" ");
if (!query) throw new Error('give a search, e.g. find-photos.mjs "city bike"');

// CC0 (P275 = Q6938433), with --pd also public domain (P6216 = Q19652, mostly old photographs);
// no museum catalogue shots. The search is Commons' own: intitle:bike narrows to file names.
const licences = args.pd ? "P275=Q6938433|P6216=Q19652" : "P275=Q6938433";
const search = `${query} haswbstatement:${licences} filetype:bitmap -"MET" -museum`;
const json = await commonsQuery({
  generator: "search",
  gsrsearch: search,
  gsrnamespace: "6",
  gsrlimit: "50",
  prop: "imageinfo",
  iiprop: "url|size|extmetadata",
  iiurlwidth: "480",
});
const pages = Object.values(json.query?.pages ?? {}).sort((a, b) => a.index - b.index);
const found = [];
for (const p of pages) {
  const info = p.imageinfo?.[0];
  if (!info || Math.max(info.width, info.height) < Number(args.min)) continue;
  const licence = commonsLicence(info.extmetadata);
  if (!licence.ok) continue;
  found.push({ n: found.length + 1, page: info.descriptionurl, title: p.title, width: info.width, height: info.height, licence: licence.name, author: licence.author, thumb: info.thumburl });
  if (found.length >= Number(args.limit)) break;
}
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "candidates.json"), `${JSON.stringify(found, null, 2)}\n`);

// The sheet: 4 across, each 3:2 tile with its number.
const W = 480;
const H = 320;
const tiles = [];
for (const c of found) {
  const res = await fetch(c.thumb, { headers: { "user-agent": UA } });
  if (!res.ok) continue;
  const label = Buffer.from(`<svg width="${W}" height="${H}"><rect x="0" y="0" width="56" height="34" fill="black" opacity="0.75"/><text x="10" y="25" font-size="22" font-family="sans-serif" fill="white">${c.n}</text></svg>`);
  const tile = await sharp(Buffer.from(await res.arrayBuffer())).resize(W, H, { fit: "cover" }).composite([{ input: label }]).png().toBuffer();
  const i = tiles.length;
  tiles.push({ input: tile, left: (i % 4) * (W + 8), top: Math.floor(i / 4) * (H + 8) });
}
const rows = Math.max(1, Math.ceil(tiles.length / 4));
await sharp({ create: { width: 4 * (W + 8), height: rows * (H + 8), channels: 3, background: "#ffffff" } })
  .composite(tiles)
  .webp({ quality: 80 })
  .toFile(join(args.out, "sheet.webp"));
console.log(`${found.length} candidates for "${query}" in ${args.out}/ (sheet.webp, candidates.json)`);
for (const c of found) console.log(`${String(c.n).padStart(3)}  ${c.licence.padEnd(14)} ${c.width}x${c.height}  ${c.title}`);
