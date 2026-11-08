# Smithable images

Photographs and marks for Smithable's starters, sample data and picture picker. Most pictures here we generated with an image model (or made by hand); some are real photographs that their authors dedicated to the public domain (CC0), on Wikimedia Commons or, before its licence changed, on Pixabay. The whole repository, pictures and scripts, is dedicated to the public domain under [CC0 1.0](LICENSE): use them for anything, no attribution needed. `credits.json` names each real photograph's source all the same.

## What is here

- `manifest.yml`: one entry per picture: `id`, `kind`, a `prompt`, a `from` file or a `photo` (its Wikimedia Commons page), `alt` text and `tags`. The style appended to every prompt is in its `defaults`.
- `images/<kind>/`: the pictures as WebP, kept out of Git (they would bloat the history with every regeneration). They are served from `https://docs.smithable.ai/images/<kind>/<id>.webp` and attached to each release as `images-<date>.tar`. Heroes are 3:2 at up to 1600 px, samples 3:2 at 900 px, logos 512 px with transparency.
- `index.json`: what Smithable reads: id, url, alt, tags, size and bytes, plus orientation, tone (`light`, `mid`, `dark`), temperature (`warm`, `neutral`, `cool`) and the dominant color, computed from the picture; `generated` (true when an image model made it, so an app that places it shows the AI badge) and, on a real photograph, `credit`: its page, author, licence and the date it was fetched.
- `credits.json`: the real photographs' sources, kept when they are fetched, so the index can be rebuilt without asking again.

`smithable new --describe` picks samples by matching a model's name and fields to tags, and heroes by the app's trade; the Look tab's picker searches the same index. A tag that matches nothing falls back to the group tag (`pets`, `furniture`, `food` …), then to a neutral set. Tags starting with `starter-` mark pictures a starter also ships a copy of.

## Making pictures

Node 24 and pnpm, then `pnpm install`. The OpenAI key is read from `OPENAI_API_KEY` or `~/.config/smithable/openai.env`.

```sh
node scripts/make-images.mjs --dry-run              # prompts and the estimated cost; nothing is sent
node scripts/make-images.mjs --index                # copy `from:` entries and rewrite index.json; nothing is sent
node scripts/make-images.mjs                        # make every missing picture, directly
node scripts/make-images.mjs --only dog-labrador    # one entry, or one kind (--only hero)
node scripts/make-images.mjs --batch submit         # the Batch API, half price, back within 24 h
node scripts/make-images.mjs --batch status
node scripts/make-images.mjs --batch fetch
node scripts/make-images.mjs --sheet [--out <dir>]  # a contact sheet per kind
SMITHABLE_DOCS_BUCKET=<bucket> SMITHABLE_DOCS_DISTRIBUTION=<id> node scripts/make-images.mjs --upload  # images/ and index.json to docs.smithable.ai, with the key in ~/.config/smithable/images.env if there is one
node scripts/make-images.mjs --tar                 # images-<date>.tar for a release
```

`scripts/collect.mjs` gathers CC0 candidates from Commons, and from Pixabay with `PIXABAY_API_KEY` set, slowly into a review folder, never the library (Openverse is only another way to find Commons' files); `scripts/review-sheet.mjs --review <dir> --out <dir>` then makes one numbered contact sheet per subject of the pictures not yet shown, with a pre-pick by plain rules and a small vision model (needs `ANTHROPIC_API_KEY`; `--no-vision` makes the sheets alone).

A rerun only makes what is missing; get the current pictures first from the latest release's tarball. Contact sheets are kept in `sheets/`.

**Replacing a picture.** Served pictures are cached for a year, so an id that has been uploaded (listed in `uploaded.json`) never gets a new picture. To replace a rejected one, give its manifest entry a new id (`hero-salon` → `hero-salon-b`) and a better prompt, run `--only hero-salon-b`, then `--upload`: the old id is no longer in the manifest, so its object is deleted from the bucket. The script refuses to regenerate an uploaded id. Commit `uploaded.json` after every upload. A picture never uploaded can simply be deleted and made again with `--only <id>`. Batch ids are kept in `batches.json` until fetched.

## Real photographs

Only CC0 or public domain, from Wikimedia Commons (whose volunteers review licences) or Pixabay's pictures from before its licence changed, never under a stock site's own licence (a CC0 mark on Flickr or another stock site is the uploader's own word, and copies of Pixabay's, Unsplash's or Pexels' pictures elsewhere are not taken).

**Pixabay.** Pixabay's terms (section 4) name content published before 9 January 2019 CC0; what came later is under its own licence and never taken. The API gives each picture's upload date (in its preview's path, `/photo/YYYY/MM/DD/…`), not the published date, and a picture can wait some days in review, so the rule keeps a fortnight's margin: uploaded before 2018-12-26 **and** an id at or below **3895010**, the last id uploaded on 2018-12-25. The ids grow with time; the threshold was found on 2026-11-08 by bisecting ids through the API's own id lookup (3895010 uploaded 2018-12-25, 3895049 on 2018-12-26; around the change itself 3922314 on 2019-01-08 and 3922357 on 2019-01-09). Beside every picture kept, its evidence: the Pixabay id, the date and the path it was read from, the rule it met, its tags, and a Wayback Machine snapshot of its page from before the change where one exists (most have none; the addresses asked are kept either way). The collector asks the API once per subject, ever, twenty subjects a night at most, and tries six pictures of a subject at most, as the API's terms ask (about 100 requests a minute at most, answers cached a day, no systematic mass downloads): a need, never a harvest. The sheet shows a Pixabay picture only while its evidence meets the rule, labelled as Pixabay's. A Pixabay pick does not enter the manifest yet: `make-images.mjs` learns it with the first one.

**People and brands.** CC0 waives the photographer's rights, not a pictured person's, a brand's or a building's, and Pixabay never asked for model releases. So no recognisable face, no logo or brand as the subject, from either source: the collector skips Pixabay pictures whose tags name people, the sheet's reading marks a recognisable person or a logo, and a person decides.

From Commons: `find-photos.mjs` searches Commons by its structured data and makes a numbered contact sheet; the file chosen goes in the manifest as `photo:`; `make-images.mjs` reads its licence again from its page, refuses anything but CC0 or public domain and any file with restrictions (personality rights, trademarks), cuts it to 3:2 at the kind's size and writes it without its metadata.

```sh
node scripts/find-photos.mjs "intitle:armchair" --out /tmp/armchair   # sheet.webp and candidates.json; --pd adds public domain
node scripts/make-images.mjs --index --only <id>                       # fetch a photo: entry and rewrite index.json
```

## Prompts

Prompts ask for natural light, Nordic settings, one subject, no text, logos or brands, and people from behind or at a distance except in portraits. Write `alt` by hand: it is what screen readers say and what the picker searches.
