#!/usr/bin/env node
// The weekly look at what collect.mjs found: for each subject in the review folder, the pictures not
// yet shown get a pre-pick and go on one numbered contact sheet for a person to pick from. Nothing
// enters the library here, and only Commons' pictures and Pixabay's with their date evidence are
// looked at (the label says Pixabay's). The pre-pick is plain rules (size, aspect), then a small vision model's
// reading (on subject, a photograph, no logo, no text over it, no watermark, no recognisable person);
// a picture the model could not read is shown but not pre-picked, and a run where it read none stops. What the person sees is in
// <out>/candidates.json, each picture's number, file, provenance, verdict and reasons.
//
//   node scripts/review-sheet.mjs --review <dir> --out <dir> [--per-subject 24] [--model claude-haiku-5-5] [--no-vision]
//
// The key is ANTHROPIC_API_KEY. A picture is marked shown in <review>/shown.json, so next week's
// sheet holds only new ones.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { isCommonsPage } from "./commons.mjs";
import { pixabayEvidenceHolds } from "./pixabay.mjs";

const MIN_LONG = 1280;
const MAX_ASPECT = 2.2;
const W = 480;
const H = 360;
const GAP = 8;
const ACROSS = 4;

const READING = {
  type: "object",
  properties: {
    onSubject: { type: "boolean", description: "the subject is plainly what the picture shows" },
    photograph: { type: "boolean", description: "a real photograph, not a drawing, scan of a page, chart or screenshot" },
    logo: { type: "boolean", description: "a logo or a brand's name is the main thing in it" },
    textOver: { type: "boolean", description: "words are laid over or fill the picture; a small sign in a scene does not count" },
    watermark: { type: "boolean" },
    person: { type: "boolean", description: "a person's face can be recognised" },
    note: { type: "string", description: "what it shows, and its look, in under twelve words" },
  },
  required: ["onSubject", "photograph", "logo", "textOver", "watermark", "person", "note"],
  additionalProperties: false,
};

export function plainReasons({ width, height }) {
  if (!(width > 0 && height > 0)) return ["no size"];
  const reasons = [];
  if (Math.max(width, height) < MIN_LONG) reasons.push(`under ${MIN_LONG} px`);
  if (Math.max(width, height) / Math.min(width, height) > MAX_ASPECT) reasons.push("too narrow");
  return reasons;
}

export function readingReasons(r) {
  const reasons = [];
  if (!r.onSubject) reasons.push("off subject");
  if (!r.photograph) reasons.push("not a photograph");
  if (r.logo) reasons.push("a logo");
  if (r.textOver) reasons.push("text over it");
  if (r.watermark) reasons.push("a watermark");
  if (r.person) reasons.push("a recognisable person");
  return reasons;
}

// One small picture and the subject to a small model; its answer, or the error that stopped it.
export function claudeReader(client, model) {
  return async (file, subject) => {
    const data = (await sharp(file).resize(512, 512, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer()).toString("base64");
    const message = await client.messages.create({
      model,
      max_tokens: 2000,
      output_config: { format: { type: "json_schema", schema: READING } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
            { type: "text", text: `Could this picture go in a library of photographs for apps, under the subject "${subject}"? Read it as the fields ask.` },
          ],
        },
      ],
    });
    const text = message.content.find((b) => b.type === "text")?.text;
    if (message.stop_reason !== "end_turn" || !text) throw new Error(`no reading: ${message.stop_reason}`);
    return JSON.parse(text);
  };
}

