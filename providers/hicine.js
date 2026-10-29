const API_BASE = "https://api.hicine.sbs";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

// Every stage logs here; StreamHub shows these lines on the Test tab (Provider logs).
const dbg = (...a) => console.log("[hicine]", ...a);
const dbgWarn = (...a) => console.warn("[hicine]", ...a);
const shortUrl = (u) => String(u || "").replace(/^https?:\/\//, "").slice(0, 90);

const MAX_1080P = 4;
let count1080p = 0;
const SERVER_NAMES = { fsl: "FSL", server1: "Server 1", fsl2: "FSL 2", pixel: "PixelDrain" };
const streamMeta = new WeakMap();

function getSortTag(rank) {
    const inv = 4 - Math.max(0, Math.min(4, rank));
    let bin = inv.toString(2);
    while (bin.length < 20) bin = "0" + bin;
    return bin.split("").map(b => b === "1" ? "\uFEFF" : "\u200B").join("");
}

async function fetchSafe(url, opts = {}) {
    let timer;
    try {
        const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), 15000); });
        return await Promise.race([
            fetch(url, {
                ...opts,
                headers: {
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                    ...(opts.headers || {})
                }
            }),
            timeout
        ]).then((r) => {
            if (r === null) dbgWarn(`timeout (15s) for ${shortUrl(url)}`);
            return r;
        });
    } catch (e) {
        dbgWarn(`request failed for ${shortUrl(url)}: ${e && e.message ? e.message : e}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

const fetchJson = async (url, opts = {}) => {
    try {
        const r = await fetchSafe(url, opts);
        if (!r) return null;
        if (!r.ok) { dbgWarn(`HTTP ${r.status} for ${shortUrl(url)}`); return null; }
        return await r.json();
    } catch (e) {
        dbgWarn(`bad JSON from ${shortUrl(url)}: ${e && e.message ? e.message : e}`);
        return null;
    }
};

function makeStream(title, url, quality, headers, fallbackQ = "HD", serverKey = "") {
    if (!url || !url.startsWith("https://")) return null;
    const nq = [quality, fallbackQ].find(q => ["2160p", "1440p", "1080p"].includes(q));
    if (!nq || (nq === "1080p" && count1080p >= MAX_1080P)) return null;

    const t = (title || "").replace(/[\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
    const sizeM = t.match(/\[\s*(\d+(?:\.\d+)?\s*[MG]B)\s*\]/i);
    const sizeStr = sizeM ? sizeM[1].trim() : null;
    const src = /bluray|blu\-ray|bdrip/i.test(t) ? "Blu-ray" : /hdrip|webrip/i.test(t) ? "WEBRip" : "WEB-DL";
    const imax = /imax/i.test(t) ? " • IMAX" : "";
    const range = /dolby\s*vision|dovi/i.test(t) ? "Dolby Vision" : /hdr10/i.test(t) ? "HDR10" : /hdr/i.test(t) ? "HDR" : /10bit|10\-bit/i.test(t) ? "10-Bit" : /sdr/i.test(t) ? "SDR" : "";
    const codec = /hevc|x265|h265/i.test(t) ? "H.265" : "H.264";

    let audio = "AAC";
    const am = t.match(/(TrueHD\s*7\.1|DDP\s*7\.1|DDP\s*5\.1|DD\s*5\.1|5\.1|AAC)/i);
    if (am) {
        audio = am[1].toUpperCase().replace(/\s+/g, "");
        if (audio === "5.1") audio = "DDP5.1";
        if (audio.includes("TRUEHD")) audio = "TrueHD 7.1";
    } else if (/dolby\s*digital|dd/i.test(t)) audio = "Dolby Digital";
    if (/atmos/i.test(t)) audio += " • Atmos";

    const langs = /dual|hindi\-eng|eng\-hin/i.test(t) ? "English • Hindi" : ([/english|eng/i.test(t) && "English", /hindi|hin/i.test(t) && "Hindi"].filter(Boolean).join(" • ") || "English");
    const lUrl = url.toLowerCase();
    const host = (lUrl.includes("hubcloud") || lUrl.includes("/hub2/") || lUrl.includes("homelander.buzz") || lUrl.includes("whistle.lat") || lUrl.includes("mandalorian.buzz")) ? "HubCloud" : (lUrl.includes(".r2.dev") || lUrl.includes("vcloud")) ? "vCloud" : lUrl.includes("pixeldrain") ? "PixelDrain" : "";

    if (nq === "1080p") count1080p++;

    const sortTag = getSortTag({ "2160p": 4, "1440p": 3, "1080p": 2 }[nq]);
    const serverName = SERVER_NAMES[serverKey] || "";
    const shortLabel = `Hicine • ${nq.toUpperCase()}${imax}${host ? " • " + host : ""}${serverName && serverName !== host ? " • " + serverName : ""}`;
    const detailLine1 = `${langs}${sizeStr ? " • " + sizeStr : ""}`;
    const detailLine2 = `${src} • ${audio}${range ? " • " + range : ""} • ${codec}`;

    const stream = {
        name: sortTag + shortLabel,
        title: sortTag + shortLabel,
        quality: nq + " \u2022 " + detailLine1 + "\n" + detailLine2,
        language: langs,
        url,
        headers: headers || {}
    };
    streamMeta.set(stream, { host: (host || shortLabel) + "|" + (serverKey || ""), size: sizeStr ? sizeStr.replace(/\s+/g, "").toUpperCase() : "" });
    return stream;
}

const dedupeBySize = streams => {
    const seen = new Set();
    return (streams || []).filter(x => {
        const m = x && streamMeta.get(x);
        if (!m || !m.size) return true;
        const k = m.host + "|" + m.size;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
};

const dedupe = streams => { const s = new Set(); return (streams || []).filter(x => x && x.url && !s.has(x.url) && s.add(x.url)); };

async function getTMDBInfo(tmdbId, mediaType) {
    const t = mediaType === "tv" ? "tv" : "movie";
    const d = await fetchJson(`${TMDB_API}/${t}/${tmdbId}?api_key=${TMDB_KEY}`);
    if (d) {
        return {
            title: t === "tv" ? d.name : d.title,
            year: (d.first_air_date || d.release_date || "").split("-")[0]
        };
    }
    dbgWarn("TMDB lookup failed; cannot search the site without a title");
    return { title: "", year: null };
}

const hiFetchJson = url => fetchJson(url, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json, text/plain, */*" } });

const hiQuality = text => {
    const m = String(text || "").match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i) || String(text || "").match(/\b4k\b/i);
    if (!m) return "";
    const q = m[1] ? m[1].toLowerCase() : "4k";
    return q === "4k" ? "2160p" : q;
};
const hiAllowedQ = q => q === "2160p" || q === "1080p";
const hiSize = text => { const m = String(text || "").match(/([\d.]+)\s*(GB|MB)/i); return m ? m[1] + m[2].toUpperCase() : ""; };
const hiLang = text => {
    const s = String(text || "").toLowerCase();
    return ["hindi", "punjabi", "urdu", "tamil", "telugu", "marathi", "kannada", "malayalam", "bengali", "gujarati", "english", "korean", "japanese", "chinese", "spanish", "arabic"].filter(l => s.includes(l)).join("-");
};
const hiLangLabel = lang => lang ? lang.split("-").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("-") : "";
const hiLangTier = lang => !lang ? 3 : lang.includes("hindi") ? 0 : (lang.includes("punjabi") || lang.includes("urdu")) ? 1 : lang.includes("english") ? 4 : 2;

function hiQueryParam(url, key) {
    const qi = url.indexOf("?");
    if (qi < 0) return null;
    for (const pair of url.slice(qi + 1).split("&")) {
        const kv = pair.split("=");
        if (decodeURIComponent(kv[0]) === key) return decodeURIComponent(kv.slice(1).join("="));
    }
    return null;
}

async function hiSearch(query) {
    const norm = t => String(t || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
    const words = query.toLowerCase().split(/[^a-z0-9]+/i).filter(w => w.length > 1);
    const fetchQ = async t => {
        const d = await hiFetchJson(`${API_BASE}/api/search/${encodeURIComponent(t)}`);
        return (d && Array.isArray(d.data)) ? d.data : (Array.isArray(d) ? d : []);
    };
    const items = await fetchQ(query);
    if (items.length < 3 && words.length > 1) {
        const variants = [words.join("-"), words.join(" ")];
        words.slice().sort((a, b) => b.length - a.length).slice(0, 2).forEach(w => { if (w.length > 2) variants.push(w); });
        const unique = variants.filter((v, i, a) => v !== query && a.indexOf(v) === i);
        const extra = await Promise.all(unique.map(fetchQ));
        for (const list of extra) for (const rec of list) {
            const t = norm(rec && (rec.title || rec.name));
            if (words.every(w => t.includes(norm(w)))) items.push(rec);
        }
    }
    return items;
}

async function hiFindId(title, year, mediaType) {
    if (!title) return null;
    const results = await hiSearch(title);
    dbg(`search "${title}": ${results.length} result(s)`);
    const wantSeries = mediaType === "tv";
    const normalize = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const normTitle = normalize(title);
    for (const rec of results) {
        if (!rec || !rec.record_id) continue;
        const recTitle = normalize(rec.title || rec.name || "");
        if (recTitle !== normTitle && !recTitle.includes(normTitle) && !normTitle.includes(recTitle)) continue;
        const cats = String(rec.categories || "").toLowerCase();
        const recIsMovie = !cats.includes("series") && !cats.includes("anime");
        if (!wantSeries && !recIsMovie) continue;
        if (wantSeries && recIsMovie) continue;
        const recYear = (String(rec.title || "").match(/\((19\d{2}|20\d{2})\)/) || [])[1] || String(rec.date || "").slice(0, 4);
        if (year && recYear && Math.abs(parseInt(recYear) - parseInt(year)) > 1) continue;
        dbg(`matched "${rec.title || rec.name}" id ${rec.record_id} (${rec.categories || "no categories"})`);
        return { id: rec.record_id, categories: rec.categories || "" };
    }
    dbgWarn(`no result matched "${title}" (${year || "no year"}, ${mediaType}); the API at ${shortUrl(API_BASE)} may have moved or changed`);
    return null;
}

function hiCollection(categories, mediaType) {
    const cats = String(categories || "").toLowerCase();
    if (cats.includes("bollywood") && cats.includes("series")) return "bollywood_series";
    if (cats.includes("bollywood")) return "bollywood_movies";
    if (cats.includes("anime")) return "anime";
    return mediaType === "tv" ? "hollywood_series" : "hollywood_movies";
}

async function hiPixelDirect(goUrl) {
    try {
        const r = await fetchSafe(goUrl, { headers: { "User-Agent": USER_AGENT, "Range": "bytes=0-0" } });
        if (!r) return null;
        const m = (r.url || "").match(/^https?:\/\/(pixeldrain\.[a-z]+)\/(?:u|api\/file)\/([A-Za-z0-9]+)/);
        return m ? `https://${m[1]}/api/file/${m[2]}` : null;
    } catch (e) { return null; }
}

