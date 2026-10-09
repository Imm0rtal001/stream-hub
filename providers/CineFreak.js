const cheerio = require("cheerio");
const PROVIDER = "CineFreak";
const BASE_URL = "https://cinefreak.ch";
const TMDB_API = "https://api.themoviedb.org/3";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    "Cookie": "xla=s4t",
};

function getSettings() {
    return {
        res2160: SCRAPER_SETTINGS.res2160 !== false,
        res1080: SCRAPER_SETTINGS.res1080 !== false,
        srcFSL: SCRAPER_SETTINGS.srcFSL !== false,
        srcR2: SCRAPER_SETTINGS.srcR2 !== false,
        srcWorker: SCRAPER_SETTINGS.srcWorker !== false,
        maxPerSource: parseInt(SCRAPER_SETTINGS.maxPerSource, 10) || 3,
        maxPerResolution: parseInt(SCRAPER_SETTINGS.maxPerResolution, 10) || 2,
    };
}

async function fetchHtml(url, extra) {
    try {
        const res = await fetch(url, { headers: Object.assign({}, HEADERS, extra) });
        return res.ok ? await res.text() : null;
    } catch { return null; }
}

async function fetchJson(url, extra) {
    try {
        const res = await fetch(url, { headers: Object.assign({}, HEADERS, extra) });
        return res.ok ? await res.json() : null;
    } catch { return null; }
}

function originOf(url) {
    try { const u = new URL(url); return u.protocol + "//" + u.host; } catch { return ""; }
}

function absUrl(base, path) {
    try { return new URL(path, base).toString(); } catch { return String(path || ""); }
}

