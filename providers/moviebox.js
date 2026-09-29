const API_BASE = "https://api4.aoneroom.com";
const TMDB_API = "https://api.themoviedb.org/3";
const PLR_BASE = "https://themoviebox.xyz";
const TKKN_URL = "https://apig.inmoviebox.com/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1";
const MODELS = {
    Google: ["Pixel 6", "Pixel 7", "Pixel 8"],
};
const MODELS_BK = {
    Google: ["Pixel 7", "Pixel 8"],
};
const PACKAGE_INFO = {
    package_name: "com.community.mbox.in",
    version_name: "4.0.03.0920.03",
    version_code: 50020130,
};
const PACKAGE_INFO_BK = {
    package_name: "com.community.mbox.in",
    version_name: "3.0.03.0529.03",
    version_code: 50020042,
};
const KEY = CryptoJS.enc.Base64.parse(
    CryptoJS.enc.Base64.parse("NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==")
        .toString(CryptoJS.enc.Utf8)
);
const DUB_ALWAYS_ON = new Set(["Original Audio", "English"]);
const DUB_LANG_KEYS = {
    "Hindi": "dubHindi",
    "Tamil": "dubTamil",
    "Telugu": "dubTelugu",
    "Arabic": "dubArabic",
    "French": "dubFrench",
    "Español [Latino]": "dubEsLA",
    "Português [Brasil]": "dubPtBR",
    "Español": "dubEs",
    "Português": "dubPt",
    "Turkish": "dubTurkish",
    "Deutsch": "dubDeutsch",
    "Italiano": "dubItaliano",
    "Russian": "dubRussian",
    "Indonesian": "dubIndonesian",
    "Malay": "dubMalay",
    "Bengali": "dubBengali",
};

const LANG_MAP = {
    "esla": "Español [Latino]", "espanollatin": "Español [Latino]", "es-la": "Español [Latino]",
    "ptbr": "Português [Brasil]", "portuguesbrasil": "Português [Brasil]", "pt-br": "Português [Brasil]",
    "original": "Original Audio",
    "en": "English", "english": "English",
    "hindi": "Hindi", "hi": "Hindi",
    "tamil": "Tamil", "ta": "Tamil",
    "telugu": "Telugu", "te": "Telugu",
    "arabic": "Arabic", "ar": "Arabic",
    "french": "French", "fr": "French",
    "spanish": "Español", "es": "Español",
    "portuguese": "Português", "pt": "Português",
    "turkish": "Turkish", "tr": "Turkish",
    "german": "Deutsch", "de": "Deutsch",
    "italian": "Italiano", "it": "Italiano",
    "russian": "Russian", "ru": "Russian",
    "indonesian": "Indonesian", "id": "Indonesian",
    "malay": "Malay", "ms": "Malay",
    "bengali": "Bengali", "bn": "Bengali",
};

const UPDATE_CODES = new Set([
    "VERSION_TOO_LOW", "NEED_UPDATE", "FORCE_UPDATE", "LOW_VERSION",
    "APP_UPDATE_REQUIRED", "CLIENT_OUTDATED", "UPGRADE_REQUIRED",
    "VERSION_EXPIRED", "OUTDATED_VERSION",
]);
const UPDATE_MSG_PATTERN = /update|upgrade|version.*low|outdated|force.*update|please.*update/i;
const UPDATE_URL_KEYWORDS = [
    "update", "upgrade", "notice", "force_up", "forceup", "version_limit",
    "ver_limit", "low_version", "lowversion", "outdated", "please_update",
    "pleaseupdae", "app_update", "newversion", "new_version", "version_check",
    "vercheck", "updateapp", "update_app", "versiongate", "ver_gate",
    "ver-gate", "upgrade_notice", "needupgrade", "need_upgrade",
    "needupdate", "need_update",
];

let deviceId = "";
let selectedBrand = "";
let selectedModel = "";
let bearerToken = null;

let mvDeviceId = "";
let mvSelectedBrand = "";
let mvSelectedModel = "";
let mvBearerToken = null;

function ensureHttps(url) {
    if (typeof url !== "string") return null;
    if (url.startsWith("http://")) return "https://" + url.slice(7);
    if (!url.startsWith("https://")) return null;
    return url;
}

