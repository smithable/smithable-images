// Pixabay, read-only, for the collector and the sheet: only photographs published before Pixabay's
// licence change of 2019-01-09, which its terms (section 4) name CC0 content. The API gives an
// upload date, not the published date (a picture can wait in review some days), so the rule keeps a
// fortnight's margin: uploaded before 2018-12-26, and an id at or below the last id uploaded on
// 2018-12-25 (README, "Real photographs", for how both were found). No page of Pixabay's is read;
// each kept picture's evidence (its id, the date in its preview's path, the threshold, a Wayback
// Machine snapshot from before the change where one exists) is written beside it.
//
// The API's rules (pixabay.com/api/docs): about 100 requests a minute, answers cached 24 hours, no
// lots of automated queries, no systematic mass downloads. So one search per subject, ever (the
// collector's state), and a few pictures of each subject at most: a need, never a harvest.

export const LICENCE_CHANGE = "2019-01-09";
export const CUTOFF = "2018-12-26";
export const THRESHOLD_ID = 3895010;
export const PER_SUBJECT = 6;
/** Searches a night at most, whatever the list of subjects holds. */
export const SEARCHES_A_NIGHT = 20;

const API = "https://pixabay.com/api/";

/** The upload date in a preview's path: /photo/YYYY/MM/DD/hh/mm/<name>-<id>_150.jpg. */
export function uploadDate(previewURL) {
  const m = /\/photo\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(previewURL ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

// A tag that says a person is in it: CC0 waives the photographer's rights, not a pictured person's,
// and Pixabay never asked for model releases. The sheet's reading looks for faces as well.
const PEOPLE = /\b(person|people|woman|women|man|men|girl|girls|boy|boys|child|children|kid|kids|baby|portrait|face|model|lady|guy|human|couple|family|bride|groom|selfie|businessman|businesswoman|teen|teenager|female|male|adult|crowd|hand|hands|young|fashion|smile|smiling|tourist|tourists|worker|student|students|wedding)\b/i;

/** Why a hit may not be kept, or nothing when it may. */
export function refusal(hit) {
  const uploaded = uploadDate(hit.previewURL);
  if (!uploaded) return "no upload date";
  if (uploaded >= CUTOFF) return `uploaded ${uploaded}`;
  if (!(Number(hit.id) <= THRESHOLD_ID)) return `id over ${THRESHOLD_ID}`;
  // The date's path names the picture too: one that names another is no evidence for this one.
  if (!new RegExp(`-${Number(hit.id)}_\\d+\\.\\w+$`).test(hit.previewURL)) return "the date's path names another picture";
  if (hit.type !== "photo" || hit.isAiGenerated || hit.isGRated === false) return "not a plain photograph";
  if (PEOPLE.test(hit.tags ?? "")) return "people in its tags";
  return undefined;
}

/** One search for a subject; the key goes in the URL, so no error ever names the URL. */
export async function pixabaySearch(subject, key, fetchFn) {
  const params = new URLSearchParams({ key, q: subject, image_type: "photo", safesearch: "true", order: "popular", per_page: "20" });
  const res = await fetchFn(`${API}?${params}`);
  if (res.status === 429 || res.status >= 500) throw new Error(`stop ${res.status}`);
  if (!res.ok) throw new Error(`Pixabay answered ${res.status}`);
  return (await res.json()).hits ?? [];
}

/** The Wayback Machine's snapshot of the page from before the change, by its address now and its old /en/ one. */
export async function wayback(pageUrl, fetchFn) {
  let asked;
  try {
    asked = [pageUrl, `https://pixabay.com/en/${new URL(pageUrl).pathname.replace(/^\/photos\//, "")}`];
  } catch {
    return { asked: [String(pageUrl)], snapshot: null };
  }
  for (const url of asked) {
    try {
      const res = await fetchFn(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=20190108`);
      if (!res.ok) continue;
      const s = (await res.json()).archived_snapshots?.closest;
      if (s?.available && s.timestamp < "20190109") return { asked, snapshot: { url: s.url, timestamp: s.timestamp } };
    } catch {}
  }
  return { asked, snapshot: null };
}

export function isPixabayPage(url) {
  try {
    return new URL(url).hostname === "pixabay.com";
  } catch {
    return false;
  }
}

/** A sidecar the sheet may show: Pixabay's page, with evidence that holds under today's rule. */
export function pixabayEvidenceHolds(prov) {
  const e = prov?.evidence;
  return Boolean(
    prov?.source === "pixabay" &&
      isPixabayPage(prov.pageUrl) &&
      e &&
      Number(e.pixabayId) <= THRESHOLD_ID &&
      typeof e.uploaded === "string" &&
      e.uploaded < CUTOFF &&
      typeof e.uploadedFrom === "string" &&
      e.uploadedFrom.includes(`/${e.uploaded.replaceAll("-", "/")}/`) &&
      typeof e.rule === "string",
  );
}
