# Smithable images

Photographs and marks for Smithable's starters, sample data and picture picker. Most pictures here we generated with an image model (or made by hand); some are real photographs that their authors dedicated to the public domain (CC0), on Wikimedia Commons or, before its licence changed, on Pixabay. The whole repository, pictures and scripts, is dedicated to the public domain under [CC0 1.0](LICENSE): use them for anything, no attribution needed. `credits.json` names each real photograph's source all the same.

## What is here

- `manifest.yml`: one entry per picture: `id`, `kind`, a `prompt`, a `from` file or a `photo` (its Wikimedia Commons page), `alt` text and `tags`, and for a hero or sample its `style` and `subject`. The text appended to every prompt is in its `defaults` (an entry may name another with `prompt-style`). Its `styles` list the picture styles (Photographs, Lifelike, Pastel, Ink wash): an id, whether an image model makes it, and a name and one line per language.
- **Styles and subjects.** A subject is what a picture shows, with an id of its own (`accounting-calculator`); the same subject exists at most once per style, so a style can dress an app by matching the subjects of the pictures it holds. A picture made by hand (`from:`) has no style, and marks are never part of one.
- `images/<kind>/`: the pictures as WebP, kept out of Git (they would bloat the history with every regeneration). They are served from `https://docs.smithable.ai/images/<kind>/<id>.webp` and attached to each release as `images-<date>.tar`. Heroes are 3:2 at up to 1600 px, samples 3:2 at 900 px, logos 512 px with transparency.
- `index.json`: what Smithable reads: id, url, alt, tags, size and bytes, plus orientation, tone (`light`, `mid`, `dark`), temperature (`warm`, `neutral`, `cool`) and the dominant color, computed from the picture; `generated` (true when an image model made it, so an app that places it shows the AI badge) and, on a real photograph, `credit`: its page, author, licence and the date it was fetched.
- `versions/<version>.json` and `latest.json`: the library in versions. A version (`2026-11-18.1`: the day, then a count) holds the styles and every entry, each with its `sha256` and a url naming the file by it (`images/files/<sha256>.webp`), so a version once published never changes; `--version` writes a new one when the library changed, and `--upload` does it too and puts up the files before the version and `latest.json` (`{ version, index }`, the one file that changes) last. `index.json` stays as it was for the CLI that reads it, with `style`, `subject` and `sha256` added.
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

`scripts/gaps.mjs` lists what the library lacks, worked out from `index.json` each time and written to `--out` or the screen, never into the library. First the starters' needs: each subject a starter shows (its `starter-` tags, and with `--starters <engine>/examples` the sample files its samples name) that a style has no picture of; an alternate (`<subject>-2` and on) counts for its subject. With `--needs <file>`, also the needs of a second file kept elsewhere: groups, each with a name, its pictures as needs (`slot`, `kind`, `subject` keys in order of preference, `people`, `target`), and optionally a `class` (`never` leaves the group out of the ranking) and a `count`. A need is met by a photographic landscape picture (`--styles`, Photographs and Lifelike by default) of its kind (a hero also serves a sample) and one of its subjects, tagged `people` or `person` exactly when people are wanted, one picture per subject; the needs still missing are ranked by how many groups have them, then by their counts, and each subject key the index lacks comes with the subjects that share a word with it, to check for a near miss before a new key is made.

**Replacing a picture.** Served pictures are cached for a year, so an id that has been uploaded (listed in `uploaded.json`) never gets a new picture. To replace a rejected one, give its manifest entry a new id (`hero-salon` → `hero-salon-b`) and a better prompt, run `--only hero-salon-b`, then `--upload`: the old id is no longer in the manifest, so its object is deleted from the bucket. The script refuses to regenerate an uploaded id. Commit `uploaded.json` after every upload. A picture never uploaded can simply be deleted and made again with `--only <id>`. Batch ids are kept in `batches.json` until fetched.

## Real photographs

Only CC0 or public domain, from Wikimedia Commons (whose volunteers review licences), Pixabay's pictures from before its licence changed, or the WordPress Photo Directory (whose every photo is CC0 1.0), never under a stock site's own licence (a CC0 mark on Flickr or another stock site is the uploader's own word, and copies of Pixabay's, Unsplash's or Pexels' pictures elsewhere are not taken). That holds on Commons too: a Commons file whose credit points to Unsplash, Flickr, Pixel.la, Pexels, Pixabay or another stock site is a copy, and `make-images.mjs` refuses it (`STOCK` in `commons.mjs`).

**WordPress Photo Directory.** wordpress.org/photos offers every photo under CC0 1.0, and each photo's page states it in its structured data (a schema.org ImageObject with the licence, the picture's address on pd.w.org and the author). An entry names the photo as `wordpress: "<id>"`, the ten hex digits of its page address. `make-images.mjs` reads that page again when it fetches, refuses it unless it names CC0 1.0, a picture on pd.w.org and an author (`wordpress.mjs`), records the page, author and fetch date as the credit and keeps what the page said as `evidence/wordpress/<id>.json`. The same looking-at rules hold as for the other sources (no recognisable person, mark or private property as the subject). Added on Fable's word, 2026-11-18 (T933).

