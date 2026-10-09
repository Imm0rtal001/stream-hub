const BASE_URL = "https://cinefreak.net";
const TMDB_API = "https://api.themoviedb.org/3";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

function buildHeaders(extra) {
    return Object.assign({ "User-Agent": USER_AGENT, "Cookie": "xla=s4t" }, extra || {});
}

function extractQuality(text) {
    const normalized = String(text || "").replace(/%[0-9a-f]{2}/gi, " ").toLowerCase();
    const resolutionMatches = normalized.match(/(\d{3,4})p/g);
    if (resolutionMatches) return parseInt(resolutionMatches[resolutionMatches.length - 1], 10) + "p";
    if (/\b(4k|uhd|ds4k|2160p)\b/.test(normalized)) return "2160p";
    if (/\b1080p\b/.test(normalized)) return "1080p";
    return null;
}

function isAcceptableQuality(quality) {
    return quality === "2160p" || quality === "1080p";
}

function getQualityRank(quality) {
    if (quality === "2160p") return 2;
    if (quality === "1080p") return 1;
    return 0;
}

function buildSortPrefix(rank) {
    let invertedRank = 2 - rank;
    let binaryString = invertedRank.toString(2);
    while (binaryString.length < 20) binaryString = "0" + binaryString;
    return binaryString.split("").map(bit => bit === "1" ? "\uFEFF" : "\u200B").join("");
}