function decodeJwtExpiry(token) {
    try {
        const parts = token.split(".");
        if (parts.length < 2) return 0;
        let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4) b64 += "=";
        return JSON.parse(CryptoJS.enc.Base64.parse(b64).toString(CryptoJS.enc.Utf8)).exp || 0;
    } catch {
        return 0;
    }
}

function isTokenValid(token) {
    return !!token && decodeJwtExpiry(token) > Date.now() / 1000 + 3600;
}

function tryParseToken(xUser) {
    if (!xUser) return null;
    try {
        const parsed = JSON.parse(xUser);
        if (parsed.token && isTokenValid(parsed.token)) return parsed.token;
    } catch { }
    return null;
}

function md5(input) {
    return CryptoJS.MD5(input).toString(CryptoJS.enc.Hex);
}

function hmacMd5Base64(key, data) {
    return CryptoJS.HmacMD5(data, key).toString(CryptoJS.enc.Base64);
}

function generateXClientToken(ts) {
    const s = ts.toString();
    return `${s},${md5(s.split("").reverse().join(""))}`;
}

function buildCanonicalString(method, accept, contentType, url, body, ts) {
    let path = "";
    let query = "";
    try {
        const u = new URL(url);
        path = u.pathname;
        const keys = Array.from(u.searchParams.keys()).sort();
        if (keys.length) {
            query = keys.map(k => u.searchParams.getAll(k).map(v => `${k}=${v}`).join("&")).join("&");
        }
    } catch {
        const qi = url.indexOf("?");
        if (qi !== -1) {
            path = url.slice(0, qi).replace(/https?:\/\/[^/]+/, "");
            query = url.slice(qi + 1).split("&").sort().join("&");
        } else {
            path = url.replace(/https?:\/\/[^/]+/, "");
        }
    }
    const canonUrl = query ? `${path}?${query}` : path;
    let bodyHash = "";
    let bodyLen = "";
    if (body) {
        const words = CryptoJS.enc.Utf8.parse(body);
        bodyHash = md5(words);
        bodyLen = words.sigBytes.toString();
    }
    return `${method.toUpperCase()}\n${accept || ""}\n${contentType || ""}\n${bodyLen}\n${ts}\n${bodyHash}\n${canonUrl}`;
}

function normalizeTitle(s) {
    if (!s) return "";
    return s
        .replace(/\[.*?\]/g, " ")
        .replace(/\(.*?\)/g, " ")
        .replace(/\b(dub|dubbed|hd|4k|hindi|tamil|telugu|dual audio)\b/gi, " ")
        .trim()
        .toLowerCase()
        .replace(/:/g, " ")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ");
}

function normalizeLang(raw) {
    const key = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/\b(dub|dubbed)\b/g, "")
        .replace(/[\s_-]+/g, "");
    return LANG_MAP[key] || String(raw || "").trim();
}

function isDubEnabled(lang) {
    if (DUB_ALWAYS_ON.has(lang)) return true;
    const key = DUB_LANG_KEYS[lang];
    if (!key) return false;
    const val = SCRAPER_SETTINGS[key];
    if (val === undefined || val === null) return key === "dubHindi";
    return val === true || val === "true";
}

function parseQualityNumber(value) {
    const m = String(value || "").match(/(\d{3,4})/);
    return m ? parseInt(m[1], 10) : 0;
}

function getFormatType(url) {
    const u = url.toLowerCase();
    if (u.includes(".mpd")) return "DASH";
    if (u.includes(".m3u8")) return "HLS";
    if (u.includes(".mp4")) return "MP4";
    if (u.includes(".mkv")) return "MKV";
    return "VIDEO";
}

function resWeight(q) {
    if (q >= 2160) return 5;
    if (q >= 1440) return 4;
    if (q >= 1080) return 3;
    if (q >= 720) return 2;
    if (q >= 480) return 1;
    return 0;
}

function isUpdateVideo(url) {
    const u = url.toLowerCase();
    return UPDATE_URL_KEYWORDS.some(kw => u.includes(kw));
}

function isVersionGated(data) {
    if (!data || typeof data !== "object") return false;
    const code = data.code;
    if (code !== undefined) {
        if (UPDATE_CODES.has(String(code).toUpperCase())) return true;
        if (typeof code === "number" && code >= 4031 && code <= 4033) return true;
    }
    for (const key of ["message", "msg", "reason", "error", "err", "errorMsg", "errMsg"]) {
        if (typeof data[key] === "string" && UPDATE_MSG_PATTERN.test(data[key])) return true;
    }
    return false;
}

