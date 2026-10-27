const BASE_URL = "https://pc7mud.movielinkbd.at";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const STREAM_HEADERS = { "User-Agent": USER_AGENT, "Referer": `${BASE_URL}/` };

async function httpGet(url, headers) {
    try {
        const response = await fetch(url, { method: "GET", headers });
        return { status: response.status, body: await response.text() };
    } catch (error) {
        return null;
    }
}

function buildHeaders(referer, accept, extra) {
    return { "User-Agent": USER_AGENT, "Accept": accept, "Referer": referer, ...extra };
}

const BROWSER_EXTRA = {
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1"
};

function normalizeTitle(value) {
    return String(value == null ? "" : value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function stripHtmlTags(html) {
    return html
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}

function parseSearchCard(text) {
    const yearMatch = text.match(/\(((?:19|20)\d{2})\)/);
    const seasonMatch = text.match(/\bS(\d{1,2})\b/i) || text.match(/Season\s*(\d{1,2})/i);
    return {
        normalizedTitle: normalizeTitle(text.replace(/\[[^\]]*\]|\(\d{4}\)|\bS\d{1,2}\b|Season\s*\d{1,2}|\bCompleted\b/gi, " ")),
        year: yearMatch ? parseInt(yearMatch[1], 10) : null,
        season: seasonMatch ? parseInt(seasonMatch[1], 10) : null
    };
}

function parseSearchResults(html, mediaType) {
    const cards = [];
    const visitedPaths = new Set();
    const linkPattern = /<a[^>]*href="(\/(?:movie|series|anime|drama)\/[^"]+)"[^>]*>([\s\S]{0,800}?)<\/a>/g;
    let match;
    while ((match = linkPattern.exec(html)) !== null) {
        const path = match[1];
        if (visitedPaths.has(path) || (mediaType === "movie") !== path.startsWith("/movie/")) continue;
        const text = stripHtmlTags(match[2]);
        if (!text) continue;
        visitedPaths.add(path);
        cards.push({ ...parseSearchCard(text), path });
    }
    return cards;
}

function isYearCompatible(cardYear, tmdbYear) {
    return cardYear == null || tmdbYear == null || Math.abs(cardYear - tmdbYear) <= 1;
}

function decodeObfuscatedPayload(encodedPayload, seedHex, roundCount) {
    try {
        let state = parseInt(seedHex, 16) >>> 0;
        const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0);
        for (let round = parseInt(roundCount, 10); round > 0; round--) next();
        const binary = atob(encodedPayload.replace(/\s+/g, ""));
        const bytes = new Uint8Array(binary.length);
        for (let position = 0; position < binary.length; position++) {
            bytes[position] = binary.charCodeAt(position) ^ ((next() >>> 16) & 255);
        }
        const payload = JSON.parse(new TextDecoder("utf-8").decode(bytes));
        return Array.isArray(payload && payload.episodes) ? payload : null;
    } catch (error) {
        return null;
    }
}

function extractPlayerPayload(html) {
    const scriptPattern = /<script([^>]*)>([\s\S]*?)<\/script>/g;
    let match;
    while ((match = scriptPattern.exec(html)) !== null) {
        const seedMatch = match[1].match(/data-s\s*=\s*["']([0-9a-fA-F]+)["']/);
        const roundsMatch = match[1].match(/data-r\s*=\s*["'](\d+)["']/);
        if (seedMatch && roundsMatch) {
            return decodeObfuscatedPayload(match[2], seedMatch[1], roundsMatch[1]);
        }
    }
    return null;
}

async function fetchPlayerPayload(url, referer) {
    for (const extra of [undefined, BROWSER_EXTRA]) {
        const response = await httpGet(url, buildHeaders(referer, HTML_ACCEPT, extra));
        const payload = response && response.status === 200 ? extractPlayerPayload(response.body) : null;
        if (payload) return payload;
    }
    return null;
}

async function fetchTmdbDetails(mediaType, tmdbId) {
    const response = await httpGet(`${TMDB_API}/${mediaType}/${tmdbId}?api_key=${TMDB_KEY}`, buildHeaders("", "application/json, text/plain, */*"));
    if (!response || response.status !== 200) return null;
    try {
        return JSON.parse(response.body);
    } catch (error) {
        return null;
    }
}

function findEpisodeEntry(payload, mediaType, season, episode) {
    const entries = payload.episodes;
    if (mediaType === "movie") return entries.find(entry => entry.kind === "movie") || entries[0];
    return entries.find(entry => entry.season === season && entry.number === episode)
        || (season === 1 ? entries.find(entry => entry.number === episode) : undefined);
}

const QUALITY_RANK = { "2160p": 2, "1080p": 1 };

function getSortTag(rank) {
    const inverted = (Math.max(...Object.values(QUALITY_RANK)) - rank).toString(2).padStart(20, "0");
    return inverted.replace(/1/g, "\uFEFF").replace(/0/g, "\u200B");
}

function buildStreams(sources) {
    const seenUrls = new Set();
    const streams = [];
    for (const source of sources) {
        if (!source || typeof source.url !== "string" || !source.url || seenUrls.has(source.url)) continue;
        const rawQuality = String(source.quality == null ? "" : source.quality).toLowerCase();
        if (!/2160|1080|4k/.test(rawQuality)) continue;
        seenUrls.add(source.url);
        const quality = /1080/.test(rawQuality) ? "1080p" : "2160p";
        const sortTag = getSortTag(QUALITY_RANK[quality]);
        streams.push({
            name: `${sortTag}MovieLinkBD \u2022 ${quality}`,
            title: `${sortTag}MovieLinkBD \u2022 ${quality}`,
            url: source.url,
            quality,
            headers: STREAM_HEADERS
        });
    }
    return streams.sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality]);
}

function parseNumber(value) {
    const number = parseInt(value, 10);
    return isNaN(number) ? 1 : number;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (!/^\d+$/.test(String(tmdbId))) return [];

        const type = mediaType === "movie" ? "movie" : "tv";
        const seasonNumber = parseNumber(season);
        const episodeNumber = parseNumber(episode);

        const details = await fetchTmdbDetails(type, tmdbId);
        const title = details && (details.title || details.name);
        if (!title) return [];

        const tmdbYear = parseInt((details.release_date || details.first_air_date || "").slice(0, 4), 10) || null;
        const normalizedTitle = normalizeTitle(title);

        const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(title)}`;
        const searchResponse = await httpGet(searchUrl, buildHeaders(`${BASE_URL}/`, HTML_ACCEPT));
        if (!searchResponse || searchResponse.status !== 200) return [];

        const matchingCards = parseSearchResults(searchResponse.body, type).filter(card =>
            card.normalizedTitle === normalizedTitle &&
            isYearCompatible(card.year, tmdbYear) &&
            (type === "movie" || card.season === seasonNumber)
        );

        for (const card of matchingCards) {
            const payload = await fetchPlayerPayload(`${BASE_URL}${card.path}`, searchUrl);
            const entry = payload && findEpisodeEntry(payload, type, seasonNumber, episodeNumber);
            if (!entry || !Array.isArray(entry.sources)) continue;
            const streams = buildStreams(entry.sources);
            if (streams.length) return streams;
        }
        return [];
    } catch (error) {
        return [];
    }
}

module.exports = { getStreams };
