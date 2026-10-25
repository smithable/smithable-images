// Wikimedia Commons, read-only: the API call and the licence rule shared by find-photos.mjs (the
// candidates) and make-images.mjs (fetching a `photo:` entry). Only CC0 and public domain pass, and
// only without restrictions (personality rights, trademarks, insignia), so nothing visible is owed.

export const UA = "SmithableImages/0.1 (https://github.com/smithable/smithable-images; johan@smithable.ai)";
const API = "https://commons.wikimedia.org/w/api.php";

export async function commonsQuery(params) {
  const url = `${API}?${new URLSearchParams({ action: "query", format: "json", formatversion: "1", ...params })}`;
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`Commons answered ${res.status}`);
  return res.json();
}

const plain = (html) => (html ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/** The file's licence from its extmetadata: ok only for CC0 or public domain with no restrictions. */
export function commonsLicence(meta = {}) {
  const value = (k) => plain(meta[k]?.value);
  const code = value("License").toLowerCase(); // "cc0", "pd", "cc-by-sa-4.0", …
  const name = value("LicenseShortName") || code;
  const author = value("Artist") || value("Credit") || "unknown";
  const restricted = value("Restrictions") !== "";
  const free = code === "cc0" || code === "pd" || /^public domain$/i.test(name) || /^cc0/i.test(name);
  return { ok: free && !restricted, name, author, restricted, url: value("LicenseUrl") };
}

/** One file's page, URL (scaled by Commons to `width` when given), size and licence, from its
 * Commons page URL or "File:…" title. */
export async function commonsFile(page, width) {
  const title = decodeURIComponent(page.replace(/^https?:\/\/commons\.wikimedia\.org\/wiki\//, "")).replace(/_/g, " ");
  const json = await commonsQuery({ titles: title, prop: "imageinfo", iiprop: "url|size|extmetadata", ...(width ? { iiurlwidth: String(width) } : {}) });
  const info = Object.values(json.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info) throw new Error(`no such file on Commons: ${title}`);
  return { page: info.descriptionurl, url: (width && info.thumburl) || info.url, width: info.width, height: info.height, licence: commonsLicence(info.extmetadata) };
}