function label(n, pick, why, from = "") {
  const esc = (s) => s.replace(/[<>&"']/g, "");
  const colour = pick ? "#15803d" : "#111827";
  const words = pick ? "pre-pick" : esc(why).slice(0, 44);
  return Buffer.from(
    `<svg width="${W}" height="${H}">` +
      `<rect width="56" height="34" fill="${colour}"/><text x="10" y="25" font-size="22" font-family="sans-serif" fill="white">${n}</text>` +
      // Where it is from, as Pixabay's API asks wherever its results are shown.
      `${from ? `<rect x="${W - 92}" width="92" height="26" fill="#111827" opacity="0.85"/><text x="${W - 84}" y="19" font-size="16" font-family="sans-serif" fill="white">${esc(from)}</text>` : ""}` +
      `<rect y="${H - 30}" width="${W}" height="30" fill="${colour}" opacity="0.85"/><text x="10" y="${H - 9}" font-size="17" font-family="sans-serif" fill="white">${words}</text>` +
      `${pick ? `<rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="none" stroke="${colour}" stroke-width="5"/>` : ""}</svg>`,
  );
}

function atomicJson(file, value) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

/** Whether a picture may be shown: from Commons, or from Pixabay with evidence that holds. */
function mayShow(sidecar) {
  try {
    const prov = JSON.parse(readFileSync(sidecar, "utf8"));
    return isCommonsPage(prov.pageUrl) || pixabayEvidenceHolds(prov);
  } catch {
    return false; // A damaged list of where it came from: not shown.
  }
}

export async function reviewSheets({ review, out, perSubject = 24, read }) {
  const shownFile = join(review, "shown.json");
  const shown = new Set(existsSync(shownFile) ? JSON.parse(readFileSync(shownFile, "utf8")) : []);
  const subjects = [];
  let asked = 0;
  let failed = 0;
  let lastError;
  const entries = readdirSync(review, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const slug of entries) {
    const dir = join(review, slug);
    const fresh = readdirSync(dir)
      .filter((f) => f.endsWith(".webp") && !shown.has(`${slug}/${f}`) && existsSync(join(dir, f.replace(/\.webp$/, ".json"))))
      // Only these can reach the library, so no other is read, pre-picked or shown.
      .filter((f) => mayShow(join(dir, f.replace(/\.webp$/, ".json"))))
      .sort()
      .slice(0, perSubject);
    if (!fresh.length) continue;
    const candidates = [];
    for (const [i, name] of fresh.entries()) {
      const file = join(dir, name);
      const provenance = JSON.parse(readFileSync(file.replace(/\.webp$/, ".json"), "utf8"));
      const reasons = plainReasons(provenance);
      let note;
      if (!reasons.length && !read) reasons.push("not read");
      else if (!reasons.length) {
        asked++;
        try {
          const reading = await read(file, provenance.subject ?? slug);
          reasons.push(...readingReasons(reading));
          note = reading.note;
        } catch (e) {
          failed++;
          lastError = String(e.message ?? e).slice(0, 120);
          reasons.push("not read");
          note = lastError;
        }
      }
      candidates.push({ ...provenance, n: i + 1, file: `${slug}/${name}`, prePick: !reasons.length, reasons, note });
    }
    subjects.push({ slug, subject: candidates[0].subject ?? slug, candidates });
  }
  // No reading at all is a bad key or an outage, not a week of bad pictures: no sheet, nothing marked shown.
  if (asked && failed === asked) throw new Error(`no picture could be read: ${lastError}`);
  if (!subjects.length) return subjects;
  mkdirSync(out, { recursive: true });
  for (const { slug, candidates } of subjects) {
    const tiles = await Promise.all(
      candidates.map(async (c, i) => ({
        input: await sharp(join(review, c.file))
          // The whole photograph, never cropped: a person judges all of it, and the crop comes later.
          .resize(W, H, { fit: "contain", background: "#e5e7eb" })
          .composite([{ input: label(c.n, c.prePick, c.reasons.join(", "), c.source === "pixabay" ? "Pixabay" : "") }])
          .png()
          .toBuffer(),
        left: (i % ACROSS) * (W + GAP),
        top: Math.floor(i / ACROSS) * (H + GAP),
      })),
    );
    await sharp({
      create: { width: ACROSS * (W + GAP), height: Math.ceil(tiles.length / ACROSS) * (H + GAP), channels: 3, background: "#ffffff" },
    })
      .composite(tiles)
      .webp({ quality: 80 })
      .toFile(join(out, `sheet-${slug}.webp`));
    for (const c of candidates) shown.add(c.file);
  }
  atomicJson(join(out, "candidates.json"), subjects);
  // Only once the sheets are written: a run that fails shows the same pictures next time.
  atomicJson(shownFile, [...shown].sort());
  return subjects;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: args } = parseArgs({
    options: {
      review: { type: "string" },
      out: { type: "string" },
      "per-subject": { type: "string", default: "24" },
      model: { type: "string", default: "claude-haiku-5-5" },
      "no-vision": { type: "boolean" },
    },
  });
  if (!args.review || !args.out) throw new Error("give --review <dir> and --out <dir>");
  const perSubject = Number(args["per-subject"]);
  if (!Number.isInteger(perSubject) || perSubject < 1) throw new Error("--per-subject takes a whole number from 1");
  let read;
  if (!args["no-vision"]) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    read = claudeReader(new Anthropic({ timeout: 60_000 }), args.model);
  }
  const subjects = await reviewSheets({ review: args.review, out: args.out, perSubject, read });
  const pictures = subjects.flatMap((s) => s.candidates);
  console.log(`${subjects.length} sheets, ${pictures.length} pictures, ${pictures.filter((c) => c.prePick).length} pre-picked${subjects.length ? `, in ${args.out}` : ""}`);
  for (const s of subjects) console.log(`  ${s.slug}: ${s.candidates.length}, pre-picked ${s.candidates.filter((c) => c.prePick).map((c) => c.n).join(" ") || "none"}`);
}