function getSortTag(rank, maxRank) {
    const bin = Math.max(0, maxRank - rank).toString(2).padStart(20, "0");
    return bin.split("").map(b => (b === "1" ? "\uFEFF" : "\u200B")).join("");
}

function findBestMatch(subjects, title, year, mediaType) {
    const normTarget = normalizeTitle(title);
    const targetType = mediaType === "movie" ? 1 : 2;
    let best = null;
    let bestScore = 0;
    for (const s of subjects) {
        if (s.subjectType !== targetType) continue;
        let score = 0;
        const norm = normalizeTitle(s.title);
        const sYear = s.year || (s.releaseDate ? s.releaseDate.slice(0, 4) : null);
        if (norm === normTarget) score += 50;
        else if (norm.includes(normTarget) || normTarget.includes(norm)) score += 15;
        if (year && sYear && year == sYear) score += 35;
        if (score > bestScore) { bestScore = score; best = s; }
    }
    return bestScore >= 40 ? best : null;
}

async function fetchTmdbDetails(tmdbId, mediaType) {
    try {
        const endpoint = mediaType === "movie" ? "movie" : "tv";
        const res = await fetch(
            `${TMDB_API}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`,
            {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
                    Accept: "application/json",
                },
            }
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (!data) return null;
        return {
            title: mediaType === "movie" ? (data.title || data.original_title) : (data.name || data.original_name),
            year: (data.release_date || data.first_air_date || "").slice(0, 4),
            originalTitle: data.original_title || data.original_name || null,
        };
    } catch {
        return null;
    }
}

function initSession() {
    if (deviceId) return;
    const hex = "0123456789abcdef";
    for (let i = 0; i < 32; i++) deviceId += hex[Math.floor(Math.random() * 16)];
    const brands = Object.keys(MODELS);
    selectedBrand = brands[Math.floor(Math.random() * brands.length)];
    selectedModel = MODELS[selectedBrand][Math.floor(Math.random() * MODELS[selectedBrand].length)];
}

function buildRequestHeaders(method, url, body, customHeaders = {}) {
    const ts = Date.now();
    const contentType = customHeaders["Content-Type"] || (body ? "application/json; charset=utf-8" : "application/json");
    const accept = customHeaders["Accept"] || "application/json";
    const xClientInfo = JSON.stringify({
        ...PACKAGE_INFO,
        os: "android",
        os_version: "14",
        device_id: deviceId,
        install_store: "official",
        brand: selectedBrand.toLowerCase(),
        model: selectedModel,
        system_language: "en",
        net: "NETWORK_WIFI",
        region: "IN",
        timezone: "Asia/Calcutta",
        sp_code: "",
    });
    return {
        ts,
        headers: {
            Accept: accept,
            "Content-Type": contentType,
            "x-client-token": generateXClientToken(ts),
            "x-tr-signature": `${ts}|2|${hmacMd5Base64(KEY, buildCanonicalString(method, accept, contentType, url, body || null, ts))}`,
            "User-Agent": `${PACKAGE_INFO.package_name}/${PACKAGE_INFO.version_code} (Linux; U; Android 14; en_IN; ${selectedModel}; Build/UD1A.230803.041; Cronet/145.0.7582.0)`,
            "x-client-info": xClientInfo,
            "x-client-status": "0",
            ...customHeaders,
        },
    };
}

async function getCachedToken() {
    if (isTokenValid(bearerToken)) return bearerToken;
    const res = await apiRequest("GET", TKKN_URL, null, {}, true);
    if (res?.headers) {
        const token = tryParseToken(res.headers.get("x-user"));
        if (token) { bearerToken = token; return token; }
    }
    return bearerToken || "";
}

