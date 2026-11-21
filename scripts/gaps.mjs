// The library's gap list: which pictures are missing, worked out from index.json each time it runs.
//
//   node scripts/gaps.mjs [--starters <engine>/examples] [--needs <file>] [--out <file>] [--styles photographs,lifelike]
//
// First the starters' needs: every subject a starter's pictures show (the `starter-<name>` tags) that a
// style has no picture of. Then, with --needs, the needs of a second file kept elsewhere: a list of
// groups, each with a `name` (or `trade`), optional `class` (a `never` group is left out of the ranking),
// optional `count` (a number, or numbers by area, summed), and `pictures`, each a need
// { slot, kind, subject: [keys], people: true|false, target }. A need is met by a photographic
// landscape picture (one of --styles) of that kind (a hero also serves a sample), of one of its
// subjects (in the order listed, the first preferred), with a `people` or `person` tag when people is true and neither when false; one
// picture per subject, at most target. The needs are ranked by how many groups have them, then by
// the groups' counts. Nothing is written back to the library: the output goes to --out or stdout.

import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const PEOPLE = ["people", "person"];

export function starterGaps(index, styles, files = {}) {
  const starters = new Map();
  const subjects = new Set(index.map((e) => e.subject).filter(Boolean));
  const base = (s) => s.replace(/-\d+$/, "");
  // An alternate (<subject>-N: -2 and on, and the Lifelike set's -1 names) is another picture of its
  // subject, not a subject of its own.
  const alternate = (s) => /-\d+$/.test(s) && subjects.has(base(s));
  const fold = (s) => (alternate(s) ? base(s) : s);
  const add = (starter, subject, kind) => {
    if (!starters.has(starter)) starters.set(starter, new Map());
    starters.get(starter).set(subject, kind);
  };
  for (const e of index) {
    if (!e.subject) continue;
    for (const t of e.tags) if (t.startsWith("starter-") && t !== "starter-") add(t.slice("starter-".length), fold(e.subject), e.kind);
  }
  // A sample file is named by its entry id (food-soup-b) or by its subject with a number (market-laptop-1).
  const byId = new Map(index.filter((e) => e.subject).map((e) => [e.id, e.subject]));
  const unknown = [];
  for (const [starter, names] of Object.entries(files)) {
    for (const name of names) {
      const found = byId.get(name) ?? (subjects.has(name) ? name : subjects.has(base(name)) ? base(name) : null);
      const subject = found && fold(found);
      if (subject) add(starter, subject, "sample");
      else unknown.push({ starter, file: name });
    }
  }
  // A style has a subject when it holds a picture of it or of one of its alternates.
  const have = new Set(index.filter((e) => e.subject).map((e) => `${e.style}/${fold(e.subject)}`));
  const out = [];
  for (const [starter, needs] of [...starters].sort(([a], [b]) => a.localeCompare(b))) {
    for (const style of styles) {
      const missing = [...needs]
        .filter(([s]) => !have.has(`${style}/${s}`))
        .map(([subject, kind]) => ({ subject, kind }))
        .sort((a, b) => a.subject.localeCompare(b.subject));
      if (missing.length) out.push({ starter, style, missing });
    }
  }
  return { starters: out, unknown };
}

/** The sample files each starter's samples name (examples/<starter>/samples/*.yml), without .webp. */
export function starterFiles(dir) {
  const files = {};
  for (const starter of readdirSync(dir).sort()) {
    const samples = join(dir, starter, "samples");
    if (!existsSync(samples)) continue;
    for (const f of readdirSync(samples).filter((f) => f.endsWith(".yml")).sort()) {
      const seen = new WeakSet();
      const walk = (v) => {
        if (!v || typeof v !== "object" || seen.has(v)) return;
        seen.add(v);
        if (Array.isArray(v)) return v.forEach(walk);
        for (const [k, x] of Object.entries(v)) {
          if (k === "file" && typeof x === "string" && x.endsWith(".webp")) {
            const name = x.slice(0, -".webp".length);
            (files[starter] ??= []).includes(name) || files[starter].push(name);
          } else walk(x);
        }
      };
      walk(parse(readFileSync(join(samples, f), "utf8")));
    }
  }
  return files;
}

