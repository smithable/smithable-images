# Smithable images

Photographs and marks for Smithable's starters, sample data and picture picker. We generated every picture here with an image model (or made it by hand), so the whole repository, pictures and script, is dedicated to the public domain under [CC0 1.0](LICENSE): use them for anything, no attribution needed. No picture is taken from another site.

## What is here

- `manifest.yml`: one entry per picture: `id`, `kind`, a `prompt` or a `from` file, `alt` text and `tags`. The style appended to every prompt is in its `defaults`.
- `images/<kind>/`: the pictures as WebP, kept out of Git (they would bloat the history with every regeneration). They are served from `https://docs.smithable.ai/images/<kind>/<id>.webp` and attached to each release as `images-<date>.tar`. Heroes are 3:2 at up to 1600 px, samples 3:2 at 900 px, logos 512 px with transparency.
- `index.json`: what Smithable reads: id, url, alt, tags, size and bytes, plus orientation, tone (`light`, `mid`, `dark`), temperature (`warm`, `neutral`, `cool`) and the dominant color, computed from the picture.

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
SMITHABLE_DOCS_BUCKET=<bucket> node scripts/make-images.mjs --upload  # images/ to docs.smithable.ai, with the key in ~/.config/smithable/images.env if there is one
node scripts/make-images.mjs --tar                 # images-<date>.tar for a release
```

A rerun only makes what is missing; get the current pictures first from the latest release's tarball. Contact sheets are kept in `sheets/`. To replace a picture, change its prompt, delete its file and run with `--only <id>`. Batch ids are kept in `batches.json` until fetched.

Prompts ask for natural light, Nordic settings, one subject, no text, logos or brands, and people from behind or at a distance except in portraits. Write `alt` by hand: it is what screen readers say and what the picker searches.
