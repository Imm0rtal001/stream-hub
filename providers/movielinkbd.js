const BASE_URL = "https://2y7gpg.movielinkbd.at";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": USER_AGENT, "Referer": `${BASE_URL}/` };

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

function multiplyLcg(state) {
    const multiplier = 1103515245;
    const low = (state & 0xffff) * multiplier;
    const high = (((state >>> 16) * multiplier) & 0xffff) << 16;
    return (low + high + 12345) >>> 0;
}

function decodeBase64Bytes(input) {
    const clean = input.replace(/[^A-Za-z0-9+/]/g, "");
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (let position = 0; position < clean.length; position++) {
        buffer = (buffer << 6) | "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(clean.charAt(position));
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 255);
            buffer &= (1 << bits) - 1;
        }
    }
    return bytes;
}

function decodeUtf8(bytes) {
    let output = "";
    let position = 0;
    while (position < bytes.length) {
        const byte = bytes[position];
        if (byte < 0x80) {
            output += String.fromCharCode(byte);
            position += 1;
        } else if ((byte & 0xe0) === 0xc0 && position + 1 < bytes.length) {
            output += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[position + 1] & 0x3f));
            position += 2;
        } else if ((byte & 0xf0) === 0xe0 && position + 2 < bytes.length) {
            output += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[position + 1] & 0x3f) << 6) | (bytes[position + 2] & 0x3f));
            position += 3;
        } else if ((byte & 0xf8) === 0xf0 && position + 3 < bytes.length) {
            const codePoint = (((byte & 0x07) << 18) | ((bytes[position + 1] & 0x3f) << 12) | ((bytes[position + 2] & 0x3f) << 6) | (bytes[position + 3] & 0x3f)) - 0x10000;
            output += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
            position += 4;
        } else {
            position += 1;
        }
    }
    return output;
}

function decodeObfuscatedText(encodedPayload, seedHex, roundCount) {
    try {
        let state = parseInt(seedHex, 16) >>> 0;
        for (let round = parseInt(roundCount, 10) || 0; round > 0; round--) state = multiplyLcg(state);
        const encoded = decodeBase64Bytes(encodedPayload);
        if (!encoded.length) return null;
        const bytes = [];
        for (let position = 0; position < encoded.length; position++) {
            state = multiplyLcg(state);
            bytes.push(encoded[position] ^ ((state >>> 16) & 255));
        }
        return decodeUtf8(bytes);
    } catch (error) {
        return null;
    }
}

function decodeObfuscatedPayload(encodedPayload, seedHex, roundCount) {
    try {
        const text = decodeObfuscatedText(encodedPayload, seedHex, roundCount);
        const payload = text ? JSON.parse(text) : null;
        return Array.isArray(payload && payload.episodes) ? payload : null;
    } catch (error) {
        return null;
    }
}

function decodeButtonPath(encodedPayload, seedHex, roundCount) {
    const text = decodeObfuscatedText(encodedPayload, seedHex, roundCount);
    return text && text.startsWith("/file/") ? text : null;
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
    let html = null;
    for (const extra of [undefined, BROWSER_EXTRA]) {
        const response = await httpGet(url, buildHeaders(referer, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", extra));
        if (!response || response.status !== 200) continue;
        html = html || response.body;
        const payload = extractPlayerPayload(response.body);
        if (payload) return { html: response.body, payload };
    }
    return html ? { html, payload: null } : null;
}

function parseDownloadButtons(html, mediaType, season, episode) {
    const episodeCards = [];
    if (mediaType !== "movie") {
        const cardPattern = /data-season-number="(\d+)"[^>]*data-episode-number="(\d+)"/g;
        let cardMatch;
        while ((cardMatch = cardPattern.exec(html)) !== null) {
            episodeCards.push({ position: cardMatch.index, season: parseInt(cardMatch[1], 10), episode: parseInt(cardMatch[2], 10) });
        }
    }
    const buttons = [];
    const anchorPattern = /<a\b[^>]*>[\s\S]*?<\/a>/g;
    let match;
    while ((match = anchorPattern.exec(html)) !== null) {
        const tag = match[0];
        const dataMatch = tag.match(/data-dl="([^"]+)"/);
        const seedMatch = tag.match(/data-ds="([0-9a-fA-F]+)"/);
        const roundsMatch = tag.match(/data-dr="(\d+)"/);
        const labelMatch = stripHtmlTags(tag).match(/Download\s*\[\s*([0-9]+p)\s*\u2022\s*([^\]]+)\]/);
        if (!dataMatch || !seedMatch || !roundsMatch || !labelMatch) continue;
        if (mediaType !== "movie") {
            let owner = null;
            for (const card of episodeCards) {
                if (card.position < match.index) owner = card;
                else break;
            }
            if (!owner || owner.season !== season || owner.episode !== episode) continue;
        }
        buttons.push({ quality: labelMatch[1], size: labelMatch[2].trim(), data: dataMatch[1], seed: seedMatch[1], rounds: roundsMatch[1] });
    }
    return buttons;
}