function collapseWhitespace(str) {
    return String(str || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}

function decodeHtmlEntities(str) {
    return collapseWhitespace(String(str || "")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"));
}

function stripHtmlTags(html) {
    return decodeHtmlEntities(String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "));
}

function getUrlOrigin(url) {
    try { const parsed = new URL(url); return parsed.protocol + "//" + parsed.host; } catch { return ""; }
}

function toAbsoluteUrl(base, path) {
    if (!path) return String(base || "");
    try { return new URL(path, base).href; } catch { return String(path); }
}

function decodeBase64(str) {
    str = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    try { return atob(str); } catch { return ""; }
}

function extractAnchors(html, base) {
    const anchors = [];
    const anchorPattern = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorPattern.exec(String(html || "")))) {
        const anchorTag = match[0];
        const hrefMatch = anchorTag.match(/\bhref=["']([^"']+)["']/i);
        if (!hrefMatch) continue;
        anchors.push({ href: toAbsoluteUrl(base, decodeHtmlEntities(hrefMatch[1])), text: stripHtmlTags(match[1]) });
    }
    return anchors;
}

async function fetchText(url, extra) {
    try {
        const response = await fetch(url, { headers: buildHeaders(extra) });
        return response.ok ? response.text() : "";
    } catch { return ""; }
}

function tryExtractEmbeddedUrl(url) {
    const match = String(url || "").match(/[?&]id=([^&\s"']+)/i);
    if (!match || /^v\d/i.test(match[1])) return null;
    const decoded = decodeBase64(match[1]);
    if (!decoded || !/^https?:\/\//i.test(decoded)) return null;
    const truncateIndex = decoded.indexOf("newgo32");
    return truncateIndex !== -1 ? decoded.slice(0, truncateIndex).trim() : decoded;
}

function buildStream(url, quality, referer) {
    const sortPrefix = buildSortPrefix(getQualityRank(quality));
    return {
        name: sortPrefix + "CineFreak \u2022 CineCloud",
        title: sortPrefix + "CineFreak \u2022 CineCloud",
        url,
        quality,
        headers: buildHeaders({ Referer: referer || BASE_URL + "/" })
    };
}

async function extractCinecloudStreams(html, base) {
    const referer = base + "/";
    const pageQuality = extractQuality(html);
    const pendingFetches = [];

    for (const anchor of extractAnchors(html, base)) {
        const linkUrl = anchor.href;
        const linkText = collapseWhitespace(anchor.text);
        if (!linkUrl || !/^https?:\/\//i.test(linkUrl)) continue;
        if (/terms-conditions|privacy-policy|abuse|facebook|t\.me/i.test(linkUrl)) continue;

        if (/cloud \[resumable\]/i.test(linkText) || /\/d\//i.test(linkUrl)) {
            pendingFetches.push(fetchText(linkUrl, { Referer: referer }).then(downloadPageHtml => {
                const downloadLinkMatch = downloadPageHtml.match(/<a\b[^>]*class=["'][^"']*\bdownload-now\b[^"']*["'][^>]*href=["']([^"']+)["']/i)
                    || downloadPageHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bdownload-now\b[^"']*["']/i);
                if (!downloadLinkMatch) return [];
                const streamUrl = toAbsoluteUrl(linkUrl, downloadLinkMatch[1]);
                const streamQuality = extractQuality(downloadLinkMatch[1]) || pageQuality;
                if (!isAcceptableQuality(streamQuality)) return [];
                return [buildStream(streamUrl, streamQuality, referer)];
            }).catch(() => []));
        }
    }

    return (await Promise.all(pendingFetches)).flat();
}

async function fetchCinecloudStreams(url) {
    try {
        const normalizedUrl = url.replace("/x/", "/f/");
        const origin = getUrlOrigin(url);
        const pageHtml = await fetchText(normalizedUrl, { Referer: origin + "/" });
        if (!pageHtml) return [];
        return extractCinecloudStreams(pageHtml, origin);
    } catch { return []; }
}

async function fetchGenerateStreams(url) {
    try {
        const origin = getUrlOrigin(url);
        const pageHtml = await fetchText(url, { Referer: origin + "/" });
        if (!pageHtml) return [];

        const redirectMatch = pageHtml.match(/(?:window\.)?location\.href\s*=\s*["']([^"']+)["']/i)
            || pageHtml.match(/generate\.php\?id=([^&"'\\]+)(?:\\u0026|&amp;|&)go=([^"'\s\\&]+)/i);

        let redirectUrl = "";
        if (redirectMatch?.[1]) {
            const rawUrl = redirectMatch[1].replace(/\\u0026/g, "&");
            if (/^https?:\/\//i.test(rawUrl)) redirectUrl = rawUrl;
            else if (redirectMatch[2]) redirectUrl = toAbsoluteUrl(origin, `/generate.php?id=${redirectMatch[1]}&go=${redirectMatch[2]}`);
            else redirectUrl = toAbsoluteUrl(origin, rawUrl);
        } else {
            const goParamMatch = pageHtml.match(/go=([a-zA-Z0-9._-]+)/i);
            if (goParamMatch) redirectUrl = url + (url.includes("?") ? "&" : "?") + "go=" + goParamMatch[1];
        }
        if (!redirectUrl) return [];

        let response;
        try { response = await fetch(redirectUrl, { headers: buildHeaders({ Referer: url }) }); }
        catch { return []; }

        if (!response.ok) return [];
        const responseBody = await response.text();
        const resolvedUrl = (response.url && response.url !== redirectUrl) ? response.url : redirectUrl;

        const cloudDomainMatch = responseBody.match(/https?:\/\/[a-z0-9.-]*(?:cinecloud|neodrive)[a-z0-9.-]*/i);
        const cloudOrigin = cloudDomainMatch ? cloudDomainMatch[0] : (getUrlOrigin(resolvedUrl) || "https://new5.cinecloud.site");
        const fileCodeMatch = responseBody.match(/\/(?:f|w|d)\/([a-f0-9]{6,16})/i);
        if (fileCodeMatch) {
            const streams = await extractCinecloudStreams(responseBody, cloudOrigin);
            if (streams.length) return streams;
            return resolveStreamUrl(cloudOrigin + "/f/" + fileCodeMatch[1]);
        }
        const canonicalMatch = responseBody.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
        if (canonicalMatch && /^https?:\/\//i.test(canonicalMatch[1])) return resolveStreamUrl(canonicalMatch[1]);
        if (/neodrive|cinecloud/i.test(resolvedUrl)) return fetchCinecloudStreams(resolvedUrl);
        return [];
    } catch { return []; }
}

async function resolveStreamUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return [];
    try {
        if (/generate\.php/i.test(url)) {
            const embeddedUrl = tryExtractEmbeddedUrl(url);
            if (embeddedUrl) return resolveStreamUrl(embeddedUrl);
            return fetchGenerateStreams(url);
        }
        const embeddedUrl = tryExtractEmbeddedUrl(url);
        if (embeddedUrl) return resolveStreamUrl(embeddedUrl);
        if (/neodrive|cinecloud/i.test(url)) return fetchCinecloudStreams(url);
        return [];
    } catch { return []; }
}

function extractMovieDownloadLinks(html, base) {
    const movieTitlePattern = /<h4\b[^>]*class=["'][^"']*movie-title[^"']*["'][^>]*>([\s\S]*?)<\/h4>/gi;
    const titleBlocks = [];
    let match;
    while ((match = movieTitlePattern.exec(html))) titleBlocks.push({ label: stripHtmlTags(match[1]), idx: match.index });

    const downloadLinks = [];
    const seenUrls = new Set();

    for (let i = 0; i < titleBlocks.length; i++) {
        const htmlSegment = html.slice(titleBlocks[i].idx, i + 1 < titleBlocks.length ? titleBlocks[i + 1].idx : html.length);
        for (const anchor of extractAnchors(htmlSegment, base)) {
            if (!anchor.href || seenUrls.has(anchor.href)) continue;
            if (!/generate\.php/i.test(anchor.href) && (!/^https?:\/\//i.test(anchor.href) || getUrlOrigin(anchor.href) === base)) continue;
            seenUrls.add(anchor.href);
            downloadLinks.push(anchor.href);
        }
    }

    if (!downloadLinks.length) {
        for (const anchor of extractAnchors(html, base)) {
            if (!anchor.href || seenUrls.has(anchor.href) || !/generate\.php/i.test(anchor.href)) continue;
            seenUrls.add(anchor.href);
            downloadLinks.push(anchor.href);
        }
    }
    return downloadLinks;
}

function extractEpisodeDownloadLinks(html, base, season, episode) {
    const episodeCardPattern = /<div\b[^>]*class=["'][^"']*ep-card[^"']*["'][^>]*>/gi;
    const cardOffsets = [];
    let match;
    while ((match = episodeCardPattern.exec(html))) cardOffsets.push(match.index);
    if (!cardOffsets.length) cardOffsets.push(0);

    const downloadLinks = [];
    const seenUrls = new Set();

    for (let i = 0; i < cardOffsets.length; i++) {
        const cardHtml = html.slice(cardOffsets[i], i + 1 < cardOffsets.length ? cardOffsets[i + 1] : html.length);
        const seasonMatch = cardHtml.match(/class=["'][^"']*season-number[^"']*["'][^>]*>\s*S?0*(\d+)/i) || cardHtml.match(/\bS(\d+)/i);
        if (seasonMatch && Number(seasonMatch[1]) !== season) continue;
        const episodeMatch = cardHtml.match(/class=["'][^"']*episode-badge[^"']*["'][^>]*>\s*Episode\s*(\d+)(?:-(\d+))?/i);
        const episodeRangeStart = episodeMatch ? Number(episodeMatch[1]) : i + 1;
        const episodeRangeEnd = episodeMatch?.[2] ? Number(episodeMatch[2]) : episodeRangeStart;
        if (episode < episodeRangeStart || episode > episodeRangeEnd) continue;
        const qualityBoxMatch = cardHtml.match(/<div\b[^>]*class=["'][^"']*quality-box[^"']*download-links[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
        for (const anchor of extractAnchors(qualityBoxMatch ? qualityBoxMatch[1] : cardHtml, base)) {
            if (!anchor.href || seenUrls.has(anchor.href)) continue;
            if (!/generate\.php/i.test(anchor.href) && !/^https?:\/\/(?!.*cinefreak\.nl)/i.test(anchor.href)) continue;
            seenUrls.add(anchor.href);
            downloadLinks.push(anchor.href);
        }
    }
    return downloadLinks;
}

function normalizeTitle(str) {
    return String(str || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function selectBestMatch(results, title, year, mediaType) {
    const normalizedQuery = normalizeTitle(title);
    let bestMatch = null, highestScore = -1;
    for (const result of results) {
        const rawTitle = result.title;
        const normalizedTitle = normalizeTitle(rawTitle.replace(/\s*\(.*?\)/g, "").replace(/\s*\[.*?\]/g, ""));
        let score = 0;
        if (normalizedTitle === normalizedQuery) score += 200;
        else if (normalizedTitle.includes(normalizedQuery)) score += 140;
        else if (normalizedQuery.includes(normalizedTitle) && normalizedTitle) score += 120;
        if (year && rawTitle.includes(year)) score += 80;
        const isSeries = /season|series|s0\d/i.test(rawTitle);
        if (mediaType === "tv" && isSeries) score += 30;
        if (mediaType === "movie" && !isSeries) score += 30;
        if (score > highestScore) { highestScore = score; bestMatch = result; }
    }
    return bestMatch;
}

async function fetchTmdbDetails(tmdbId, mediaType) {
    try {
        const endpoint = mediaType === "tv" ? "tv" : "movie";
        const response = await fetch(`${TMDB_API}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`, { headers: buildHeaders() });
        if (!response.ok) return null;
        const tmdbData = await response.json();
        if (!tmdbData) return null;
        const title = mediaType === "tv" ? (tmdbData.name || tmdbData.original_name) : (tmdbData.title || tmdbData.original_title);
        return { title: String(title || ""), year: ((tmdbData.release_date || tmdbData.first_air_date) || "").slice(0, 4) };
    } catch { return null; }
}

async function searchCinefreak(query) {
    try {
        const response = await fetch(`${BASE_URL}/search-api.php?q=${encodeURIComponent(query)}`, { headers: buildHeaders() });
        if (!response.ok) return [];
        const data = await response.json();
        if (!data) return [];
        const items = Array.isArray(data) ? data : (data.results || []);
        return items.map(item => ({ title: String(item.t || item.title || ""), slug: String(item.l || item.href || item.slug || "") })).filter(item => item.title && item.slug);
    } catch { return []; }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (mediaType === "tv" && (season == null || episode == null)) return [];

        const tmdbDetails = await fetchTmdbDetails(tmdbId, mediaType);
        if (!tmdbDetails || !tmdbDetails.title) return [];

        const searchResults = await searchCinefreak(tmdbDetails.title);
        if (!searchResults.length) return [];

        const siteMatch = selectBestMatch(searchResults, tmdbDetails.title, tmdbDetails.year, mediaType);
        if (!siteMatch) return [];

        let contentPageUrl = /^https?:\/\//i.test(siteMatch.slug) ? siteMatch.slug : toAbsoluteUrl(BASE_URL + "/", siteMatch.slug);
        if (!/\/(\?|#|$)/.test(contentPageUrl) && !/\.\w{2,4}$/.test(contentPageUrl)) contentPageUrl = contentPageUrl.replace(/\/?$/, "/");

        const pageHtml = await fetchText(contentPageUrl, { Referer: BASE_URL + "/" });
        if (!pageHtml) return [];

        const downloadLinks = mediaType === "movie"
            ? extractMovieDownloadLinks(pageHtml, BASE_URL)
            : extractEpisodeDownloadLinks(pageHtml, BASE_URL, season, episode);

        if (!downloadLinks.length) return [];

        const resolvedStreams = await Promise.all(downloadLinks.map(linkUrl => {
            const targetUrl = tryExtractEmbeddedUrl(linkUrl) || linkUrl;
            return resolveStreamUrl(targetUrl).catch(() => []);
        }));

        const seenPrefixes = new Set();
        const dedupedStreams = resolvedStreams.flat().filter(stream => {
            if (!stream?.url) return false;
            const schemeEnd = stream.url.indexOf("://");
            const urlPrefix = schemeEnd >= 0 ? stream.url.slice(schemeEnd + 3, schemeEnd + 11) : stream.url.slice(0, 8);
            return !seenPrefixes.has(urlPrefix) && !!seenPrefixes.add(urlPrefix);
        });

        let hd1080Count = 0;
        return dedupedStreams.filter(stream => stream.quality !== "1080p" || ++hd1080Count <= 2);
    } catch { return []; }
}

module.exports = { getStreams };