async function apiRequest(method, url, body, customHeaders = {}, isTokenFetch = false) {
    initSession();
    const validatedUrl = ensureHttps(url);
    if (!validatedUrl) return null;
    const { headers } = buildRequestHeaders(method, validatedUrl, body, customHeaders);
    if (!isTokenFetch) {
        const token = await getCachedToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    const options = { method, headers };
    if (body) options.body = body;
    try {
        const res = await fetch(validatedUrl, options);
        if (!res.ok) return null;
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        if (res.headers) {
            const token = tryParseToken(res.headers.get("x-user"));
            if (token) bearerToken = token;
        }
        return { data, headers: res.headers };
    } catch {
        return null;
    }
}

async function searchBlocked(query) {
    try {
        const res = await apiRequest(
            "POST",
            `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`,
            JSON.stringify({ page: 1, perPage: 20, keyword: query, restrictKid: 1 })
        );
        if (res?.data?.data?.results) {
            return res.data.data.results.flatMap(g => g.subjects || []);
        }
    } catch { }
    return [];
}

async function fetchSubtitlesBlocked(subjectId, streamId, langLabel) {
    const [capRes, extRes] = await Promise.all([
        apiRequest("GET", `${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${streamId}`, null).catch(() => null),
        apiRequest("GET", `${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${streamId}&episode=0`, null).catch(() => null),
    ]);
    const subtitles = [];
    for (const res of [capRes, extRes]) {
        const captions = res?.data?.data?.extCaptions;
        if (!Array.isArray(captions)) continue;
        for (const cap of captions) {
            const url = ensureHttps(cap.url);
            if (!url) continue;
            subtitles.push({
                url,
                language: cap.language || cap.lanName || cap.lan || "en",
                name: `${cap.lanName || cap.language || cap.lan || "Subtitle"} (${langLabel})`,
                headers: { Referer: API_BASE },
            });
        }
    }
    return subtitles;
}

function extractPolicyResource(signCookie) {
    if (!signCookie || typeof signCookie !== "string") return null;
    const edgeMatch = signCookie.match(/Edge-Cache-Cookie=urlprefix=([^:;\s]+)/);
    if (edgeMatch) {
        try {
            let std = edgeMatch[1].replace(/_/g, "/").replace(/-/g, "+");
            const rem = (4 - std.length % 4) % 4;
            if (rem > 0) std += "=".repeat(rem);
            const decoded = CryptoJS.enc.Base64.parse(std).toString(CryptoJS.enc.Utf8).replace(/\/+$/, "");
            if (decoded) return `${decoded}/index.mpd`;
        } catch { }
    }
    const cfMatch = signCookie.match(/CloudFront-Policy=([^;]+)/);
    if (cfMatch) {
        try {
            const policyRaw = cfMatch[1];
            let cfB64 = policyRaw.replace(/-/g, "+").replace(/~/g, "/").replace(/_/g, "=");
            const rem = cfB64.length % 4;
            if (rem > 0) cfB64 += "=".repeat(rem);
            let decodedJson = null;
            try {
                decodedJson = CryptoJS.enc.Base64.parse(cfB64).toString(CryptoJS.enc.Utf8);
            } catch {
                let stdB64 = policyRaw.replace(/-/g, "+").replace(/_/g, "/");
                const rem2 = stdB64.length % 4;
                if (rem2 > 0) stdB64 += "=".repeat(rem2);
                decodedJson = CryptoJS.enc.Base64.parse(stdB64).toString(CryptoJS.enc.Utf8);
            }
            if (decodedJson) {
                const root = JSON.parse(decodedJson);
                const resource = root?.Statement?.[0]?.Resource;
                if (resource && typeof resource === "string") {
                    const trimmed = resource.replace(/[\*\/]+$/, "");
                    return trimmed.toLowerCase().endsWith(".mpd") ? trimmed : `${trimmed}/index.mpd`;
                }
            }
        } catch { }
    }
    return null;
}

function getPlaybackPage(subjectData, subjectId) {
    const candidates = [subjectData.detailPath, subjectData.detail_path, subjectData.path, subjectData.slug];
    let detailPath = candidates.find(v => typeof v === "string" && v.trim());
    let webBase = PLR_BASE;
    for (const value of [subjectData.detailDomain, subjectData.webDomain, subjectData.webUrl, subjectData.detailUrl, subjectData.shareUrl]) {
        if (typeof value !== "string") continue;
        try {
            const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
            if (!parsed.hostname.endsWith("aoneroom.com")) webBase = parsed.origin;
            if (!detailPath && parsed.pathname && parsed.pathname !== "/") detailPath = parsed.pathname;
            break;
        } catch { }
    }
    if (!detailPath) return { webBase, referer: `${webBase}/` };
    detailPath = detailPath.replace(/^\/+/, "").replace(/^movies\//, "");
    const pageUrl = new URL(`/movies/${detailPath}`, `${webBase}/`);
    pageUrl.searchParams.set("id", subjectId);
    pageUrl.searchParams.set("type", "/movie/detail");
    pageUrl.searchParams.set("detailSe", "");
    pageUrl.searchParams.set("detailEp", "");
    pageUrl.searchParams.set("lang", "en");
    return { webBase, detailPath, referer: pageUrl.toString() };
}

function extractStreamsBlocked(playData, item, playbackPage) {
    const { id: itemId, lang } = item;
    const ua = `com.community.mbox.in/${PACKAGE_INFO.version_code} (Linux; U; Android 14; en_IN; ${selectedModel}; Build/UD1A.230803.041; Cronet/145.0.7582.0)`;
    const baseHeaders = playbackPage
        ? { Origin: playbackPage.webBase, Referer: playbackPage.referer, "User-Agent": ua }
        : { Referer: API_BASE, "User-Agent": ua };
    const name = `MovieBox • ${lang}`;
    const streams = [];

    if (Array.isArray(playData.streams) && playData.streams.length) {
        for (const stream of playData.streams) {
            const rawUrl = stream.url || stream.playUrl || stream.resourceLink || stream.streamUrl || "";
            const signCookie = stream.signCookie || null;
            const resolvedUrl = ensureHttps(extractPolicyResource(signCookie) || rawUrl);
            if (!resolvedUrl || isUpdateVideo(resolvedUrl)) continue;
            if (resolvedUrl.includes("b164fbfb4347792950bdfbfb563d39d9")) continue;
            const fmt = getFormatType(resolvedUrl);
            const qualNum = parseQualityNumber(stream.resolutions || stream.resolution || stream.quality || "");
            if (qualNum > 0 && qualNum < 720) continue;
            const signHeaderKey = stream.signHeaderKey || stream.sign_header_key || "Cookie";
            streams.push({
                _itemId: itemId,
                _streamId: stream.id || `${itemId}`,
                _lang: lang,
                _hasSubs: true,
                name,
                title: name,
                url: resolvedUrl,
                qualNum,
                quality: qualNum ? `${qualNum}p • ${fmt}` : `Auto • ${fmt}`,
                headers: fmt === "MP4"
                    ? (signCookie ? { [signHeaderKey]: signCookie } : {})
                    : { ...baseHeaders, ...(signCookie ? { [signHeaderKey]: signCookie } : {}) },
            });
        }
    } else if (Array.isArray(playData.resourceDetectors)) {
        for (const detector of playData.resourceDetectors) {
            if (!Array.isArray(detector.resolutionList)) continue;
            for (const video of detector.resolutionList) {
                const url = ensureHttps(video.resourceLink);
                if (!url || isUpdateVideo(url)) continue;
                const fmt = getFormatType(url);
                const qualNum = parseQualityNumber(video.resolution);
                if (qualNum > 0 && qualNum < 720) continue;
                streams.push({
                    _itemId: itemId,
                    _streamId: null,
                    _lang: lang,
                    _hasSubs: false,
                    name,
                    title: name,
                    url,
                    qualNum,
                    quality: qualNum ? `${qualNum}p • ${fmt}` : `Auto • ${fmt}`,
                    headers: fmt === "MP4" ? {} : baseHeaders,
                });
            }
        }
    }
    return streams;
}

async function getStreamLinksBlocked(subjectId, season, episode) {
    try {
        const detailRes = await apiRequest("GET", `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`);
        if (!detailRes?.data?.data) return [];
        const subjectData = detailRes.data.data;
        const playbackPage = getPlaybackPage(subjectData, subjectId);

        const items = [{ id: subjectId, lang: "Original Audio" }];
        const dubs = subjectData.dubs;
        if (Array.isArray(dubs)) {
            let originalLang = "Original";
            for (const dub of dubs) {
                if (dub.subjectId == subjectId) {
                    originalLang = dub.lanName || "Original";
                } else {
                    items.push({ id: dub.subjectId, lang: normalizeLang(dub.lanName || "Unknown") });
                }
            }
            items[0].lang = normalizeLang(originalLang);
        }

        const filtered = items.filter(item =>
            !String(item.lang).toLowerCase().includes("sub") && isDubEnabled(item.lang)
        );

        const playbackHeaders = {
            Origin: playbackPage.webBase,
            Referer: playbackPage.referer,
            "x-request-lang": "en",
            "x-vip-restrict": "0",
            "x-no-high-risk-restrict": "0",
        };

        const rawStreams = [];
        for (const item of filtered) {
            const playParams = new URLSearchParams({
                subjectId: item.id,
                se: season,
                ep: episode,
                streamSignType: "1",
            });
            if (playbackPage.detailPath) playParams.set("detailPath", playbackPage.detailPath);
            playParams.set("supportCodecs[hevc]", "1");
            playParams.set("supportCodecs[h264]", "1");

            const res = await apiRequest(
                "GET",
                `${API_BASE}/wefeed-mobile-bff/subject-api/play-info?${playParams.toString()}`,
                null,
                playbackHeaders
            ).catch(() => null);

            if (!res?.data || isVersionGated(res.data)) continue;
            const playData = res.data.data;
            if (!playData || playData.needUpdate === true || playData.forceUpdate === true || isVersionGated(playData)) continue;
            rawStreams.push(...extractStreamsBlocked(playData, item, playbackPage));
        }

        return finalizeStreams(rawStreams, fetchSubtitlesBlocked);
    } catch {
        return [];
    }
}

function initSessionMv() {
    if (mvDeviceId) return;
    const hex = "0123456789abcdef";
    for (let i = 0; i < 32; i++) mvDeviceId += hex[Math.floor(Math.random() * 16)];
    const brands = Object.keys(MODELS_BK);
    mvSelectedBrand = brands[Math.floor(Math.random() * brands.length)];
    mvSelectedModel = MODELS_BK[mvSelectedBrand][Math.floor(Math.random() * MODELS_BK[mvSelectedBrand].length)];
}

function buildRequestHeadersMv(method, url, body, customHeaders = {}) {
    const ts = Date.now();
    const contentType = customHeaders["Content-Type"] || (body ? "application/json; charset=utf-8" : "application/json");
    const accept = customHeaders["Accept"] || "application/json";
    const xClientInfo = JSON.stringify({
        ...PACKAGE_INFO_BK,
        os: "android",
        os_version: "15",
        device_id: mvDeviceId,
        install_store: "ps",
        brand: mvSelectedBrand.toLowerCase(),
        model: mvSelectedModel,
        system_language: "en",
        net: "NETWORK_WIFI",
        region: "IN",
        timezone: "Asia/Calcutta",
        sp_code: "",
    });
    return {
        ts,
        headers: {
            Accept: accept,
            "Content-Type": contentType,
            "x-client-token": generateXClientToken(ts),
            "x-tr-signature": `${ts}|2|${hmacMd5Base64(KEY, buildCanonicalString(method, accept, contentType, url, body || null, ts))}`,
            "User-Agent": `${PACKAGE_INFO_BK.package_name}/${PACKAGE_INFO_BK.version_code} (Linux; U; Android 15; en_IN; ${mvSelectedModel}; Build/AP3A.240905.015; Cronet/133.0.6876.3)`,
            "x-client-info": xClientInfo,
            "x-client-status": "1",
            ...customHeaders,
        },
    };
}

async function getCachedTokenMv() {
    if (isTokenValid(mvBearerToken)) return mvBearerToken;
    const url = `${API_BASE}/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1`;
    const res = await apiRequestMv("GET", url, null, {}, true);
    if (res?.headers) {
        const token = tryParseToken(res.headers.get("x-user"));
        if (token) { mvBearerToken = token; return token; }
    }
    return mvBearerToken || "";
}

async function apiRequestMv(method, url, body, customHeaders = {}, isTokenFetch = false) {
    initSessionMv();
    const validatedUrl = ensureHttps(url);
    if (!validatedUrl) return null;
    const { headers } = buildRequestHeadersMv(method, validatedUrl, body, customHeaders);
    if (!isTokenFetch) {
        const token = await getCachedTokenMv();
        if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    const options = { method, headers };
    if (body) options.body = body;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(validatedUrl, options);
            if (!res.ok) {
                if ((res.status === 403 || res.status === 429) && attempt === 0) continue;
                return null;
            }
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); } catch { data = text; }
            if (res.headers) {
                const token = tryParseToken(res.headers.get("x-user"));
                if (token) mvBearerToken = token;
            }
            return { data, headers: res.headers };
        } catch {
            if (attempt === 1) return null;
        }
    }
    return null;
}

