const BASE_URL = "https://vidnest.fun";
const API_BASE = BASE_URL.replace("://", "://new.");
const REFERER = `${BASE_URL}/`;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const WORKERS = [
    "https://long-night-d802.streamed-5.workers.dev",
    "https://blue-bush-5977.streamed-7.workers.dev",
    "https://rapid-heart-03c8.streamed-4.workers.dev",
    "https://super-flower-9c85.streamed-2.workers.dev",
    "https://flat-sky-cf20.streamed-850.workers.dev",
    "https://vidrift-cf.streamed-8.workers.dev"
];
const SERVERS = [
    { path: "onehd", displayName: "Alfa" },
    { path: "flixhq", displayName: "Beta" },
    { path: "yflix", displayName: "Catflix" },
    { path: "allmovies", displayName: "Delta" },
    { path: "rogflix", displayName: "Filxer" },
    { path: "vidzee", displayName: "Gama" },
    { path: "ophim", displayName: "Lamda" },
    { path: "rpmvid", displayName: "Prime" },
    { path: "nextgencloudfabric", displayName: "Zeta" }

];
const LANG_LABELS = {
    "original": "Original Audio",
    "latin american spanish": "Español [Latino]",
    "brazilian portuguese": "Português [Brasil]"
};

const PRIMES = [];
for (let n = 2; PRIMES.length < 64; n++) {
    if (PRIMES.every(function (prime) { return n % prime; })) PRIMES.push(n);
}
const SHA256_K = PRIMES.map(function (prime) { return (Math.pow(prime, 1 / 3) * 4294967296) | 0; });
const SHA256_INIT = PRIMES.slice(0, 8).map(function (prime) { return (Math.pow(prime, 0.5) * 4294967296) | 0; });

let aesSboxCache = null;

async function fetchText(url, headers) {
    try {
        const response = await fetch(url, { headers: headers });
        return {
            status: response.status,
            statusText: response.statusText || "",
            ok: response.ok,
            getHeader: function (name) {
                return (response.headers && typeof response.headers.get === "function" && response.headers.get(name)) || "";
            },
            text: await response.text()
        };
    } catch (error) {
        return null;
    }
}

async function fetchJson(url, headers) {
    const response = await fetchText(url, headers);
    if (!response || !response.ok) return null;
    try {
        return JSON.parse(response.text);
    } catch (error) {
        return null;
    }
}

function sanitizeHeaders(rawHeaders) {
    const headers = {};
    Object.keys(rawHeaders || {}).forEach(function (rawName) {
        const name = String(rawName).trim();
        const value = rawHeaders[rawName];
        if (!name || value == null || typeof value === "object") return;
        if (/^(connection|accept|accept-encoding|host|content-length|range)$/i.test(name)) return;
        const normalizedValue = String(value).trim();
        if (normalizedValue) headers[name] = normalizedValue;
    });
    if (headers.Origin) headers.Origin = headers.Origin.replace(/\/+$/, "");
    if (!headers["User-Agent"]) headers["User-Agent"] = USER_AGENT;
    return headers;
}

function decodeUtf8(bytes) {
    let text = "";
    for (let index = 0; index < bytes.length;) {
        const first = bytes[index++];
        const extra = first < 0x80 ? 0 : first < 0xE0 ? 1 : first < 0xF0 ? 2 : 3;
        let codePoint = extra ? first & (0x3F >> extra) : first;
        for (let k = 0; k < extra; k++) codePoint = (codePoint << 6) | (bytes[index++] & 0x3F);
        text += String.fromCodePoint(codePoint);
    }
    return text;
}

function decodeBase64(encoded, alphabet) {
    const bytes = [];
    let bitBuffer = 0;
    let bitCount = 0;
    for (let index = 0; index < encoded.length; index++) {
        const value = alphabet.indexOf(encoded.charAt(index));
        if (value < 0) continue;
        bitBuffer = ((bitBuffer << 6) | value) & 0xFFFFFF;
        bitCount += 6;
        if (bitCount >= 8) {
            bitCount -= 8;
            bytes.push((bitBuffer >> bitCount) & 255);
        }
    }
    return bytes;
}