**Pixabay.** Pixabay's terms (section 4) name content published before 9 January 2019 CC0; what came later is under its own licence and never taken. The API gives each picture's upload date (in its preview's path, `/photo/YYYY/MM/DD/…`), not the published date, and a picture can wait some days in review, so the rule keeps a fortnight's margin: uploaded before 2018-12-26 **and** an id at or below **3895010**, the last id uploaded on 2018-12-25. The ids grow with time; the threshold was found on 2026-11-08 by bisecting ids through the API's own id lookup (3895010 uploaded 2018-12-25, 3895049 on 2018-12-26; around the change itself 3922314 on 2019-01-08 and 3922357 on 2019-01-09). Beside every picture kept, its evidence: the Pixabay id, the date and the path it was read from, the rule it met, its tags, and a Wayback Machine snapshot of its page from before the change where one exists (most have none; the addresses asked are kept either way). The collector asks the API once per subject, ever, twenty subjects a night at most, and tries six pictures of a subject at most, as the API's terms ask (about 100 requests a minute at most, answers cached a day, no systematic mass downloads): a need, never a harvest. The sheet shows a Pixabay picture only while its evidence meets the rule, labelled as Pixabay's. A picked one goes in the manifest as `pixabay: <id>`; `make-images.mjs` (with `PIXABAY_API_KEY`) looks it up again by its id, refuses it unless the rule still holds on what the API says now, cuts it to 3:2 at the kind's size, and writes its evidence to `evidence/pixabay/<id>.json`, which its entry in `credits.json` names.

**People and brands.** CC0 waives the photographer's rights, not a pictured person's, a brand's or a building's, and Pixabay never asked for model releases. So no recognisable face, no logo or brand as the subject, from either source: the collector skips Pixabay pictures whose tags name people, the sheet's reading marks a recognisable person or a logo, and a person decides.

From Commons: `find-photos.mjs` searches Commons by its structured data and makes a numbered contact sheet; the file chosen goes in the manifest as `photo:`; `make-images.mjs` reads its licence again from its page, refuses anything but CC0 or public domain and any file with restrictions (personality rights, trademarks), cuts it to 3:2 at the kind's size and writes it without its metadata.

```sh
node scripts/find-photos.mjs "intitle:armchair" --out /tmp/armchair   # sheet.webp and candidates.json; --pd adds public domain
node scripts/make-images.mjs --index --only <id>                       # fetch a photo: entry and rewrite index.json
```

## Prompts

Prompts ask for natural light, Nordic settings, one subject, no text, logos or brands, and people from behind or at a distance except in portraits. Write `alt` by hand: it is what screen readers say and what the picker searches.

## Withdrawn

Pictures taken out of the library. They are gone from the index and from every version after their
withdrawal, so no new app gets them. Apps already made keep their copies, and the served files stay
in the bucket: `--upload` never deletes an id listed under `withdrawn:` in the manifest.

| Id | Reason | Withdrawn |
| - | - | - |
| market-table-chairs-p | a Commons copy of an Unsplash picture: its CC0 rests on that site's word | 2026-11-18 (T933) |
| market-laptop-p | a Commons copy of an Unsplash picture | 2026-11-18 (T933) |
| market-headphones-p | a Commons copy of an Unsplash picture | 2026-11-18 (T933) |
| market-rowboat-p | a Commons copy of a Flickr picture: its CC0 rests on the uploader's word | 2026-11-18 (T933) |
| pottery-p1 | a Commons copy of a Flickr picture | 2026-11-18 (T933) |
| vintage-camera-p3 | a Commons copy of a Flickr picture | 2026-11-18 (T933) |
| vintage-camera-p4 | a Commons copy of a Flickr picture | 2026-11-18 (T933) |

Two marketplace subjects (market-table-chairs, market-laptop) have no photograph until new picks
refill them (market-headphones was refilled by market-headphones-p2 on 2026-11-20), so the marketplace starter's Photographs set is incomplete
and not offered; after two daily batches without one, a marked AI filler takes the place.

On 2026-11-20 Pixabay photographs filled nine subjects that had none (T941): the marketplace hero,
the kiosk's coffee, bread, burger, cake, cheese, fish and soup, and the booking starter's coast run.
Each subject's best fit is its `-p` entry; the others are alternates (`<subject>-2` and on). Two are
tagged for what they really show: food-burger-3 has a bare belly behind the burger (`not-for-menus`),
and food-soup-4 is a table of shared dishes, not a soup (`not-soup`).

## Versions never published

`2026-11-18.5` was made and merged but never uploaded: it named eight Commons copies of stock-site
pictures that the library's rule does not take (T933). Its file is removed from `versions/`, and
`NEVER_PUBLISHED` in `scripts/upload-plan.mjs` keeps `--upload` from ever putting it, so the
published numbers have a gap there. `--upload` sends only the files of the entries in the version it
publishes; a picture lying in `images/` that no entry names (withdrawn, or taken out before
publishing) never goes up.
