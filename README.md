# Smithable images

Photographs and marks for Smithable's starters, sample data and picture picker. Most pictures here we generated with an image model (or made by hand); some are real photographs that their authors dedicated to the public domain (CC0) on Wikimedia Commons. The whole repository, pictures and scripts, is dedicated to the public domain under [CC0 1.0](LICENSE): use them for anything, no attribution needed. `credits.json` names each real photograph's source all the same.

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

A rerun only makes what is missing; get the current pictures first from the latest release's tarball. Contact sheets are kept in `sheets/`.

**Replacing a picture.** Served pictures are cached for a year, so an id that has been uploaded (listed in `uploaded.json`) never gets a new picture. To replace a rejected one, give its manifest entry a new id (`hero-salon` → `hero-salon-b`) and a better prompt, run `--only hero-salon-b`, then `--upload`: the old id is no longer in the manifest, so its object is deleted from the bucket. The script refuses to regenerate an uploaded id. Commit `uploaded.json` after every upload. A picture never uploaded can simply be deleted and made again with `--only <id>`. Batch ids are kept in `batches.json` until fetched.

## Real photographs

Only CC0 or public domain, only from Wikimedia Commons (whose volunteers review licences; a CC0 mark on Flickr or a stock site is the uploader's own word), never under a stock site's own licence. `find-photos.mjs` searches Commons by its structured data and makes a numbered contact sheet; the file chosen goes in the manifest as `photo:`; `make-images.mjs` reads its licence again from its page, refuses anything but CC0 or public domain and any file with restrictions (personality rights, trademarks), cuts it to 3:2 at the kind's size and writes it without its metadata.

```sh
node scripts/find-photos.mjs "intitle:armchair" --out /tmp/armchair   # sheet.webp and candidates.json; --pd adds public domain
node scripts/make-images.mjs --index --only <id>                       # fetch a photo: entry and rewrite index.json
```

## Prompts

Prompts ask for natural light, Nordic settings, one subject, no text, logos or brands, and people from behind or at a distance except in portraits. Write `alt` by hand: it is what screen readers say and what the picker searches.