async function searchMavonyx(query) {
    try {
        const res = await apiRequestMv(
            "POST",
            `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`,
            JSON.stringify({ page: 1, perPage: 20, keyword: query })
        );
        if (res?.data?.data?.results) {
            return res.data.data.results.flatMap(g => g.subjects || []);
        }
    } catch { }
    return [];
}

async function fetchSubtitlesMv(subjectId, streamId, langLabel) {
    const [capRes, extRes] = await Promise.all([
        apiRequestMv("GET", `${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${streamId}`, null).catch(() => null),
        apiRequestMv("GET", `${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${streamId}&episode=0`, null).catch(() => null),
    ]);
    const subtitles = [];
    for (const res of [capRes, extRes]) {
        const captions = res?.data?.data?.extCaptions;
        if (!Array.isArray(captions)) continue;
        for (const cap of captions) {
            const url = ensureHttps(cap.url);
            if (!url) continue;
            subtitles.push({
                url,
                language: cap.language || cap.lanName || cap.lan || "en",
                name: `${cap.lanName || cap.language || cap.lan || "Subtitle"} (${langLabel})`,
                headers: { Referer: API_BASE },
            });
        }
    }
    return subtitles;
}

function extractStreamsMv(playData, item, season, episode) {
    const { id: itemId, lang } = item;
    const ua = `com.community.mbox.in/${PACKAGE_INFO_BK.version_code} (Linux; U; Android 15; en_IN; ${mvSelectedModel}; Build/AP3A.240905.015; Cronet/133.0.6876.3)`;
    const name = `MovieBox • ${lang}`;
    const streams = [];

    if (Array.isArray(playData.streams) && playData.streams.length) {
        for (const stream of playData.streams) {
            const url = ensureHttps(stream.url);
            if (!url || isUpdateVideo(url)) continue;
            const fmt = getFormatType(url);
            const qualNum = parseQualityNumber(stream.resolutions || stream.quality || "");
            if (qualNum > 0 && qualNum < 720) continue;
            streams.push({
                _itemId: itemId,
                _streamId: stream.id || `${itemId}|${season}|${episode}`,
                _lang: lang,
                _hasSubs: true,
                name,
                title: name,
                url,
                qualNum,
                quality: qualNum ? `${qualNum}p • ${fmt}` : `Auto • ${fmt}`,
                headers: fmt === "MP4"
                    ? (stream.signCookie ? { Cookie: stream.signCookie } : {})
                    : { Referer: API_BASE, "User-Agent": ua, ...(stream.signCookie ? { Cookie: stream.signCookie } : {}) },
            });
        }
    } else if (Array.isArray(playData.resourceDetectors)) {
        for (const detector of playData.resourceDetectors) {
            if (!Array.isArray(detector.resolutionList)) continue;
            for (const video of detector.resolutionList) {
                const url = ensureHttps(video.resourceLink);
                if (!url || isUpdateVideo(url)) continue;
                const fmt = getFormatType(url);
                const qualNum = parseQualityNumber(video.resolution);
                if (qualNum > 0 && qualNum < 720) continue;
                streams.push({
                    _itemId: itemId,
                    _streamId: null,
                    _lang: lang,
                    _hasSubs: false,
                    name,
                    title: name,
                    url,
                    qualNum,
                    quality: qualNum ? `${qualNum}p • ${fmt}` : `Auto • ${fmt}`,
                    headers: fmt === "MP4" ? {} : { Referer: API_BASE, "User-Agent": ua },
                });
            }
        }
    }
    return streams;
}

