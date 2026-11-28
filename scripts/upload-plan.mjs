// What --upload sends, decided from the version being published and nothing else: a file in images/
// that no entry of that version names (a withdrawn picture, a picture taken out before it was ever
// published) never goes up, and neither does a version listed as never published.

/** Versions in versions/ that are never put in the bucket (README, "Versions never published"). */
export const NEVER_PUBLISHED = ["2026-11-18.5"];

/**
 * index: the entries of the version being published ({ id, kind, sha256 }).
 * versionNames: the file names in versions/ ("2026-11-18.7.json", …).
 * Returns the files by id (images/<kind>/<id>.webp, the address today's CLI reads, and an enlarged
 * width as images/<kind>/<id>-<width>.webp), the files by hash (images/files/<sha256>.webp, what
 * versions name), and the versions to put.
 */
export function planUpload(index, versionNames) {
  const files = index.flatMap((e) => [
    { src: `images/${e.kind}/${e.id}.webp`, name: `${e.kind}/${e.id}.webp`, sha256: e.sha256 },
    ...(e.widths ?? []).map((w) => ({ src: `images/upscaled/${e.kind}/${e.id}-${w.width}.webp`, name: `${e.kind}/${e.id}-${w.width}.webp`, sha256: w.sha256 })),
  ]);
  const byId = files.map((f) => ({ src: f.src, key: `images/${f.name}` }));
  // An id ending in a width ("sea-1600") would overwrite another's enlarged copy ("sea" at 1600).
  const twice = byId.find((f, i) => byId.findIndex((g) => g.key === f.key) !== i);
  if (twice) throw new Error(`Two files would be uploaded as ${twice.key}`);
  const seen = new Set();
  const byHash = [];
  for (const f of files) {
    if (seen.has(f.sha256)) continue;
    seen.add(f.sha256);
    byHash.push({ src: f.src, key: `images/files/${f.sha256}.webp` });
  }
  const versions = versionNames.filter((n) => n.endsWith(".json") && !NEVER_PUBLISHED.includes(n.replace(/\.json$/, ""))).sort();
  return { byId, byHash, versions };
}
