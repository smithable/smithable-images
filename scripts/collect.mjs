import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { commonsLicence, commonsQuery, UA, isCommonsPage } from './commons.mjs';
import { fileURLToPath } from 'node:url';
import { LICENCE_CHANGE, PER_SUBJECT, SEARCHES_A_NIGHT, THRESHOLD_ID, CUTOFF, pixabaySearch, refusal, uploadDate, wayback } from './pixabay.mjs';

const MAX_BYTES = 50 * 1024 * 1024;
// Never from these through Commons or Openverse: a copy's licence there is someone's word. Pixabay's
// own pictures come only from its API, with their date evidence (pixabay.mjs).
const BARRED = /unsplash|pexels|pixabay/i;

// A subject's words, each in the file's title: a word only in a long description brought drawings,
// plaques and houses. Commons' own search stems them; Openverse's answers are checked by titleFits.
const subjectWords = (subject) => subject.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export const commonsTerms = (subject) => `${subjectWords(subject).map((w) => `intitle:${w}`).join(" ")} -unsplash -pexels -pixabay`;
export const titleFits = (subject, title) => subjectWords(subject).every((w) => (title ?? "").toLowerCase().includes(w));

export async function collect({ misses, subjects: subjectsFile, out, max = 50, perSubject = 12, wait = 3000, dryRun = false, fetchFn = globalThis.fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), commonsSearch = null, pixabayKey = undefined }) {
    // Pixabay only with a key; without one it is not a source tonight, not a failure.
    const sources = ['openverse', 'commons', ...(pixabayKey ? ['pixabay'] : [])];
    let pixabaySearches = 0;
    const subjects = new Set();
    
    if (subjectsFile && existsSync(subjectsFile)) {
        const lines = readFileSync(subjectsFile, 'utf8').split('\n');
        for (const line of lines) {
            if (line.trim()) subjects.add(line.trim());
        }
    }
    
    if (misses && existsSync(misses)) {
        const lines = readFileSync(misses, 'utf8').split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            let data;
            try { data = JSON.parse(line); } catch (e) { continue; }
            if (data.hero && data.description) subjects.add(data.description);
            if (data.models && Array.isArray(data.models)) {
                for (const model of data.models) {
                    const split = model.replace(/([A-Z])/g, ' $1').trim().toLowerCase().replace(/\s+/g, ' ');
                    if (split) subjects.add(split);
                }
            }
        }
    }
    
    mkdirSync(out, { recursive: true });
    
    const stateFile = join(out, 'state.json');
    let state = { seenUrls: [], searched: {} };
    if (existsSync(stateFile)) {
        try {
            state = JSON.parse(readFileSync(stateFile, 'utf8'));
            if (!state.searched) state.searched = {};
            if (!state.seenUrls) state.seenUrls = [];
        } catch (e) {}
    }
    const seen = new Set(state.seenUrls);
    
    let lastReq = 0;
    const waitObj = {
        wait: async () => {
            const now = Date.now();
            if (now - lastReq < wait) {
                await sleep(wait - (now - lastReq));
            }
            lastReq = Date.now();
        }
    };
    
    async function rateLimitedFetch(url, options = {}) {
        await waitObj.wait();
        return fetchFn(url, { signal: AbortSignal.timeout(60000), ...options, headers: { "user-agent": UA, ...(options.headers || {}) } });
    }
    
    if (!commonsSearch) {
        commonsSearch = async (querySubject) => {
            const search = `${commonsTerms(querySubject)} haswbstatement:P275=Q6938433|P6216=Q19652 filetype:bitmap -"MET" -museum`;
            const params = {
                generator: "search",
                gsrsearch: search,
                gsrnamespace: "6",
                gsrlimit: "50",
                prop: "imageinfo",
                iiprop: "url|size|extmetadata",
                iiurlwidth: "1600",
            };
            await waitObj.wait();
            return commonsQuery(params);
        };
    }
    
    let saved = 0;
    let skipped = 0;
    let failed = 0;
    const stoppedSources = new Set();
    // A picture's host is not the source that named it: one that says stop stops only itself.
    const stoppedHosts = new Set();
    let subjectsSearched = 0;
    
    for (const subject of subjects) {
        if (saved >= max) break;
        if (sources.every((s) => state.searched[subject]?.includes(s))) continue;
        subjectsSearched++;
        // Enough of one subject leaves the night's cap to the others.
        let subjectSaved = 0;
        
        for (const source of sources) {
            if (saved >= max) break;
            if (stoppedSources.has(source)) continue;
            if (state.searched[subject]?.includes(source)) continue;
            // Not marked searched: the subject's turn comes another night.
            if (source === 'pixabay' && pixabaySearches >= SEARCHES_A_NIGHT) continue;
            if (subjectSaved >= perSubject) {
                state.searched[subject] = [...(state.searched[subject] ?? []), source];
                continue;
            }
            
            let results = [];
            try {
                if (source === 'openverse') {
                    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(subject)}&license=cc0&page_size=20`;
                    const res = await rateLimitedFetch(url);
                    if (!res.ok) {
                        if (res.status === 429 || res.status >= 500) throw new Error(`stop ${res.status}`);
                        continue;
                    }
                    const data = await res.json();
                    for (const r of data.results || []) {
                        if ((r.license || "").toLowerCase() !== "cc0") continue;
                        // Never these, whatever licence a search reports (their own terms are not CC0).
                        if (BARRED.test(`${r.source} ${r.foreign_landing_url} ${r.url} ${r.title} ${r.creator}`) || !isCommonsPage(r.foreign_landing_url)) continue;
                        if (!titleFits(subject, r.title)) continue;
                        results.push({
                            id: String(r.id),
                            source: 'openverse',
                            via: r.source,
                            pageUrl: r.foreign_landing_url,
                            imageUrl: r.url,
                            author: r.creator,
                            licence: [r.license, r.license_version].filter(Boolean).join(' '),
                            width: r.width,
                            height: r.height,
                            query: subject
                        });
                    }
                } else if (source === 'pixabay') {
                    pixabaySearches++;
                    for (const h of await pixabaySearch(subject, pixabayKey, rateLimitedFetch)) {
                        if (refusal(h)) continue;
                        // The 1280 px copy is what the API gives without full access; its size, not the original's.
                        const long = Math.max(h.imageWidth, h.imageHeight);
                        const scale = long > 1280 ? 1280 / long : 1;
                        results.push({
                            id: String(h.id),
                            source: 'pixabay',
                            pageUrl: h.pageURL,
                            imageUrl: h.largeImageURL,
                            author: h.user,
                            licence: `CC0 1.0: published on Pixabay before ${LICENCE_CHANGE} (uploaded ${uploadDate(h.previewURL)})`,
                            width: Math.round(h.imageWidth * scale),
                            height: Math.round(h.imageHeight * scale),
                            query: subject,
                            evidence: {
                                pixabayId: h.id,
                                uploaded: uploadDate(h.previewURL),
                                uploadedFrom: new URL(h.previewURL).pathname,
                                rule: `uploaded before ${CUTOFF} and id at most ${THRESHOLD_ID} (the licence changed ${LICENCE_CHANGE})`,
                                tags: h.tags,
                            },
                        });
                    }
                } else {
                    const json = await commonsSearch(subject);
                    const pages = Object.values(json?.query?.pages ?? {}).sort((a, b) => (a.index || 0) - (b.index || 0));
                    for (const p of pages) {
                        const info = p.imageinfo?.[0];
                        if (!info) continue;
                        const licence = commonsLicence(info.extmetadata);
                        if (!licence.ok) continue;
                        // Commons holds copies from these sites too: the title or the credit says so.
                        const says = ["Credit", "Artist", "ImageDescription"].map((k) => info.extmetadata?.[k]?.value ?? "").join(" ");
                        if (BARRED.test(`${p.title} ${info.descriptionurl} ${says}`)) continue;
                        results.push({
                            id: String(p.pageid || p.title.replace(/\s+/g, '_')),
                            source: 'commons',
                            pageUrl: info.descriptionurl,
                            imageUrl: info.thumburl || info.url,
                            author: licence.author,
                            licence: licence.name,
                            width: info.width,
                            height: info.height,
                            query: subject
                        });
                    }
                }
            } catch (e) {
                if (/(429|5\d\d)/.test(e.message) || /stop/.test(e.message)) {
                    stoppedSources.add(source);
                } else {
                    failed++;
                }
                continue;
            }
            
            let capReached = false;
            for (const c of results) {
                if (saved >= max) {
                    capReached = true;
                    break;
                }
                if (subjectSaved >= perSubject) break;
                // Downloads tried, not only kept: a few of a subject, never more.
                if (c.source === 'pixabay' && results.filter((r) => r.tried).length >= PER_SUBJECT) break;
                if (c.width === undefined || c.height === undefined || c.width === null || c.height === null || Math.max(c.width, c.height) < 1280) {
                    skipped++;
                    continue;
                }
                if (!/^https:/.test(c.imageUrl ?? '') || seen.has(c.pageUrl) || seen.has(c.imageUrl)) {
                    skipped++;
                    continue;
                }
                
                if (dryRun) {
                    seen.add(c.pageUrl);
                    seen.add(c.imageUrl);
                    saved++;
                    subjectSaved++;
                    c.tried = true;
                    continue;
                }
                
                c.tried = true;
                const host = new URL(c.imageUrl).host;
                if (stoppedHosts.has(host)) {
                    skipped++;
                    continue;
                }
                let imgRes;
                try {
                    imgRes = await rateLimitedFetch(c.imageUrl);
                    if (!imgRes.ok) {
                        if (imgRes.status === 429 || imgRes.status >= 500) stoppedHosts.add(host);
                        throw new Error(`status ${imgRes.status}`);
                    }
                    if (Number(imgRes.headers.get('content-length')) > MAX_BYTES) {
                        skipped++;
                        continue;
                    }
                } catch (e) {
                    failed++;
                    continue;
                }
                
                try {
                    const buf = await imgRes.arrayBuffer();
                    // A photograph, not an SVG or an animation: sharp reads more than the library wants.
                    const { format } = await sharp(Buffer.from(buf)).metadata();
                    if (!['jpeg', 'png', 'webp', 'tiff'].includes(format)) {
                        skipped++;
                        continue;
                    }
                    // A description can be long; a name of a folder cannot.
                    const slug = subject.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60).replace(/-$/, '') || 'subject';
                    const name = `${c.source}-${c.id.replace(/[^\w.-]/g, '_')}`;
                    const dir = join(out, slug);
                    mkdirSync(dir, { recursive: true });
                    
                    await sharp(Buffer.from(buf))
                        .rotate()
                        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toFile(join(dir, `${name}.webp`));
                        
                    if (c.source === 'pixabay') c.evidence.wayback = await wayback(c.pageUrl, rateLimitedFetch);
                    const prov = {
                        source: c.source,
                        ...(c.via ? { via: c.via } : {}),
                        pageUrl: c.pageUrl,
                        imageUrl: c.imageUrl,
                        author: c.author,
                        licence: c.licence,
                        width: c.width,
                        height: c.height,
                        query: c.query,
                        ...(c.evidence ? { evidence: c.evidence } : {}),
                        subject: subject,
                        collectedAt: new Date().toISOString()
                    };
                    writeFileSync(join(dir, `${name}.json`), JSON.stringify(prov, null, 2));
                    
                    seen.add(c.pageUrl);
                    seen.add(c.imageUrl);
                    saved++;
                    subjectSaved++;
                } catch (e) {
                    failed++;
                }
            }
            
            if (capReached) {
                break;
            }
            
            if (!stoppedSources.has(source)) {
                state.searched[subject] = state.searched[subject] || [];
                if (!state.searched[subject].includes(source)) {
                    state.searched[subject].push(source);
                }
            }
        }
        
        if (!dryRun) {
            state.seenUrls = Array.from(seen);
            const tmp = join(out, 'state.json.tmp');
            writeFileSync(tmp, JSON.stringify(state));
            renameSync(tmp, join(out, 'state.json'));
        }
    }
    
    console.log(`subjects searched: ${subjectsSearched}, saved: ${saved}, skipped: ${skipped}, failed: ${failed}, stopped sources: ${Array.from(stoppedSources).join(',') || 'none'}`);
}

if (typeof process !== 'undefined' && process.argv && process.argv[1] === fileURLToPath(import.meta.url)) {
    const { values } = parseArgs({
        options: {
            misses: { type: "string" },
            subjects: { type: "string" },
            out: { type: "string" },
            max: { type: "string", default: "50" },
            wait: { type: "string", default: "3000" },
            "dry-run": { type: "boolean" },
        }
    });
    
    if (!values.out) {
        console.error("Usage: node scripts/collect.mjs --misses <file> --subjects <file> --out <review-dir> [--max 50] [--wait 3000] [--dry-run]");
        process.exit(1);
    }
    
    const max = Number(values.max);
    const wait = Number(values.wait);
    if (!Number.isInteger(max) || max < 1 || !Number.isFinite(wait) || wait < 1000) {
        console.error("--max is a whole number of pictures, --wait at least 1000 milliseconds");
        process.exit(1);
    }
    await collect({
        pixabayKey: process.env.PIXABAY_API_KEY || undefined,
        misses: values.misses,
        subjects: values.subjects,
        out: values.out,
        max,
        wait,
        dryRun: values["dry-run"]
    });
}
