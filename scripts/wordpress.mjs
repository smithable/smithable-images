// The WordPress Photo Directory (wordpress.org/photos): every photo there is offered under CC0 1.0,
// and each photo's page says so itself in its structured data (schema.org ImageObject). A `wordpress:`
// entry names the photo by the id in its page address; make-images.mjs reads that page again when it
// fetches, and this reading refuses anything the page does not state plainly (Fable, T933, 2026-11-18).

export const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";
export const pageOf = (id) => `https://wordpress.org/photos/photo/${id}/`;
export const isPhotoId = (id) => typeof id === "string" && /^[0-9a-f]{10}$/.test(id);

/** What a photo page states, or why it is refused: { refused } or { image, author, licence, page }. */
export function readPhotoPage(html, id) {
  const page = pageOf(id);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (canonical !== page) return { refused: `the page is not ${page} (canonical ${canonical ?? "missing"})` };
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  const objects = blocks.flatMap((b) => {
    try {
      const data = JSON.parse(b[1]);
      return Array.isArray(data) ? data : [data];
    } catch {
      return [];
    }
  }).filter((d) => d?.["@type"] === "ImageObject");
  if (objects.length !== 1) return { refused: `the page has ${objects.length} image records, not one` };
  const [o] = objects;
  if (o.license !== CC0) return { refused: `the page's licence is ${o.license ?? "missing"}, not CC0 1.0` };
  let image;
  try {
    image = new URL(o.contentUrl);
  } catch {
    return { refused: "the page names no picture" };
  }
  if (image.protocol !== "https:" || image.hostname !== "pd.w.org") return { refused: `the picture is at ${image.hostname}, not pd.w.org` };
  const author = typeof o.creator?.name === "string" && o.creator.name.trim();
  if (!author) return { refused: "the page names no author" };
  return { image: image.href, author, licence: "CC0 1.0", page };
}