async function getStreamLinksMv(subjectId, season, episode) {
    try {
        const detailRes = await apiRequestMv("GET", `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`);
        if (!detailRes?.data?.data) return [];

        const items = [{ id: subjectId, lang: "Original Audio" }];
        const dubs = detailRes.data.data.dubs;
        if (Array.isArray(dubs)) {
            let originalLang = "Original";
            for (const dub of dubs) {
                if (dub.subjectId == subjectId) {
                    originalLang = dub.lanName || "Original";
                } else {
                    items.push({ id: dub.subjectId, lang: normalizeLang(dub.lanName || "Unknown") });
                }
            }
            items[0].lang = normalizeLang(originalLang);
        }

        const filtered = items.filter(item =>
            !String(item.lang).toLowerCase().includes("sub") && isDubEnabled(item.lang)
        );

        const rawStreams = [];
        for (const item of filtered) {
            const res = await apiRequestMv(
                "GET",
                `${API_BASE}/wefeed-mobile-bff/subject-api/play-info?subjectId=${item.id}&se=${season}&ep=${episode}`,
                null
            ).catch(() => null);
            if (!res?.data || isVersionGated(res.data)) continue;
            const playData = res.data.data;
            if (!playData || playData.needUpdate === true || playData.forceUpdate === true || isVersionGated(playData)) continue;
            rawStreams.push(...extractStreamsMv(playData, item, season, episode));
        }

        return finalizeStreams(rawStreams, fetchSubtitlesMv);
    } catch {
        return [];
    }
}