function findHostEntryHref(html, host) {
    const anchorPattern = /<a\b[^>]*>/g;
    let match;
    while ((match = anchorPattern.exec(html)) !== null) {
        if (!match[0].includes(`data-host="${host}"`)) continue;
        const hrefMatch = match[0].match(/href="([^"]+)"/);
        if (hrefMatch && hrefMatch[1].startsWith("/file/")) return hrefMatch[1];
    }
    return null;
}

function findFslDirectUrl(html) {
    const match = html.match(/href="(https:\/\/fsl\.movielink\.tv\/d\/[^"]+)"/);
    return match ? match[1].replace(/&amp;/g, "&") : null;
}

function findMp4Url(html) {
    const pattern = /https?:\/\/[^\s"'<>]+\.mp4(\?[^"'<>\s]*)?/g;
    let best = null;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        const url = match[0].replace(/&amp;/g, "&");
        if (url.includes("stream.mp4")) return url;
        if (!best) best = url;
    }
    return best;
}

async function resolveButtonSource(button, pageUrl) {
    const filePath = decodeButtonPath(button.data, button.seed, button.rounds);
    if (!filePath) return null;
    const hubUrl = `${BASE_URL}${filePath}`;
    const hubResponse = await httpGet(hubUrl, buildHeaders(pageUrl, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
    if (!hubResponse || hubResponse.status !== 200) return null;

    const mp4Entry = findHostEntryHref(hubResponse.body, "mp4-entry");
    if (mp4Entry) {
        const mp4Response = await httpGet(`${BASE_URL}${mp4Entry}`, buildHeaders(hubUrl, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
        const mp4Url = mp4Response && mp4Response.status === 200 ? findMp4Url(mp4Response.body) : null;
        if (mp4Url) return { url: mp4Url, quality: button.quality, size: button.size };
    }

    const fslEntry = findHostEntryHref(hubResponse.body, "fsl");
    if (!fslEntry) return null;
    const fslResponse = await httpGet(`${BASE_URL}${fslEntry}`, buildHeaders(hubUrl, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
    const fslUrl = fslResponse && fslResponse.status === 200 ? findFslDirectUrl(fslResponse.body) : null;
    return fslUrl ? { url: fslUrl, quality: button.quality, size: button.size } : null;
}

async function fetchButtonSources(html, pageUrl, mediaType, season, episode) {
    const buttons = parseDownloadButtons(html, mediaType, season, episode);
    const sources = await Promise.all(buttons.map(button => resolveButtonSource(button, pageUrl)));
    return sources.filter(Boolean);
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

const QUALITY_RANK = { "2160p": 3, "1080p": 2, "720p": 1, "480p": 0 };

function getSortTag(rank) {
    const inverted = (Math.max(...Object.values(QUALITY_RANK)) - rank).toString(2).padStart(20, "0");
    return inverted.replace(/1/g, "\uFEFF").replace(/0/g, "\u200B");
}

function normalizeQuality(rawQuality) {
    if (/2160|4k/.test(rawQuality)) return "2160p";
    if (/1080/.test(rawQuality)) return "1080p";
    if (/720/.test(rawQuality)) return "720p";
    if (/480/.test(rawQuality)) return "480p";
    return null;
}

function buildStreams(sources) {
    const seenUrls = new Set();
    const streams = [];
    for (const source of sources) {
        if (!source || typeof source.url !== "string" || !source.url || seenUrls.has(source.url)) continue;
        const quality = normalizeQuality(String(source.quality == null ? "" : source.quality).toLowerCase());
        if (!quality) continue;
        seenUrls.add(source.url);
        const sortTag = getSortTag(QUALITY_RANK[quality]);
        const stream = {
            name: `${sortTag}MovieLinkBD \u2022 ${quality}`,
            title: `${sortTag}MovieLinkBD \u2022 ${quality}`,
            url: source.url,
            quality,
            headers: HEADERS
        };
        if (source.size) stream.size = source.size;
        streams.push(stream);
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
        const searchResponse = await httpGet(searchUrl, buildHeaders(`${BASE_URL}/`, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
        if (!searchResponse || searchResponse.status !== 200) return [];

        const matchingCards = parseSearchResults(searchResponse.body, type).filter(card =>
            card.normalizedTitle === normalizedTitle &&
            isYearCompatible(card.year, tmdbYear) &&
            (type === "movie" || card.season === seasonNumber)
        );

        for (const card of matchingCards) {
            const pageUrl = `${BASE_URL}${card.path}`;
            const page = await fetchPlayerPayload(pageUrl, searchUrl);
            if (!page) continue;
            const entry = page.payload && findEpisodeEntry(page.payload, type, seasonNumber, episodeNumber);
            let sources = entry && Array.isArray(entry.sources) ? entry.sources : [];
            if (!sources.length) sources = await fetchButtonSources(page.html, pageUrl, type, seasonNumber, episodeNumber);
            const streams = buildStreams(sources);
            if (streams.length) return streams;
        }
        return [];
    } catch (error) {
        return [];
    }
}

module.exports = { getStreams };
