const BASE_URL = "https://vidbolt.xyz";
const API_BASE = `${BASE_URL}/api/resolve`;
const REFERER = `${BASE_URL}/`;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const SERVER_LABELS = ["quantum", "vega", "callisto", "orion", "fastva"];

function normalizeQuality(rawQuality) {
    const value = String(rawQuality || "").trim().toLowerCase();
    if (/2160|4k|uhd/.test(value)) return "2160p";
    if (/1080|fhd/.test(value)) return "1080p";
    return null;
}

function getQualityRank(quality) {
    return quality === "2160p" ? 5 : 3;
}

function formatLanguageLabel(language) {
    const trimmed = String(language || "").trim();
    switch (trimmed.toLowerCase()) {
        case "arabic sub":
            return "Arabic [Sub]";
        case "latin american spanish":
            return "Español [Latino]";
        case "brazilian portuguese":
            return "Português [Brasil]";
        default:
            return trimmed;
    }
}

function isEnglishLabel(label) {
    return /english|original/i.test(String(label || ""));
}

function hasEnglishAudio(candidate) {
    if (isEnglishLabel(candidate.language)) return true;
    return candidate.language === "Multi" && candidate.audioNames.some(isEnglishLabel);
}

function buildSortTag(rank) {
    let bits = Math.max(0, 11099 - rank).toString(2);
    while (bits.length < 20) bits = `0${bits}`;
    return bits.split("").map((bit) => (bit === "1" ? "\uFEFF" : "\u200B")).join("");
}

function capitalize(text) {
    return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function parseMasterAudioNames(masterPlaylist) {
    const names = [];
    if (!masterPlaylist || typeof masterPlaylist !== "string") return names;
    const mediaTagPattern = /#EXT-X-MEDIA:TYPE=AUDIO([^\n]*)/g;
    let match;
    while ((match = mediaTagPattern.exec(masterPlaylist)) !== null) {
        const nameMatch = match[1].match(/NAME="([^"]+)"/);
        if (nameMatch && names.indexOf(nameMatch[1]) === -1) names.push(nameMatch[1]);
    }
    return names;
}

function extractSources(payload) {
    const sources = payload && payload.stream && payload.stream.sources;
    if (!Array.isArray(sources)) return [];
    return sources.filter((source) => source && typeof source.url === "string" && source.url);
}

function fetchResolve(query) {
    return fetch(`${API_BASE}?${query}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", Referer: REFERER }
    })
        .then((response) => (response && response.ok ? response.json() : null))
        .catch(() => null);
}

function collectCandidates(responses) {
    const seenUrls = new Set();
    const candidates = [];

    responses.forEach((payload) => {
        if (!payload) return;
        const server = payload.stream && payload.stream.server
            ? String(payload.stream.server).trim()
            : "";

        extractSources(payload).forEach((source) => {
            if (seenUrls.has(source.url)) return;
            const quality = normalizeQuality(source.quality || source.name);
            if (!quality) return;
            seenUrls.add(source.url);

            const audioNames = parseMasterAudioNames(source.master);
            let language = String(source.language || "").trim();
            if (!language && audioNames.length === 1) language = audioNames[0];
            if (!language && audioNames.length > 1) language = "Multi";

            candidates.push({
                url: source.url,
                quality,
                language: formatLanguageLabel(language),
                audioNames,
                server,
                isMp4: String(source.kind || "hls").toLowerCase() === "mp4",
                order: candidates.length
            });
        });
    });

    return candidates;
}

function rankCandidates(candidates) {
    candidates.forEach((candidate) => {
        const score = (hasEnglishAudio(candidate) ? 100 : 0) + Math.round(getQualityRank(candidate.quality) * 2);
        candidate.rank = score * 100 + (99 - Math.min(candidate.order, 99));
    });
    return candidates.sort((a, b) => b.rank - a.rank);
}

function limitPerLanguage(candidates) {
    const countByLanguage = {};
    return candidates.filter((candidate) => {
        countByLanguage[candidate.language] = (countByLanguage[candidate.language] || 0) + 1;
        return countByLanguage[candidate.language] <= 2;
    });
}

function toStream(candidate) {
    const labelParts = ["VidBolt"];
    if (candidate.server) labelParts.push(capitalize(candidate.server));
    if (candidate.language) labelParts.push(candidate.language);
    const label = `${buildSortTag(candidate.rank)}${labelParts.join(" \u2022 ")}`;

    const stream = {
        name: label,
        title: label,
        url: candidate.url,
        quality: candidate.quality,
        headers: { Referer: REFERER, "User-Agent": USER_AGENT }
    };
    if (!candidate.isMp4) stream.type = "hls";
    return stream;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (!/^\d+$/.test(String(tmdbId))) return [];
        const isTvShow = mediaType === "tv";
        if (isTvShow && (season == null || episode == null)) return [];

        const mediaPath = isTvShow ? "tv" : "movie";
        const episodeParams = isTvShow ? `&season=${season}&episode=${episode}` : "";
        const query = `type=${mediaPath}&id=${tmdbId}${episodeParams}`;

        const serverOptions = [""].concat(SERVER_LABELS);
        const responses = await Promise.all(
            serverOptions.map((server) => fetchResolve(server ? `${query}&prefer=${server}` : query))
        );

        const candidates = collectCandidates(responses);
        if (!candidates.length) return [];

        return limitPerLanguage(rankCandidates(candidates)).slice(0, 10).map(toStream);
    } catch (error) {
        return [];
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams };
} else {
    globalThis.getStreams = getStreams;
}