async function finalizeStreams(rawStreams, fetchSubtitlesFn) {
    const seen = new Set();
    const unique = rawStreams.filter(s => s.url && !seen.has(s.url) && seen.add(s.url));

    const withSubs = await Promise.all(
        unique.map(async s => {
            const subtitles = s._hasSubs && s._streamId
                ? await fetchSubtitlesFn(s._itemId, s._streamId, s._lang).catch(() => [])
                : [];
            const { _itemId, _streamId, _lang, _hasSubs, qualNum, ...rest } = s;
            return { ...rest, qualNum, subtitles };
        })
    );

    withSubs.sort((a, b) => resWeight(b.qualNum) - resWeight(a.qualNum));

    const total = withSubs.length;
    return withSubs.map((s, i) => {
        const tag = getSortTag(total - i, total + 1);
        const { qualNum, ...rest } = s;
        return { ...rest, name: tag + rest.name, title: tag + rest.title };
    });
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (mediaType === "tv" && (season == null || episode == null)) return [];
        const details = await fetchTmdbDetails(tmdbId, mediaType);
        if (!details) return [];
        const s = mediaType === "tv" ? season : 0;
        const e = mediaType === "tv" ? episode : 0;

        const useBlocked = SCRAPER_SETTINGS.useBlocked === true || SCRAPER_SETTINGS.useBlocked === "true";
        const searchFn = useBlocked ? searchBlocked : searchMavonyx;
        const linkFn = useBlocked ? getStreamLinksBlocked : getStreamLinksMv;

        let subjects = await searchFn(details.title);
        let match = findBestMatch(subjects, details.title, details.year, mediaType);
        if (!match && details.originalTitle && details.originalTitle !== details.title) {
            subjects = await searchFn(details.originalTitle);
            match = findBestMatch(subjects, details.originalTitle, details.year, mediaType);
        }
        if (!match) return [];
        return await linkFn(match.subjectId, s, e);
    } catch {
        return [];
    }
}