function stripTags(s) {
    return String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function decodeBase64Url(str) {
    try {
        let s = String(str).replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
        while (s.length % 4) s += "=";
        return atob(s);
    } catch { return null; }
}

function streamLabel(url) {
    if (/cinecloud/i.test(url)) return "CineCloud";
    if (/\.r2\./i.test(url)) return "R2";
    if (/worker/i.test(url)) return "Worker";
    return null;
}

function toQualityLabel(raw) {
    const text = String(raw || "");
    const all = text.match(/(\d{3,4})p/gi);
    let n = 0;
    if (all && all.length) n = parseInt(all[all.length - 1], 10);
    else if (/\b(4k|ds4k|uhd)\b/i.test(text)) n = 2160;
    if (!n) return "Unknown";
    if (n >= 2160) return "2160p";
    if (n >= 1080) return "1080p";
    if (n >= 720) return "720p";
    if (n >= 480) return "480p";
    return "Unknown";
}

function isHighQuality(quality) {
    const cfg = getSettings();
    if (quality === "2160p") return cfg.res2160;
    if (quality === "1080p") return cfg.res1080;
    return false;
}

function buildSizeLabel(releaseTitle, fileSize, quality) {
    const t = String(releaseTitle || "");

    const line1Parts = [];
    if (quality) line1Parts.push(quality);
    if (fileSize && fileSize !== "Unknown") line1Parts.push(fileSize);

    const line2Parts = [];

    const src = /bluray|blu\-ray|bdrip/i.test(t) ? "Blu-ray"
        : /hdrip|webrip/i.test(t) ? "WEBRip"
            : /web\-?dl/i.test(t) ? "WEB-DL"
                : "";
    if (src) line2Parts.push(src);

    if (/imax/i.test(t)) line2Parts.push("IMAX");

    let audio = "";
    const am = t.match(/(TrueHD\s*7\.1|DDP\s*7\.1|DDP\s*5\.1|DD\s*5\.1|5\.1|AAC)/i);
    if (am) {
        audio = am[1].toUpperCase().replace(/\s+/g, "");
        if (audio === "5.1") audio = "DDP5.1";
        if (audio.includes("TRUEHD")) audio = "TrueHD 7.1";
    } else if (/dolby\s*digital/i.test(t)) {
        audio = "Dolby Digital";
    }
    if (/atmos/i.test(t)) audio = audio ? `${audio} • Atmos` : "Atmos";
    if (audio) line2Parts.push(audio);

    const range = /dolby\s*vision|dovi/i.test(t) ? "Dolby Vision"
        : /hdr10/i.test(t) ? "HDR10"
            : /hdr/i.test(t) ? "HDR"
                : /10bit|10\-bit/i.test(t) ? "10-Bit"
                    : /\bsdr\b/i.test(t) ? "SDR"
                        : "";
    if (range) line2Parts.push(range);

    const codec = /hevc|x265|h\.?265/i.test(t) ? "H.265"
        : /x264|h\.?264/i.test(t) ? "H.264"
            : "";
    if (codec) line2Parts.push(codec);

    return [line1Parts.join(" • "), line2Parts.join(" • ")].filter(Boolean).join("\n");
}

function dedupeByUrl(streams) {
    const seen = new Set();
    return streams.filter(s => s.url && !seen.has(s.url) && seen.add(s.url));
}

function resWeight(q) {
    if (q >= 2160) return 5;
    if (q >= 1440) return 4;
    if (q >= 1080) return 3;
    if (q >= 720) return 2;
    if (q >= 480) return 1;
    return 0;
}

function getSortTag(rank, maxRank) {
    let inv = Math.max(0, maxRank - rank);
    let bin = inv.toString(2);
    while (bin.length < 20) bin = "0" + bin;
    return bin.split("").map(b => b === "1" ? "\uFEFF" : "\u200B").join("");
}

function makeStream(src, label, url, qualLabel, qualNum, quality, referer) {
    return {
        url,
        name: `${PROVIDER} • ${label}`,
        title: `${PROVIDER} • ${label}` + (qualLabel ? "\n" + qualLabel : ""),
        quality,
        qualNum,
        src,
        headers: { Referer: referer },
    };
}

function makeStreamFromUrl(url, fallbackSrc, fallbackLabel, qualLabel, qualNum, quality, referer) {
    const label = streamLabel(url) || fallbackLabel;
    const src = streamLabel(url) || fallbackSrc;
    return makeStream(src, label, url, qualLabel, qualNum, quality, referer);
}

async function tmdbLookup(tmdbId, mediaType) {
    const ep = mediaType === "tv" ? "tv" : "movie";
    const data = await fetchJson(`${TMDB_API}/${ep}/${tmdbId}?api_key=${TMDB_API_KEY}`);
    if (!data) return null;
    const isTv = mediaType === "tv";
    return {
        title: (isTv ? data.name : data.title) || "",
        original: (isTv ? data.original_name : data.original_title) || "",
        year: String((isTv ? data.first_air_date : data.release_date) || "").slice(0, 4),
    };
}

async function searchCinefreak(query) {
    const data = await fetchJson(`${BASE_URL}/search-api.php?q=${encodeURIComponent(query)}`);
    if (Array.isArray(data)) return data;
    return (data && Array.isArray(data.results)) ? data.results : [];
}

function normName(s) {
    return String(s || "").toLowerCase()
        .replace(/\(.*?\)|\[.*?\]/g, " ")
        .replace(/&/g, " and ")
        .replace(/season\s*\d+/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function looksLikeTv(r) {
    return /season|series|episode|s0\d|full-series-download/i.test(String(r.t || r.title || "") + " " + String(r.l || ""));
}

function selectResult(results, tmdb, mediaType, season) {
    const wanted = [normName(tmdb.title), normName(tmdb.original)].filter(Boolean);
    if (!wanted.length) return null;

    let best = null;
    let bestScore = 0;

    for (const r of results) {
        const rawTitle = String(r.t || r.title || "");
        if (!rawTitle) continue;
        const isTv = looksLikeTv(r);
        if (mediaType === "tv" && !isTv) continue;
        if (mediaType === "movie" && isTv) continue;

        const rn = normName(rawTitle);
        if (!rn) continue;

        let score = 0;
        for (const w of wanted) {
            if (rn === w) score = Math.max(score, 3);
            else if ((" " + rn + " ").includes(" " + w + " ") || (" " + w + " ").includes(" " + rn + " ")) score = Math.max(score, 1);
        }
        if (!score) continue;

        if (mediaType === "movie" && tmdb.year && rawTitle.includes(tmdb.year)) score += 2;

        if (mediaType === "tv" && season != null) {
            const sm = /season\s*(\d+)/i.exec(rawTitle);
            if (sm) {
                if (parseInt(sm[1], 10) !== parseInt(season, 10)) continue;
                score += 2;
            }
        }

        if (score > bestScore) { best = r; bestScore = score; }
    }
    return best;
}

async function extractCineCloud(url, qualityHint) {
    const streams = [];
    try {
        const quality = toQualityLabel(qualityHint);
        if (!isHighQuality(quality)) return streams;

        const pageUrl = url.indexOf("/x/") !== -1 ? url.replace("/x/", "/f/") : url;
        const html = await fetchHtml(pageUrl);
        if (!html) return streams;

        const cfg = getSettings();
        const qualNum = parseInt(quality, 10) || 0;
        const $ = cheerio.load(html);

        let releaseTitle = "";
        const candidates = [
            $("h1").first().text(),
            $("h2").first().text(),
            $("title").text(),
            $(".file-name, .filename, .release-name, .movie-title").first().text(),
        ];
        for (const c of candidates) {
            const clean = c.trim();
            if (clean && /\d{3,4}p|bluray|webrip|web-?dl|x26[45]|hevc|aac|ddp/i.test(clean)) {
                releaseTitle = clean;
                break;
            }
        }

        let fileSize = "";
        $("tr").each((_, row) => {
            if (fileSize) return;
            const first = $(row).find("td").first();
            if (first.text().toLowerCase().includes("file size")) {
                const right = $(row).find("td.text-right");
                if (right.length) fileSize = right.last().text().trim();
            }
        });

        const qualLabel = buildSizeLabel(releaseTitle, fileSize, quality);
        const jobs = [];

        $("a[href]").each((_, el) => {
            const text = $(el).text().trim();
            const href = ($(el).attr("href") || "").trim();
            if (!href || href.charAt(0) === "#") return;
            const fullHref = absUrl(pageUrl, href);
            if (!/^https?:\/\//i.test(fullHref)) return;
            if (/terms-conditions|privacy-policy|abuse|facebook|t\.me/i.test(fullHref)) return;

            if (/fast\s+cloud|\[fsl\]/i.test(text)) {
                const lbl = streamLabel(fullHref) || "FSL";
                if (lbl === "CineCloud" || cfg.srcFSL) streams.push(makeStream(lbl, lbl, fullHref, qualLabel, qualNum, quality, pageUrl));
            } else if (/cloud\s*\[resumable\]/i.test(text)) {
                if (cfg.srcR2) jobs.push({ kind: "resume", href: fullHref });
            } else if (/instant\s*download/i.test(text) || /\/w\//i.test(fullHref)) {
                if (cfg.srcWorker) jobs.push({ kind: "instant", href: fullHref });
            }
        });

        const jobResults = await Promise.allSettled(jobs.map(async job => {
            const subHtml = await fetchHtml(job.href, { Referer: pageUrl });
            if (!subHtml) return [];
            const $2 = cheerio.load(subHtml);
            const out = [];
            if (job.kind === "resume") {
                $2("a.download-now[href]").each((_, el) => {
                    const link = ($2(el).attr("href") || "").trim();
                    if (link) out.push(makeStreamFromUrl(absUrl(job.href, link), "R2", "R2", qualLabel, qualNum, quality, pageUrl));
                });
            } else {
                let link = ($2("a.instant-download[href]").first().attr("href") || "").trim();
                if (!link) {
                    $2("a[href]").each((_, el) => {
                        if (link) return;
                        const h = ($2(el).attr("href") || "").trim();
                        if (/workers\.dev|download\.aspx|cloudflarestorage|\.r2\./i.test(h)) link = h;
                    });
                }
                if (link) out.push(makeStreamFromUrl(absUrl(job.href, link), "Worker", "Worker", qualLabel, qualNum, quality, pageUrl));
            }
            return out;
        }));

        for (const r of jobResults) {
            if (r.status === "fulfilled") for (const s of r.value) streams.push(s);
        }
    } catch { }
    return streams;
}

async function extractNeoDrive(url, qualityHint) {
    const streams = [];
    try {
        const html = await fetchHtml(url, { Referer: originOf(url) + "/" });
        if (!html) return streams;

        const $ = cheerio.load(html);
        let quality = toQualityLabel(qualityHint);
        if (quality === "Unknown") quality = toQualityLabel($("div.mb-8 h2").first().text() || $("h1").first().text());
        if (!isHighQuality(quality)) return streams;

        const cfg = getSettings();
        const qualNum = parseInt(quality, 10) || 0;
        const releaseTitle = $("div.mb-8 h2").first().text().trim() || $("h1").first().text().trim();
        const sm = html.match(/File Size[\s\S]*?<td\b[^>]*>([\s\S]*?)<\/td>/i);
        const fileSize = sm ? stripTags(sm[1]) : "";
        const qualLabel = buildSizeLabel(releaseTitle, fileSize, quality);

        const cloudLinks = [];
        $("a[href]").each((_, el) => {
            const text = $(el).text().trim();
            const href = absUrl(url, ($(el).attr("href") || "").trim());
            if (!/^https?:\/\//i.test(href)) return;
            if (/fsl/i.test(text)) {
                const lbl = streamLabel(href) || "FSL";
                if (lbl === "CineCloud" || cfg.srcFSL) streams.push(makeStream(lbl, lbl, href, qualLabel, qualNum, quality, url));
            } else if (/cloud download/i.test(text)) {
                if (cfg.srcR2) cloudLinks.push(href);
            }
        });

        const subs = await Promise.allSettled(cloudLinks.map(async href => {
            const subHtml = await fetchHtml(href, { Referer: originOf(url) + "/" });
            if (!subHtml) return [];
            const dm = subHtml.match(/const\s+downloadUrl\s*=\s*["']([^"']+)["']/i);
            if (!dm || !dm[1]) return [];
            return [makeStreamFromUrl(dm[1], "R2", "R2", qualLabel, qualNum, quality, url)];
        }));
        for (const r of subs) {
            if (r.status === "fulfilled") for (const s of r.value) streams.push(s);
        }
    } catch { }
    return streams;
}

function resolveTarget(target, qualityHint) {
    if (/neodrive/i.test(target)) return extractNeoDrive(target, qualityHint);
    if (/cinecloud/i.test(target)) return extractCineCloud(target, qualityHint);
    return Promise.resolve([]);
}

async function resolveGenerate(url, qualityHint, depth) {
    try {
        if (depth > 2) return [];
        const res = await fetch(url, { headers: Object.assign({}, HEADERS, { Referer: BASE_URL + "/" }) });
        const finalUrl = res.url || url;
        if (finalUrl !== url && /cinecloud|neodrive/i.test(finalUrl)) return resolveTarget(finalUrl, qualityHint);

        const body = res.ok ? await res.text() : "";
        if (!body) return [];

        const dm = body.match(/https?:\/\/[a-z0-9.-]*(?:cinecloud|neodrive)[a-z0-9.\/_-]*/i);
        if (dm) return resolveTarget(dm[0], qualityHint);

        const lm = body.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
        if (lm) {
            const next = absUrl(url, lm[1].replace(/\\u0026/g, "&"));
            if (next && next !== url) return resolveLink(next, qualityHint, depth + 1);
        }
        return [];
    } catch { return []; }
}

async function resolveLink(href, qualityHint, depth) {
    depth = depth || 0;
    try {
        const abs = absUrl(BASE_URL + "/", href);
        const m = /[?&]id=([^&#]+)/.exec(abs);
        if (m) {
            let encoded = m[1];
            try { encoded = decodeURIComponent(encoded); } catch { }
            const decoded = decodeBase64Url(encoded);
            if (decoded && /^\s*https?:\/\//i.test(decoded)) {
                const target = decoded.split("newgo32")[0].trim();
                return resolveTarget(target, qualityHint);
            }
        }
        if (/generate\.php/i.test(abs)) return resolveGenerate(abs, qualityHint, depth);
        return resolveTarget(abs, qualityHint);
    } catch { return []; }
}

function collectGenerateLinks(fragment) {
    const links = [];
    const re = /<a\b[^>]*href=["']([^"']*generate\.php[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(fragment))) {
        const label = stripTags(m[2]);
        if (/zip/i.test(label)) continue;
        links.push({ href: m[1].replace(/&amp;/g, "&"), label });
    }
    return links;
}

function parseMovieLinks(html) {
    const re = /<h4\b[^>]*class=["'][^"']*movie-title[^"']*["'][^>]*>([\s\S]*?)<\/h4>/gi;
    const heads = [];
    let m;
    while ((m = re.exec(html))) heads.push({ label: stripTags(m[1]), index: m.index });

    const links = [];
    for (let i = 0; i < heads.length; i++) {
        const end = i + 1 < heads.length ? heads[i + 1].index : html.length;
        for (const l of collectGenerateLinks(html.slice(heads[i].index, end))) {
            links.push({ href: l.href, quality: heads[i].label + " " + l.label });
        }
    }
    return links;
}

function parseEpisodeLinks(html, season, episode) {
    const cardRe = /<div\b[^>]*class=["'](?:[^"']*\s)?ep-card(?:\s[^"']*)?["'][^>]*>/gi;
    const starts = [];
    let m;
    while ((m = cardRe.exec(html))) starts.push(m.index);
    if (!starts.length) return [];

    const exact = [];
    const ranged = [];

    for (let i = 0; i < starts.length; i++) {
        const block = html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : html.length);

        const sm = block.match(/season-number[^>]*>\s*S?0*(\d+)/i);
        if (sm && season != null && parseInt(sm[1], 10) !== parseInt(season, 10)) continue;

        let from = null, to = null;
        const bm = block.match(/episode-badge[^>]*>\s*(?:Episodes?\s*)?0*(\d+)(?:\s*-\s*0*(\d+))?/i);
        if (bm) {
            from = parseInt(bm[1], 10);
            to = bm[2] ? parseInt(bm[2], 10) : from;
        } else {
            const alt = block.match(/data-episode="(\d+)"/i) || block.match(/ep-num[^>]*>\s*(\d+)\s*</i) || block.match(/\bEpisode\s+(\d+)\b/i);
            if (alt) { from = to = parseInt(alt[1], 10); }
        }
        if (from == null || episode < from || episode > to) continue;

        const box = block.match(/<div\b[^>]*class=["'][^"']*quality-box[^"']*download-links[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
        const links = collectGenerateLinks(box ? box[1] : block).map(l => ({ href: l.href, quality: l.label }));
        if (!links.length) continue;

        (from === to ? exact : ranged).push(...links);
    }

    return exact.length ? exact : ranged;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (mediaType === "tv" && (season == null || episode == null)) return [];

        const tmdb = await tmdbLookup(tmdbId, mediaType);
        if (!tmdb || !tmdb.title) return [];

        const queries = [];
        if (mediaType === "tv") queries.push(`${tmdb.title} Season ${season}`);
        queries.push(tmdb.title);
        if (tmdb.original && tmdb.original !== tmdb.title) queries.push(tmdb.original);

        let match = null;
        for (const q of queries) {
            const results = await searchCinefreak(q);
            match = selectResult(results, tmdb, mediaType, season);
            if (match) break;
        }
        if (!match) return [];

        const slug = String(match.l || match.href || match.slug || "");
        if (!slug) return [];
        let pageUrl = /^https?:\/\//i.test(slug) ? slug : `${BASE_URL}/${slug.replace(/^\//, "")}`;
        if (!/\/$/.test(pageUrl)) pageUrl += "/";

        const html = await fetchHtml(pageUrl, { Referer: BASE_URL + "/" });
        if (!html) return [];

        const rawLinks = mediaType === "movie"
            ? parseMovieLinks(html)
            : parseEpisodeLinks(html, parseInt(season, 10), parseInt(episode, 10));

        if (!rawLinks.length) return [];

        const batches = await Promise.allSettled(
            rawLinks.map(({ quality, href }) => resolveLink(href, quality))
        );

        let streams = dedupeByUrl(
            batches
                .filter(r => r.status === "fulfilled")
                .flatMap(r => r.value)
        );

        const cfg = getSettings();
        streams = streams.filter(s => {
            if (s.src === "FSL") return cfg.srcFSL;
            if (s.src === "R2") return cfg.srcR2;
            if (s.src === "Worker") return cfg.srcWorker;
            if (s.src === "CineCloud") return true;
            return true;
        });

        streams.sort((a, b) => resWeight(b.qualNum) - resWeight(a.qualNum));

        const srcCounts = {};
        const resCounts = {};
        streams = streams.filter(s => {
            const resKey = s.qualNum >= 2160 ? "2160p" : "1080p";
            const sc = srcCounts[s.src] || 0;
            const rc = resCounts[resKey] || 0;
            if (sc < cfg.maxPerSource && rc < cfg.maxPerResolution) {
                srcCounts[s.src] = sc + 1;
                resCounts[resKey] = rc + 1;
                return true;
            }
            return false;
        });

        const total = streams.length;
        return streams.map((s, i) => {
            const tag = getSortTag(total - i, total + 1);
            const { qualNum, src, ...rest } = s;
            return { ...rest, name: tag + rest.name, title: tag + rest.title };
        });
    } catch { return []; }
}

async function onSettings() {
    const limitOptions = ["1", "2", "3", "4", "5"].map(v => ({ value: v, label: v }));
    return [
        { type: "header", label: "Resolutions" },
        { type: "toggle", key: "res2160", label: "2160p (4K)", defaultValue: true },
        { type: "toggle", key: "res1080", label: "1080p", defaultValue: true },
        { type: "header", label: "Sources" },
        { type: "toggle", key: "srcFSL", label: "FSL", defaultValue: true },
        { type: "toggle", key: "srcR2", label: "R2", defaultValue: true },
        { type: "toggle", key: "srcWorker", label: "Worker", defaultValue: true },
        { type: "header", label: "Limits" },
        { type: "select", key: "maxPerSource", label: "Max streams per source", defaultValue: "3", options: limitOptions },
        { type: "select", key: "maxPerResolution", label: "Max streams per resolution", defaultValue: "2", options: limitOptions },
    ];
}

module.exports = { getStreams, onSettings };