export function matchNeed(index, need, styles) {
  const subjects = new Set(need.subject);
  const bySubject = new Map();
  for (const e of [...index].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!styles.includes(e.style) || e.orientation !== "landscape" || !subjects.has(e.subject)) continue;
    if (e.kind !== need.kind && !(need.kind === "sample" && e.kind === "hero")) continue;
    if (e.tags.some((t) => PEOPLE.includes(t)) !== Boolean(need.people)) continue;
    if (!bySubject.has(e.subject)) bySubject.set(e.subject, e.id);
  }
  const matched_ids = [...subjects].filter((s) => bySubject.has(s)).map((s) => bySubject.get(s)).slice(0, need.target);
  return { matched_ids, missing: Math.max(0, need.target - matched_ids.length) };
}

/** Subject keys the index does not have, each with the index's subjects that share a word (three letters or more). */
export function newSubjects(index, keys) {
  const known = [...new Set(index.filter((e) => e.subject).map((e) => e.subject))].sort();
  const words = (k) => k.split("-").filter((w) => w.length > 2);
  return keys
    .filter((k) => !known.includes(k))
    .map((key) => ({ key, near: known.filter((s) => words(s).some((w) => words(key).includes(w))) }));
}

const total = (count) =>
  typeof count === "number" ? count : Object.values(count ?? {}).reduce((a, c) => a + (typeof c === "number" ? c : (c?.n ?? 0)), 0);

export function groupGaps(index, groups, styles) {
  const rows = groups.map((g) => ({
    name: g.name ?? g.trade,
    class: g.class ?? "write",
    count: total(g.count),
    pictures: (g.pictures ?? []).map((n) => ({ ...pick(n), ...matchNeed(index, n, styles) })),
  }));
  const ranked = new Map();
  for (const g of rows) {
    if (g.class === "never") continue;
    for (const n of g.pictures) {
      if (!n.missing) continue;
      const key = `${n.kind}:${[...n.subject].sort().join("|")}:${n.people ? "people" : "none"}`;
      const r = ranked.get(key) ?? { need: key, groups: [], count: 0, missing: 0 };
      if (!r.groups.includes(g.name)) {
        r.groups.push(g.name);
        r.count += g.count;
      }
      r.missing += n.missing;
      ranked.set(key, r);
    }
  }
  const order = [...ranked.values()].sort((a, b) => b.groups.length - a.groups.length || b.count - a.count || a.need.localeCompare(b.need));
  const keys = [...new Set(rows.flatMap((g) => g.pictures.flatMap((n) => n.subject)))];
  return { groups: rows, ranked: order, new_subjects: newSubjects(index, keys) };
}

const pick = ({ slot, use, kind, subject, people, target }) => ({ slot: slot ?? use, kind, subject, people: Boolean(people), target });

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i < 0 ? fallback : argv[i + 1];
  };
  const styles = arg("--styles", "photographs,lifelike").split(",");
  const index = JSON.parse(readFileSync(new URL("../index.json", import.meta.url), "utf8"));
  const dir = arg("--starters");
  const result = { styles, ...starterGaps(index, styles, dir ? starterFiles(dir) : {}) };
  const needs = arg("--needs");
  if (needs) {
    const data = parse(readFileSync(needs, "utf8"));
    const groups = Array.isArray(data) ? data : (data.trades ?? data.groups);
    Object.assign(result, groupGaps(index, groups, styles));
  }
  const text = `${JSON.stringify(result, null, 2)}\n`;
  const out = arg("--out");
  if (out) {
    // Never into the library: the report goes beside the needs file or elsewhere, not over index.json.
    const library = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
    // The folder is checked, and a new file renamed over the entry, so no link can lead the write into it.
    const dir = realpathSync(dirname(resolve(out)));
    if (dir === library || dir.startsWith(library + sep)) throw new Error(`--out ${out} is inside the library; write it elsewhere`);
    const tmp = join(dir, `.${basename(out)}.${process.pid}.tmp`);
    writeFileSync(tmp, text, { flag: "wx" });
    renameSync(tmp, join(dir, basename(out)));
  }
  else process.stdout.write(text);
  const missing = (result.groups ?? []).reduce((a, g) => a + g.pictures.reduce((b, n) => b + n.missing, 0), 0);
  console.error(
    `starters: ${result.starters.reduce((a, s) => a + s.missing.length, 0)} subject(s) missing across ${styles.join(", ")}` +
      (needs ? `; needs file: ${missing} picture(s) missing, ${result.ranked.length} ranked need(s), ${result.new_subjects.length} new subject key(s)` : ""),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
