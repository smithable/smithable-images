// What --upload sends, decided from the version being published and nothing else: a file in images/
// that no entry of that version names (a withdrawn picture, a picture taken out before it was ever
// published) never goes up, and neither does a version listed as never published.

/** Versions in versions/ that are never put in the bucket (README, "Versions never published"). */
export const NEVER_PUBLISHED = ["2026-11-18.5"];

/**
 * index: the entries of the version being published ({ id, kind, sha256 }).
 * versionNames: the file names in versions/ ("2026-11-18.7.json", …).
 * Returns the files by id (images/<kind>/<id>.webp, the address today's CLI reads), the files by hash
 * (images/files/<sha256>.webp, what versions name), and the versions to put.
 */
export function planUpload(index, versionNames) {
  const byId = index.map((e) => ({ src: `images/${e.kind}/${e.id}.webp`, key: `images/${e.kind}/${e.id}.webp` }));
  const seen = new Set();
  const byHash = [];
  for (const e of index) {
    if (seen.has(e.sha256)) continue;
    seen.add(e.sha256);
    byHash.push({ src: `images/${e.kind}/${e.id}.webp`, key: `images/files/${e.sha256}.webp` });
  }
  const versions = versionNames.filter((n) => n.endsWith(".json") && !NEVER_PUBLISHED.includes(n.replace(/\.json$/, ""))).sort();
  return { byId, byHash, versions };
}