async function hiResolveWorker(workerUrl, quality, size, lang) {
    const qi = workerUrl.indexOf("?");
    if (qi < 0) return [];
    const base = workerUrl.slice(0, qi).replace(/\/+$/, "");
    const vcloud = hiQueryParam(workerUrl, "vcloud");
    if (!vcloud) { dbgWarn(`link has no vcloud parameter: ${shortUrl(workerUrl)}`); return []; }
    const data = await hiFetchJson(`${base}/api/links?vcloud=${encodeURIComponent(vcloud)}`);
    const tokens = data && data.tokens;
    if (!tokens || !Object.keys(tokens).length) { dbgWarn(`worker ${shortUrl(base)} returned no download tokens`); return []; }

    const order = ["fsl", "server1", "fsl2", "pixel"];
    const keys = Object.keys(tokens).filter(k => order.includes(k)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const resolved = await Promise.all(keys.map(async k => {
        const tk = tokens[k] || {};
        if (!tk.ts || !tk.sig) return null;
        let finalUrl = `${base}/go?type=${encodeURIComponent(k)}&vcloud=${encodeURIComponent(vcloud)}&ts=${encodeURIComponent(tk.ts)}&sig=${encodeURIComponent(tk.sig)}`;
        if (k === "pixel") {
            const direct = await hiPixelDirect(finalUrl);
            if (!direct) return null;
            finalUrl = direct;
        }
        return { url: finalUrl, quality, size, lang, server: k };
    }));
    return resolved.filter(Boolean);
}

const hiResolveSafe = (u, q, s, l) => hiResolveWorker(u, q, s, l).catch((e) => { dbgWarn(`worker failed: ${e && e.message ? e.message : e}`); return []; });

function hiParseMovieLinks(field) {
    const out = [];
    String(field || "").split(/\r?\n/).forEach(line => {
        const m = line.match(/https?:\/\/[^\s,]+/);
        if (!m) return;
        const q = hiQuality(line) || "auto";
        if (q !== "auto" && !hiAllowedQ(q)) return;
        out.push({ workerUrl: m[0], quality: q, size: hiSize(line), lang: hiLang(line) });
    });
    return out;
}

function hiParseEpisodes(seasonText) {
    const out = [];
    const decoded = String(seasonText || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");
    decoded.split(/\r?\n/).forEach(line => {
        const m = line.match(/episode\s*(\d+)\s*[:\-]?\s*(.*)/i);
        if (!m) return;
        const rest = m[2] || "", variants = [];
        const re = /(https?:\/\/[^\s,]+?)\s*,\s*,?\s*([^:]*?)(?=\s*:|$)/g;
        let hit;
        while ((hit = re.exec(rest)) !== null) {
            const label = hit[2].trim(), q = hiQuality(label) || label || "auto";
            if (q !== "auto" && !hiAllowedQ(q)) continue;
            variants.push({ url: hit[1], quality: q });
        }
        if (!variants.length) (rest.match(/https?:\/\/[^\s,]+/g) || []).forEach(u => variants.push({ url: u, quality: "auto" }));
        if (variants.length) out.push({ num: parseInt(m[1], 10), variants });
    });
    return out;
}

async function getHicineStreams(title, year, mediaType, season, episode) {
    const match = await hiFindId(title, year, mediaType);
    if (!match) return [];
    const det = await hiFetchJson(`${API_BASE}/api/${hiCollection(match.categories, mediaType)}/${match.id}`);
    if (!det || det.error) { dbgWarn(`detail ${match.id} unavailable${det && det.error ? ": " + det.error : ""}`); return []; }

    const targets = [];
    if (mediaType === "tv") {
        const seasonText = det["season_" + season] || "";
        const ep = hiParseEpisodes(seasonText).find(e => e.num === Number(episode));
        if (!ep) { dbgWarn(`season ${season} episode ${episode} not listed (season text ${seasonText ? "present" : "missing"})`); return []; }
        const seasonLang = hiLang((seasonText.split(/\r?\n/)[0]) || "");
        ep.variants.forEach(v => targets.push({ workerUrl: v.url, quality: v.quality, size: "", lang: seasonLang }));
    } else {
        hiParseMovieLinks(det.links).forEach(l => targets.push(l));
    }
    dbg(`${targets.length} download link(s): ${targets.map((t) => t.quality).join(", ")}`);
    if (!targets.length) { dbgWarn("no 1080p/2160p links on this title"); return []; }

    const qRank = { "2160p": 5, "1080p": 3 };
    targets.sort((a, b) => (hiLangTier(a.lang || "") - hiLangTier(b.lang || "")) || ((qRank[b.quality] || 0) - (qRank[a.quality] || 0)));

    const results = new Array(targets.length);
    let cursor = 0;
    const runner = async () => {
        while (cursor < targets.length) {
            const idx = cursor++, t = targets[idx];
            results[idx] = await hiResolveSafe(t.workerUrl, t.quality, t.size, t.lang);
        }
    };
    await Promise.all(Array.from({ length: Math.min(2, targets.length) }, runner));

    const raws = dedupe(results.flat().filter(Boolean));
    dbg(`resolved ${raws.length} direct link(s) from ${targets.length} worker link(s)`);
    return dedupeBySize(raws.map(r => {
        const t = [hiLangLabel(r.lang), r.quality, r.size ? "[" + r.size + "]" : ""].filter(Boolean).join(" ");
        return makeStream(t, r.url, r.quality, { "User-Agent": USER_AGENT }, "HD", r.server);
    }).filter(Boolean));
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (!/^\d+$/.test(String(tmdbId))) return [];
        if (mediaType !== "tv" && mediaType !== "movie") return [];
        const isTv = mediaType === "tv";
        if (isTv && (season == null || episode == null)) { dbgWarn("series request without season/episode"); return []; }
        count1080p = 0;
        dbg(`start: tmdb ${tmdbId} ${mediaType}${isTv ? ` S${season}E${episode}` : ""}`);
        const { title, year } = await getTMDBInfo(tmdbId, mediaType);
        const out = await getHicineStreams(title, year, mediaType, isTv ? Number(season) : null, isTv ? Number(episode) : null);
        dbg(`done: ${out.length} stream(s)`);
        return out;
    } catch (e) {
        dbgWarn(`getStreams crashed: ${e && e.stack ? String(e.stack).split("\n").slice(0, 3).join(" | ") : e}`);
        return [];
    }
}

module.exports = { getStreams };