async function onSettings() {
    return [
        { type: "header", label: "Source" },
        { type: "toggle", key: "useBlocked", label: "Geo-Blocked", defaultValue: false },
        { type: "header", label: "Dub Languages" },
        { type: "info", label: "Original and English are always included." },
        { type: "toggle", key: "dubBengali", label: "Bengali", defaultValue: false },
        { type: "toggle", key: "dubHindi", label: "Hindi", defaultValue: true },
        { type: "toggle", key: "dubTamil", label: "Tamil", defaultValue: false },
        { type: "toggle", key: "dubTelugu", label: "Telugu", defaultValue: false },
        { type: "toggle", key: "dubArabic", label: "Arabic", defaultValue: false },
        { type: "toggle", key: "dubFrench", label: "French", defaultValue: false },
        { type: "toggle", key: "dubEsLA", label: "Español [Latino]", defaultValue: false },
        { type: "toggle", key: "dubPtBR", label: "Português [Brasil]", defaultValue: false },
        { type: "toggle", key: "dubEs", label: "Español", defaultValue: false },
        { type: "toggle", key: "dubPt", label: "Português", defaultValue: false },
        { type: "toggle", key: "dubTurkish", label: "Turkish", defaultValue: false },
        { type: "toggle", key: "dubDeutsch", label: "Deutsch", defaultValue: false },
        { type: "toggle", key: "dubItaliano", label: "Italiano", defaultValue: false },
        { type: "toggle", key: "dubRussian", label: "Russian", defaultValue: false },
        { type: "toggle", key: "dubIndonesian", label: "Indonesian", defaultValue: false },
        { type: "toggle", key: "dubMalay", label: "Malay", defaultValue: false },
    ];
}

module.exports = { getStreams, onSettings };