function sha256(input) {
    const message = input.concat([0x80]);
    while (message.length % 64 !== 56) message.push(0);
    const bitLength = input.length * 8;
    message.push(0, 0, 0, 0, (bitLength >>> 24) & 255, (bitLength >>> 16) & 255, (bitLength >>> 8) & 255, bitLength & 255);

    const rotateRight = function (value, count) { return (value >>> count) | (value << (32 - count)); };
    const schedule = new Array(64);
    let hash = SHA256_INIT;

    for (let offset = 0; offset < message.length; offset += 64) {
        for (let i = 0; i < 64; i++) {
            if (i < 16) {
                schedule[i] = (message[offset + 4 * i] << 24) | (message[offset + 4 * i + 1] << 16) | (message[offset + 4 * i + 2] << 8) | message[offset + 4 * i + 3];
            } else {
                const sigma0 = rotateRight(schedule[i - 15], 7) ^ rotateRight(schedule[i - 15], 18) ^ (schedule[i - 15] >>> 3);
                const sigma1 = rotateRight(schedule[i - 2], 17) ^ rotateRight(schedule[i - 2], 19) ^ (schedule[i - 2] >>> 10);
                schedule[i] = (schedule[i - 16] + sigma0 + schedule[i - 7] + sigma1) | 0;
            }
        }
        let state = hash;
        for (let i = 0; i < 64; i++) {
            const [a, b, c, d, e, f, g, h] = state;
            const temp1 = (h + (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + schedule[i]) | 0;
            const temp2 = ((rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            state = [(temp1 + temp2) | 0, a, b, c, (d + temp1) | 0, e, f, g];
        }
        hash = hash.map(function (value, i) { return (value + state[i]) | 0; });
    }
    return hash.reduce(function (digest, value) {
        return digest.concat([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
    }, []);
}

function xtime(value) {
    return ((value << 1) ^ (value & 0x80 ? 0x11b : 0)) & 255;
}

function getAesSbox() {
    if (aesSboxCache) return aesSboxCache;
    const exponents = [];
    const logarithms = [];
    for (let i = 0, value = 1; i < 256; i++) {
        exponents[i] = value;
        logarithms[value] = i;
        value ^= xtime(value);
    }
    aesSboxCache = exponents.map(function (unused, i) {
        let inverse = i === 0 ? 0 : exponents[255 - logarithms[i]];
        let result = inverse;
        for (let rotation = 0; rotation < 4; rotation++) {
            inverse = ((inverse << 1) | (inverse >> 7)) & 255;
            result ^= inverse;
        }
        return result ^ 0x63;
    });
    return aesSboxCache;
}

function expandAesKey(key) {
    const sbox = getAesSbox();
    const substitute = function (byte) { return sbox[byte]; };
    const roundKeys = key.slice();
    let roundConstant = 1;
    for (let i = 32; i < 240; i += 4) {
        let word = roundKeys.slice(i - 4, i);
        if (i % 32 === 0) {
            word = [word[1], word[2], word[3], word[0]].map(substitute);
            word[0] ^= roundConstant;
            roundConstant = xtime(roundConstant);
        } else if (i % 32 === 16) {
            word = word.map(substitute);
        }
        for (let k = 0; k < 4; k++) roundKeys.push(roundKeys[i - 32 + k] ^ word[k]);
    }
    return roundKeys;
}

function encryptAesBlock(roundKeys, input) {
    const sbox = getAesSbox();
    let state = input.map(function (byte, i) { return byte ^ roundKeys[i]; });
    for (let round = 1; round <= 14; round++) {
        let next = [];
        for (let column = 0; column < 4; column++) {
            for (let row = 0; row < 4; row++) {
                next[column * 4 + row] = sbox[state[((column + row) % 4) * 4 + row]];
            }
        }
        if (round < 14) {
            const shifted = next;
            next = shifted.map(function (unused, i) {
                const base = i - (i % 4);
                const at = function (offset) { return shifted[base + ((i % 4) + offset) % 4]; };
                return xtime(at(0)) ^ xtime(at(1)) ^ at(1) ^ at(2) ^ at(3);
            });
        }
        state = next.map(function (byte, i) { return byte ^ roundKeys[round * 16 + i]; });
    }
    return state;
}

function decryptResponse(encodedPayload, nonce) {
    const payload = decodeBase64(String(encodedPayload).replace(/-/g, "+").replace(/_/g, "/"), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
    const iv = payload.slice(0, 12);
    const ciphertext = payload.slice(12, payload.length - 16);
    const keyBytes = `${nonce}|K3p8vQ2mX9rL5wZ0fN7bG1sH4tJ6dC9_y8S3wM1nQ5pL2`.split("").map(function (char) { return char.charCodeAt(0); });
    const roundKeys = expandAesKey(sha256(keyBytes));
    const plaintext = [];
    for (let offset = 0; offset < ciphertext.length; offset += 16) {
        const counter = offset / 16 + 2;
        const keystream = encryptAesBlock(roundKeys, iv.concat([(counter >>> 24) & 255, (counter >>> 16) & 255, (counter >>> 8) & 255, counter & 255]));
        ciphertext.slice(offset, offset + 16).forEach(function (byte, i) { plaintext.push(byte ^ keystream[i]); });
    }
    return decodeUtf8(plaintext);
}

function generateNonce() {
    let nonce = "";
    for (let i = 0; i < 22; i++) nonce += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charAt(Math.floor(Math.random() * 62));
    return nonce;
}

async function fetchServerResponse(server, tmdbId, mediaType, season, episode) {
    const resourcePath = mediaType === "movie"
        ? `/${server.path}/movie/${tmdbId}`
        : `/${server.path}/tv/${tmdbId}/${season}/${episode}`;

    let payload = await fetchJson(`${API_BASE}${resourcePath}?_n=${generateNonce()}`, {
        "User-Agent": USER_AGENT,
        "Referer": REFERER,
        "Origin": BASE_URL
    });
    try {
        if (payload && Number(payload.v) === 2 && typeof payload.d === "string") {
            payload = JSON.parse(decryptResponse(payload.d, payload.n));
        } else if (payload && payload.encrypted && typeof payload.data === "string") {
            payload = JSON.parse(decodeUtf8(decodeBase64(payload.data, "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/")));
        }
    } catch (error) {
        return null;
    }
    return payload && typeof payload === "object" ? payload : null;
}

function extractStreamEntries(payload) {
    const sharedHeaders = payload.headers && typeof payload.headers === "object" ? payload.headers : {};
    const asArray = function (value) { return Array.isArray(value) ? value : []; };
    const sources = [payload.url ? { url: payload.url, quality: payload.quality } : null]
        .concat(asArray(payload.streams), asArray(payload.sources), [payload.data && payload.data.stream && { url: payload.data.stream.playlist }]);
    return sources.filter(function (source) { return source && source.url; }).map(function (source) {
        return {
            url: String(source.url),
            language: String(source.language || ""),
            qualityHint: String(source.quality || ""),
            headers: source.headers && typeof source.headers === "object" ? source.headers : sharedHeaders
        };
    });
}

async function resolveRelayedPlaylist(relativePath, startIndex) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const playlistUrl = `${WORKERS[(startIndex + attempt) % WORKERS.length]}${relativePath}`;
        const response = await fetchText(playlistUrl, { "User-Agent": USER_AGENT });
        if (response && (response.status === 200 || response.status === 206) && /^\s*#EXTM3U/.test(response.text)) {
            return { url: playlistUrl, text: response.text };
        }
    }
    return null;
}

function detectQuality(text) {
    const value = String(text || "");
    if (/\b(4k|2160p?)\b/i.test(value)) return "2160p";
    const match = value.match(/\b(1080|720|480|360)p?\b/i);
    return match ? `${match[1]}p` : "Auto";
}

function buildSortPrefix(position) {
    return position.toString(2).padStart(20, "0").split("").map(function (bit) { return bit === "1" ? "\uFEFF" : "\u200B"; }).join("");
}

async function checkStreamAvailability(candidate) {
    const headers = Object.assign({}, candidate.headers);
    if (!/\.m3u8(\?|$)/i.test(candidate.url)) headers.Range = "bytes=0-2047";

    const response = await fetchText(candidate.url, headers);
    if (!response) return { verdict: "unknown" };

    const status = response.status;
    const bodyStart = response.text.replace(/^\uFEFF/, "").replace(/^\s+/, "").slice(0, 600);

    if (status === 200 || status === 206) {
        if (/^#EXTM3U/.test(bodyStart)) return { verdict: "ok", playlistText: response.text };
        if (/<MPD[\s>]/i.test(bodyStart)) return { verdict: "ok" };
        if (/^<(!doctype|html|head|body)/i.test(bodyStart)) return { verdict: "dead" };
        const rangeMatch = response.getHeader("content-range").match(/\/(\d+)\s*$/);
        const contentLength = response.getHeader("content-length");
        return {
            verdict: "ok",
            totalBytes: rangeMatch ? Number(rangeMatch[1]) : status === 200 && /^\d+$/.test(contentLength) ? Number(contentLength) : 0
        };
    }
    if (status === 0) {
        return { verdict: /host lookup|ENOTFOUND|getaddrinfo|No address|unreachable/i.test(response.statusText) ? "dead" : "unknown" };
    }
    return { verdict: [401, 403, 426, 427, 429].includes(status) ? "unknown" : "dead" };
}

function labelCodec(codecs, labels) {
    for (let i = 0; i < codecs.length; i++) {
        const codec = codecs[i].trim().toLowerCase();
        const match = labels.find(function (label) { return codec.indexOf(label[0]) === 0; });
        if (match) return match[1];
    }
    return "";
}

function pickBestVariant(playlistText) {
    const best = { bandwidth: 0, videoCodec: "", audioCodec: "" };
    const pattern = /#EXT-X-STREAM-INF:([^\r\n]*)/g;
    let match;
    while ((match = pattern.exec(playlistText || "")) !== null) {
        const bandwidthMatch = match[1].match(/BANDWIDTH=(\d+)/);
        const bandwidth = bandwidthMatch ? Number(bandwidthMatch[1]) : 0;
        if (bandwidth <= best.bandwidth) continue;
        const codecsMatch = match[1].match(/CODECS="([^"]*)"/);
        const codecs = codecsMatch ? codecsMatch[1].split(",") : [];
        best.bandwidth = bandwidth;
        best.videoCodec = labelCodec(codecs, [["hvc1", "H.265"], ["hev1", "H.265"], ["avc1", "H.264"], ["avc3", "H.264"], ["av01", "AV1"], ["vp09", "VP9"]]);
        best.audioCodec = labelCodec(codecs, [["mp4a", "AAC"], ["ac-3", "AC3"], ["ec-3", "EAC3"], ["opus", "Opus"]]);
    }
    return best;
}

function formatBytes(bytes) {
    const gigabytes = bytes / 1073741824;
    return gigabytes >= 1 ? `${gigabytes.toFixed(2)} GB` : `${Math.round(bytes / 1048576)} MB`;
}

function describeStream(candidate) {
    const lines = [];
    if (candidate.sizeBytes) lines.push(`${candidate.totalBytes ? "" : "~"}${formatBytes(candidate.sizeBytes)}`);
    const codecs = [candidate.variant.videoCodec, candidate.variant.audioCodec].filter(Boolean);
    if (codecs.length) lines.push(codecs.join(" \u2022 "));
    return lines.join("\n");
}

async function fetchRuntimeMinutes(tmdbId, mediaType, season, episode) {
    const apiKey = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "439c478a771f35c05022f9feabcca01c";
    const fetchTmdb = function (path) {
        return fetchJson(`https://api.themoviedb.org/3${path}?api_key=${apiKey}&language=en-US`, { "User-Agent": USER_AGENT });
    };

    if (mediaType === "movie") {
        const movie = await fetchTmdb(`/movie/${tmdbId}`);
        return (movie && movie.runtime) || 0;
    }
    const [episodeData, show] = await Promise.all([
        fetchTmdb(`/tv/${tmdbId}/season/${season}/episode/${episode}`),
        fetchTmdb(`/tv/${tmdbId}`)
    ]);
    return (episodeData && episodeData.runtime) || (show && show.episode_run_time && show.episode_run_time[0]) || 0;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (!/^\d+$/.test(String(tmdbId))) return [];
        if (mediaType !== "movie" && mediaType !== "tv") return [];
        if (mediaType === "tv" && (season == null || episode == null)) return [];

        const [serverResults, runtimeMinutes] = await Promise.all([
            Promise.all(SERVERS.map(async function (server) {
                return { server: server, payload: await fetchServerResponse(server, tmdbId, mediaType, season, episode) };
            })),
            fetchRuntimeMinutes(tmdbId, mediaType, season, episode)
        ]);

        const subtitles = [];
        const seenSubtitleLanguages = {};
        const candidates = [];
        const relayLookups = [];
        let nextRelayIndex = Math.floor(Math.random() * WORKERS.length);

        serverResults.forEach(function (result) {
            const payload = result.payload;
            if (!payload) return;

            (Array.isArray(payload.subtitles) ? payload.subtitles : []).forEach(function (subtitle) {
                if (!subtitle || !subtitle.url) return;
                const language = String(subtitle.lang || subtitle.label || "Subtitle").replace(/\s+\d+$/, "").trim();
                if (seenSubtitleLanguages[language]) return;
                seenSubtitleLanguages[language] = true;
                const url = String(subtitle.url);
                subtitles.push({
                    url: /^https?:/i.test(url) ? url : `${WORKERS[0]}${url.charAt(0) === "/" ? "" : "/"}${url}`,
                    language: language,
                    name: language
                });
            });

            extractStreamEntries(payload).slice(0, 6).forEach(function (entry) {
                if (/\/embed[\/.]|embed\.php/i.test(entry.url)) return;

                const quality = detectQuality(`${entry.qualityHint} ${entry.url}`);
                const rank = { "2160p": 3, "1080p": 2, "Auto": 1 }[quality];
                const language = entry.language.trim();
                const languageKey = language.toLowerCase();
                if (!rank || (quality === "Auto" && !language)) return;

                const candidate = {
                    url: entry.url,
                    label: ["VidNest", result.server.displayName, LANG_LABELS[languageKey] || language].filter(Boolean).join(" \u2022 "),
                    groupKey: language ? `${result.server.displayName}|${languageKey}` : `${result.server.displayName}||${entry.url}`,
                    quality: quality,
                    headers: sanitizeHeaders(entry.headers),
                    isOriginalAudio: !language || languageKey === "original",
                    rank: rank,
                    isRelayed: false,
                    isUnverified: false,
                    playlistText: "",
                    totalBytes: 0
                };

                if (/^https?:/i.test(entry.url)) {
                    candidates.push(candidate);
                    return;
                }
                const relativePath = entry.url.charAt(0) === "/" ? entry.url : `/${entry.url}`;
                relayLookups.push(resolveRelayedPlaylist(relativePath, nextRelayIndex++).then(function (playlist) {
                    if (!playlist) return;
                    Object.assign(candidate, { url: playlist.url, playlistText: playlist.text, headers: { "User-Agent": USER_AGENT }, isRelayed: true });
                    candidates.push(candidate);
                }));
            });
        });
        await Promise.all(relayLookups);

        if (!candidates.length) return [];

        const subtitleRank = function (language) {
            const index = ["English", "Hindi", "Urdu", "Arabic", "Bengali", "Tamil", "Telugu", "Malayalam", "Indonesian", "Malay", "Spanish", "French", "Portuguese", "Brazilian", "Turkish"].indexOf(language);
            return index < 0 ? 99 : index;
        };
        subtitles.sort(function (first, second) { return subtitleRank(first.language) - subtitleRank(second.language); });
        subtitles.splice(15);

        const checks = await Promise.all(candidates.map(function (candidate) {
            return candidate.isRelayed ? { verdict: "ok" } : checkStreamAvailability(candidate);
        }));

        const bestPerGroup = {};
        candidates.forEach(function (candidate, index) {
            const check = checks[index];
            if (check.verdict === "dead") return;
            if (check.playlistText) candidate.playlistText = check.playlistText;
            if (check.totalBytes) candidate.totalBytes = check.totalBytes;
            candidate.isUnverified = check.verdict === "unknown";
            candidate.variant = pickBestVariant(candidate.playlistText);
            candidate.sizeBytes = candidate.totalBytes || (candidate.variant.bandwidth && runtimeMinutes ? (candidate.variant.bandwidth * runtimeMinutes * 60) / 8 : 0);

            const current = bestPerGroup[candidate.groupKey];
            if (!current
                || (current.isUnverified && !candidate.isUnverified)
                || (current.isUnverified === candidate.isUnverified && candidate.sizeBytes > current.sizeBytes)) {
                bestPerGroup[candidate.groupKey] = candidate;
            }
        });

        const winners = Object.keys(bestPerGroup).map(function (key) { return bestPerGroup[key]; });
        const verified = winners.filter(function (candidate) { return !candidate.isUnverified; });
        const keptUncertain = winners.filter(function (candidate) { return candidate.isUnverified; })
            .slice(0, Math.max(0, 3 - Math.min(verified.length, 2)));

        const ordered = verified.concat(keptUncertain).sort(function (first, second) {
            return (first.isUnverified - second.isUnverified)
                || ((first.quality === "Auto") - (second.quality === "Auto"))
                || (second.isOriginalAudio - first.isOriginalAudio)
                || (second.rank - first.rank);
        });

        const seenUrls = {};
        const streams = [];
        ordered.forEach(function (candidate) {
            if (seenUrls[candidate.url]) return;
            seenUrls[candidate.url] = true;

            const sortPrefix = buildSortPrefix(streams.length);
            const stream = {
                name: `${sortPrefix}${candidate.label}`,
                title: `${sortPrefix}${candidate.label}`,
                url: candidate.url,
                quality: candidate.quality,
                headers: candidate.headers
            };
            const details = describeStream(candidate);
            if (details) stream.size = details;
            if (subtitles.length) stream.subtitles = subtitles;
            streams.push(stream);
        });
        return streams;
    } catch (error) {
        return [];
    }
}

module.exports = { getStreams };
