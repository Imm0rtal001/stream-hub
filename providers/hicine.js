const API_BASE = "https://api.hicine.biz";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const dbg = (...args) => console.log("[hicine]", ...args);
const dbgWarn = (...args) => console.warn("[hicine]", ...args);
const shortUrl = (url) => String(url || "").replace(/^https?:\/\//i, "").slice(0, 90);

const MAX_1080P = 4;
const SERVER_NAMES = { fsl: "FSL", server1: "Server 1", fsl2: "FSL 2", pixel: "PixelDrain" };
const streamMeta = new WeakMap();

function getSortTag(rank) {
    const inverse = 4 - Math.max(0, Math.min(4, rank));
    return inverse.toString(2).padStart(20, "0")
        .split("").map(bit => bit === "1" ? "\uFEFF" : "\u200B").join("");
}

async function fetchSafe(url, opts = {}) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 15000;
    const requestOptions = { ...opts };
    delete requestOptions.timeoutMs;

    let timer;
    try {
        const headers = {
            "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            ...(requestOptions.headers || {})
        };
        if (controller) requestOptions.signal = controller.signal;

        const request = fetch(url, { ...requestOptions, headers });
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                if (controller) controller.abort();
                reject(new Error(`request timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        return await Promise.race([request, timeout]);
    } catch (error) {
        dbgWarn(`request failed for ${shortUrl(url)}: ${error && error.message ? error.message : error}`);
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function fetchJson(url, opts = {}) {
    const response = await fetchSafe(url, opts);
    if (!response) return null;

    if (!response.ok) {
        dbgWarn(`HTTP ${response.status} for ${shortUrl(url)}`);
        return null;
    }

    try {
        return await response.json();
    } catch (error) {
        dbgWarn(`bad JSON from ${shortUrl(url)}: ${error && error.message ? error.message : error}`);
        return null;
    }
}

function makeStream(title, url, quality, headers, fallbackQuality = "HD", serverKey = "") {
    if (typeof url !== "string" || !/^https:\/\/\S+$/i.test(url)) return null;

    const normalizedQuality = [quality, fallbackQuality]
        .find(value => ["2160p", "1440p", "1080p"].includes(String(value || "").toLowerCase()));
    if (!normalizedQuality) return null;

    const text = String(title || "").replace(/[\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
    const sizeMatch = text.match(/\[\s*(\d+(?:\.\d+)?\s*[MG]B)\s*\]/i);
    const size = sizeMatch ? sizeMatch[1].trim() : null;
    const source = /bluray|blu-ray|bdrip/i.test(text) ? "Blu-ray" :
        /hdrip|webrip/i.test(text) ? "WEBRip" : "WEB-DL";
    const imax = /imax/i.test(text) ? " • IMAX" : "";
    const dynamicRange = /dolby\s*vision|dovi/i.test(text) ? "Dolby Vision" :
        /hdr10/i.test(text) ? "HDR10" : /hdr/i.test(text) ? "HDR" :
        /10bit|10-bit/i.test(text) ? "10-Bit" : /sdr/i.test(text) ? "SDR" : "";
    const codec = /hevc|x265|h265/i.test(text) ? "H.265" : "H.264";

    let audio = "AAC";
    const audioMatch = text.match(/(TrueHD\s*7\.1|DDP\s*7\.1|DDP\s*5\.1|DD\s*5\.1|5\.1|AAC)/i);
    if (audioMatch) {
        audio = audioMatch[1].toUpperCase().replace(/\s+/g, "");
        if (audio === "5.1") audio = "DDP5.1";
        if (audio.includes("TRUEHD")) audio = "TrueHD 7.1";
    } else if (/dolby\s*digital|\bdd\b/i.test(text)) {
        audio = "Dolby Digital";
    }
    if (/atmos/i.test(text)) audio += " • Atmos";

    const languages = /dual|hindi-eng|eng-hin/i.test(text) ? "English • Hindi" :
        ([/english|eng/i.test(text) && "English", /hindi|hin/i.test(text) && "Hindi"]
            .filter(Boolean).join(" • ") || "English");

    const lowerUrl = url.toLowerCase();
    const host = (lowerUrl.includes("hubcloud") || lowerUrl.includes("/hub2/") ||
        lowerUrl.includes("homelander.buzz") || lowerUrl.includes("whistle.lat") ||
        lowerUrl.includes("mandalorian.buzz")) ? "HubCloud" :
        (lowerUrl.includes(".r2.dev") || lowerUrl.includes("vcloud")) ? "vCloud" :
        lowerUrl.includes("pixeldrain") ? "PixelDrain" : "";

    const sortRank = { "2160p": 4, "1440p": 3, "1080p": 2 }[normalizedQuality];
    const sortTag = getSortTag(sortRank);
    const serverName = SERVER_NAMES[serverKey] || "";
    const shortLabel = `Hicine • ${normalizedQuality.toUpperCase()}${imax}${host ? " • " + host : ""}${serverName && serverName !== host ? " • " + serverName : ""}`;
    const detailLine1 = `${languages}${size ? " • " + size : ""}`;
    const detailLine2 = `${source} • ${audio}${dynamicRange ? " • " + dynamicRange : ""} • ${codec}`;

    const stream = {
        name: sortTag + shortLabel,
        title: sortTag + shortLabel,
        quality: `${normalizedQuality} • ${detailLine1}\n${detailLine2}`,
        language: languages,
        url,
        headers: headers || {}
    };

    streamMeta.set(stream, {
        host: `${host || shortLabel}|${serverKey || ""}`,
        size: size ? size.replace(/\s+/g, "").toUpperCase() : ""
    });
    return stream;
}

function dedupeBySize(streams) {
    const seen = new Set();
    return (streams || []).filter(stream => {
        const metadata = stream && streamMeta.get(stream);
        if (!metadata || !metadata.size) return true;
        const key = `${metadata.host}|${metadata.size}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function dedupe(streams) {
    const seen = new Set();
    return (streams || []).filter(stream => {
        if (!stream || !stream.url || seen.has(stream.url)) return false;
        seen.add(stream.url);
        return true;
    });
}

async function getTMDBInfo(tmdbId, mediaType) {
    const type = mediaType === "tv" ? "tv" : "movie";
    const data = await fetchJson(
        `${TMDB_API}/${type}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(TMDB_KEY)}`
    );

    if (!data) {
        dbgWarn("TMDB lookup failed; cannot search Hicine without a title");
        return { title: "", year: null };
    }

    return {
        title: type === "tv" ? data.name : data.title,
        year: (data.first_air_date || data.release_date || "").split("-")[0] || null
    };
}

const hiFetchJson = url => fetchJson(url, {
    headers: { "Accept": "application/json, text/plain, */*" }
});

function hiQuality(value) {
    const text = String(value || "");
    const match = text.match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i) || text.match(/\b4k\b/i);
    if (!match) return "";
    const quality = match[1] ? match[1].toLowerCase() : "4k";
    return quality === "4k" ? "2160p" : quality;
}

const hiAllowedQ = quality => quality === "2160p" || quality === "1080p";

function hiSize(value) {
    const match = String(value || "").match(/([\d.]+)\s*(GB|MB)/i);
    return match ? `${match[1]}${match[2].toUpperCase()}` : "";
}

function hiLang(value) {
    const text = String(value || "").toLowerCase();
    return ["hindi", "punjabi", "urdu", "tamil", "telugu", "marathi", "kannada",
        "malayalam", "bengali", "gujarati", "english", "korean", "japanese",
        "chinese", "spanish", "arabic"].filter(language => text.includes(language)).join("-");
}

const hiLangLabel = language => language ?
    language.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("-") : "";

const hiLangTier = language => !language ? 3 :
    language.includes("hindi") ? 0 :
    (language.includes("punjabi") || language.includes("urdu")) ? 1 :
    language.includes("english") ? 4 : 2;

function hiQueryParam(url, key) {
    try {
        return new URL(url).searchParams.get(key);
    } catch (_) {
        const queryIndex = String(url).indexOf("?");
        if (queryIndex < 0) return null;
        for (const pair of String(url).slice(queryIndex + 1).split("&")) {
            const parts = pair.split("=");
            try {
                if (decodeURIComponent(parts[0]) === key) return decodeURIComponent(parts.slice(1).join("="));
            } catch (_) {
                return null;
            }
        }
        return null;
    }
}

async function hiSearch(query) {
    const normalize = value => String(value || "").toLowerCase()
        .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
    const words = String(query || "").toLowerCase().split(/[^a-z0-9]+/i).filter(word => word.length > 1);

    const fetchQuery = async term => {
        const data = await hiFetchJson(`${API_BASE}/api/search/${encodeURIComponent(term)}`);
        return data && Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    };

    const items = await fetchQuery(query);
    if (items.length < 3 && words.length > 1) {
        const variants = [words.join("-"), words.join(" ")];
        words.slice().sort((a, b) => b.length - a.length).slice(0, 2)
            .forEach(word => { if (word.length > 2) variants.push(word); });

        const uniqueVariants = [...new Set(variants)].filter(variant => variant !== query);
        const extraResults = await Promise.all(uniqueVariants.map(fetchQuery));

        for (const list of extraResults) {
            for (const record of list) {
                const recordTitle = normalize(record && (record.title || record.name));
                if (words.every(word => recordTitle.includes(normalize(word)))) items.push(record);
            }
        }
    }
    return items;
}

async function hiFindId(title, year, mediaType) {
    if (!title) return null;

    const results = await hiSearch(title);
    dbg(`search "${title}": ${results.length} result(s)`);

    const wantSeries = mediaType === "tv";
    const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const normalizedTitle = normalize(title);

    for (const record of results) {
        if (!record || record.record_id == null) continue;

        const recordTitle = normalize(record.title || record.name || "");
        if (!recordTitle || (recordTitle !== normalizedTitle &&
            !recordTitle.includes(normalizedTitle) && !normalizedTitle.includes(recordTitle))) continue;

        const categories = String(record.categories || "").toLowerCase();
        const recordIsMovie = !categories.includes("series") && !categories.includes("anime");
        if (!wantSeries && !recordIsMovie) continue;
        if (wantSeries && recordIsMovie) continue;

        const recordYear = (String(record.title || "").match(/\((19\d{2}|20\d{2})\)/) || [])[1] ||
            String(record.date || "").slice(0, 4);

        if (year && recordYear && /^\d{4}$/.test(recordYear) &&
            Math.abs(Number(recordYear) - Number(year)) > 1) continue;

        dbg(`matched "${record.title || record.name}" id ${record.record_id} (${record.categories || "no categories"})`);
        return { id: record.record_id, categories: record.categories || "" };
    }

    dbgWarn(`no result matched "${title}" (${year || "no year"}, ${mediaType}); check whether the Hicine API has changed`);
    return null;
}

function hiCollection(categories, mediaType) {
    const value = String(categories || "").toLowerCase();
    if (value.includes("bollywood") && value.includes("series")) return "bollywood_series";
    if (value.includes("bollywood")) return "bollywood_movies";
    if (value.includes("anime")) return "anime";
    return mediaType === "tv" ? "hollywood_series" : "hollywood_movies";
}

async function hiPixelDirect(goUrl) {
    const response = await fetchSafe(goUrl, { headers: { Range: "bytes=0-0" } });
    if (!response) return null;

    const finalUrl = response.url || "";
    const match = finalUrl.match(/^https?:\/\/(pixeldrain\.[a-z]+)\/(?:u|api\/file)\/([A-Za-z0-9]+)/i);
    return match ? `https://${match[1]}/api/file/${match[2]}` : null;
}

async function hiResolveWorker(workerUrl, quality, size, language) {
    let parsed;
    try {
        parsed = new URL(workerUrl);
    } catch (_) {
        dbgWarn(`invalid worker URL: ${shortUrl(workerUrl)}`);
        return [];
    }

    const base = workerUrl.slice(0, workerUrl.indexOf("?")).replace(/\/+$/, "");
    const vcloud = parsed.searchParams.get("vcloud");
    if (!vcloud) {
        dbgWarn(`link has no vcloud parameter: ${shortUrl(workerUrl)}`);
        return [];
    }

    const data = await hiFetchJson(`${base}/api/links?vcloud=${encodeURIComponent(vcloud)}`);
    const tokens = data && data.tokens;
    if (!tokens || typeof tokens !== "object" || !Object.keys(tokens).length) {
        dbgWarn(`worker ${shortUrl(base)} returned no download tokens`);
        return [];
    }

    const order = ["fsl", "server1", "fsl2", "pixel"];
    const keys = Object.keys(tokens).filter(key => order.includes(key))
        .sort((a, b) => order.indexOf(a) - order.indexOf(b));

    const resolved = await Promise.all(keys.map(async key => {
        const token = tokens[key] || {};
        if (!token.ts || !token.sig) return null;

        let finalUrl = `${base}/go?type=${encodeURIComponent(key)}&vcloud=${encodeURIComponent(vcloud)}&ts=${encodeURIComponent(token.ts)}&sig=${encodeURIComponent(token.sig)}`;
        if (key === "pixel") {
            finalUrl = await hiPixelDirect(finalUrl);
            if (!finalUrl) {
                dbgWarn("PixelDrain redirect could not be resolved");
                return null;
            }
        }
        return { url: finalUrl, quality, size, lang: language, server: key };
    }));

    return resolved.filter(Boolean);
}

const hiResolveSafe = (url, quality, size, language) =>
    hiResolveWorker(url, quality, size, language).catch(error => {
        dbgWarn(`worker failed: ${error && error.message ? error.message : error}`);
        return [];
    });

function hiParseMovieLinks(field) {
    const output = [];
    String(field || "").split(/\r?\n/).forEach(line => {
        const match = line.match(/https?:\/\/[^\s,]+/i);
        if (!match) return;

        const quality = hiQuality(line) || "auto";
        if (quality !== "auto" && !hiAllowedQ(quality)) return;
        output.push({ workerUrl: match[0], quality, size: hiSize(line), lang: hiLang(line) });
    });
    return output;
}

function hiParseEpisodes(seasonText) {
    const output = [];
    const decoded = String(seasonText || "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");

    decoded.split(/\r?\n/).forEach(line => {
        const match = line.match(/episode\s*(\d+)\s*[:\-]?\s*(.*)/i);
        if (!match) return;

        const rest = match[2] || "";
        const variants = [];
        const expression = /(https?:\/\/[^\s,]+?)\s*,\s*,?\s*([^:]*?)(?=\s*:|$)/gi;
        let hit;

        while ((hit = expression.exec(rest)) !== null) {
            const label = hit[2].trim();
            const quality = hiQuality(label) || label || "auto";
            if (quality !== "auto" && !hiAllowedQ(quality)) continue;
            variants.push({ url: hit[1], quality });
        }

        if (!variants.length) {
            (rest.match(/https?:\/\/[^\s,]+/gi) || [])
                .forEach(url => variants.push({ url, quality: "auto" }));
        }
        if (variants.length) output.push({ num: Number(match[1]), variants });
    });
    return output;
}

async function getHicineStreams(title, year, mediaType, season, episode) {
    const match = await hiFindId(title, year, mediaType);
    if (!match) return [];

    const details = await hiFetchJson(
        `${API_BASE}/api/${hiCollection(match.categories, mediaType)}/${encodeURIComponent(match.id)}`
    );
    if (!details || details.error) {
        dbgWarn(`detail ${match.id} unavailable${details && details.error ? ": " + details.error : ""}`);
        return [];
    }

    const targets = [];
    if (mediaType === "tv") {
        const seasonText = details[`season_${season}`] || "";
        const selectedEpisode = hiParseEpisodes(seasonText).find(item => item.num === Number(episode));
        if (!selectedEpisode) {
            dbgWarn(`season ${season} episode ${episode} not listed (season text ${seasonText ? "present" : "missing"})`);
            return [];
        }

        const seasonLanguage = hiLang((seasonText.split(/\r?\n/)[0]) || "");
        selectedEpisode.variants.forEach(variant => targets.push({
            workerUrl: variant.url, quality: variant.quality, size: "", lang: seasonLanguage
        }));
    } else {
        hiParseMovieLinks(details.links).forEach(link => targets.push(link));
    }

    dbg(`${targets.length} download link(s): ${targets.map(target => target.quality).join(", ")}`);
    if (!targets.length) {
        dbgWarn("no eligible 1080p/2160p links found for this title");
        return [];
    }

    const qualityRank = { "2160p": 5, "1080p": 3 };
    targets.sort((a, b) =>
        (hiLangTier(a.lang || "") - hiLangTier(b.lang || "")) ||
        ((qualityRank[b.quality] || 0) - (qualityRank[a.quality] || 0))
    );

    const results = new Array(targets.length);
    let cursor = 0;
    const runner = async () => {
        while (cursor < targets.length) {
            const index = cursor++;
            const target = targets[index];
            results[index] = await hiResolveSafe(
                target.workerUrl, target.quality, target.size, target.lang
            );
        }
    };

    await Promise.all(Array.from({ length: Math.min(2, targets.length) }, runner));

    const rawStreams = dedupe(results.flat().filter(Boolean));
    dbg(`resolved ${rawStreams.length} direct link(s) from ${targets.length} worker link(s)`);

    // Apply the 1080p cap locally to this request, not through shared global state.
    let count1080p = 0;
    const streams = [];
    for (const raw of rawStreams) {
        const label = [hiLangLabel(raw.lang), raw.quality, raw.size ? `[${raw.size}]` : ""]
            .filter(Boolean).join(" ");
        const stream = makeStream(label, raw.url, raw.quality, {}, "HD", raw.server);
        if (!stream) continue;
        if (raw.quality === "1080p" && count1080p >= MAX_1080P) continue;
        if (raw.quality === "1080p") count1080p++;
        streams.push(stream);
    }
    return dedupeBySize(streams);
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (!/^\d+$/.test(String(tmdbId))) {
            dbgWarn("invalid TMDB id");
            return [];
        }
        if (mediaType !== "tv" && mediaType !== "movie") {
            dbgWarn(`unsupported media type: ${mediaType}`);
            return [];
        }

        const isTv = mediaType === "tv";
        if (isTv && (!Number.isInteger(Number(season)) || Number(season) < 0 ||
            !Number.isInteger(Number(episode)) || Number(episode) < 1)) {
            dbgWarn("series request has an invalid season or episode");
            return [];
        }

        dbg(`start: TMDB ${tmdbId} ${mediaType}${isTv ? ` S${season}E${episode}` : ""}`);
        const metadata = await getTMDBInfo(tmdbId, mediaType);
        if (!metadata.title) {
            dbgWarn("stopping: TMDB did not return a title");
            return [];
        }

        const streams = await getHicineStreams(
            metadata.title, metadata.year, mediaType,
            isTv ? Number(season) : null, isTv ? Number(episode) : null
        );
        dbg(`done: ${streams.length} stream(s)`);
        return streams;
    } catch (error) {
        const detail = error && error.stack ?
            String(error.stack).split("\n").slice(0, 3).join(" | ") :
            (error && error.message ? error.message : String(error));
        dbgWarn(`getStreams crashed: ${detail}`);
        return [];
    }
}

module.exports = { getStreams };
