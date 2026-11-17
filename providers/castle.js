const BASE_URL = "https://play4u.org";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

async function fetchText(url, headers) {
    try {
        const response = await fetch(url, { headers });
        return response.ok ? await response.text() : null;
    } catch (error) {
        return null;
    }
}

function unsealUrl(value) {
    if (!value.startsWith("pa!~")) return value;
    try {
        const key = atob("cGE0dS1zdHJlYW0tc2VhbC12MQ==");
        const base64 = value.slice(4).replace(/-/g, "+").replace(/_/g, "/");
        const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
        return Array.from(binary, (char, i) =>
            String.fromCharCode(char.charCodeAt(0) ^ key.charCodeAt(i % key.length))
        ).join("");
    } catch (error) {
        return "";
    }
}

async function resolveImdbId(id, isSeries) {
    if (/^tt\d+$/.test(id)) return id;
    if (!/^\d+$/.test(id)) return null;
    const text = await fetchText(
        `${TMDB_API}/${isSeries ? "tv" : "movie"}/${id}/external_ids?api_key=${encodeURIComponent(TMDB_KEY)}`,
        { "User-Agent": USER_AGENT, Accept: "application/json" }
    );
    try {
        return JSON.parse(text).imdb_id || null;
    } catch (error) {
        return null;
    }
}

function extractPlayerState(html) {
    const marker = html.indexOf("window.__PA_PLAY__");
    const start = marker < 0 ? -1 : html.indexOf("{", marker);
    if (start < 0) return null;
    for (let end = html.indexOf("}", start); end >= 0; end = html.indexOf("}", end + 1)) {
        try {
            return JSON.parse(html.slice(start, end + 1));
        } catch (error) { }
    }
    return null;
}

function getHeight(stream) {
    const heights = (stream.qualities || []).map(function (q) {
        const match = String(q.label || q.slug || "").match(/\d{3,4}/);
        return parseInt(q.height, 10) || (match ? parseInt(match[0], 10) : 0);
    });
    return Math.max(0, ...heights);
}

function formatQuality(height) {
    return height >= 2160 ? "4K" : `${height}p`;
}

function buildLabel(stream) {
    const names = (stream.languages || []).map(function (l) { return l && l.name; }).filter(Boolean);
    if (names.length > 2) return "Play4u \u2022 Multi-Dub";
    return names.length ? "Play4u \u2022 " + names.join(" \u2022 ") : "Play4u";
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        const isSeries = mediaType === "tv";
        if (isSeries && (season == null || episode == null)) return [];

        const imdbId = await resolveImdbId(String(tmdbId || "").trim(), isSeries);
        if (!imdbId) return [];

        const pad = function (n) { return String(n).padStart(2, "0"); };
        const pageUrl = isSeries
            ? `${BASE_URL}/series/${imdbId}/s-${pad(season)}/ep-${pad(episode)}`
            : `${BASE_URL}/watch/${imdbId}`;

        const html = await fetchText(pageUrl, { "User-Agent": USER_AGENT, Referer: `${BASE_URL}/` });
        const state = html && extractPlayerState(html);
        if (!state || !state.ok || !Array.isArray(state.streams)) return [];

        const headers = { "User-Agent": USER_AGENT, Referer: `${BASE_URL}/`, Origin: BASE_URL };
        const seen = new Set();

        return state.streams
            .filter(function (s) { return s && s.m3u8_url; })
            .map(function (s) { return { height: getHeight(s), url: unsealUrl(s.m3u8_url), label: buildLabel(s) }; })
            .filter(function (s) { return s.height >= 1080 && s.url && !seen.has(s.url) && seen.add(s.url); })
            .sort(function (a, b) { return b.height - a.height; })
            .map(function (s) {
                return { name: s.label, title: s.label, url: s.url, quality: formatQuality(s.height), type: "hls", headers };
            });
    } catch (error) {
        return [];
    }
}

module.exports = { getStreams };
