/*
 * DahmerMovies combined provider
 * Supports movie and TV episode streams in a single Nuvio-compatible getStreams().
 *
 * Runtime: Node.js / Nuvio provider environment with fetch or axios available.
 * No third-party npm dependency is required when fetch is available.
 */

const TMDB_API_KEYS = [
  "1865f43a0549ca50d341dd9ab8b29f49",
  "439c478a771f35c05022f9feabcca01c",
  "8265bd1679663a7ea12ac168da84d2e8",
  "e49339e830e014e414c2b9a71b2d4f82"
];

const CONFIG_TAGS = [
  "aHR0cHM6Ly9hLjExMTQ3Ny54eXovOkExMTo6dG1kYj0xODY1ZjQzYTA1NDljYTUwZDM0MWRkOWFiOGIyOWY0OTo6bGltaXQ9Mw",
  "aHR0cHM6Ly9hLjExMTQ3Ny54eXovOkExMTo6dG1kYj00MzljNDc4YTc3MWYzNWMwNTAyMmY5ZmVhYmNjYTAxYzo6bGltaXQ9Mw",
  "aHR0cHM6Ly9hLjExMTQ3Ny54eXovOkExMTo6dG1kYj04MjY1YmQxNjc5NjYzYTdlYTEyYWMxNjhkYTg0ZDJlODo6bGltaXQ9Mw",
  "aHR0cHM6Ly9hLjExMTQ3Ny54eXovOkExMTo6dG1kYj1lNDkzMzllODMwZTAxNGU0MTRjMmI5YTcxYjJkNGY4Mjo6bGltaXQ9Mw"
];

const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function normalizeMediaType(mediaType) {
  const type = String(mediaType || "movie").toLowerCase();
  return (type === "tv" || type === "series" || type === "show" || type === "episode")
    ? "tv"
    : "movie";
}

async function httpGet(url, options = {}) {
  const headers = Object.assign({ "User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*" }, options.headers || {});
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : REQUEST_TIMEOUT_MS;

  if (typeof axios !== "undefined" && axios && typeof axios.get === "function") {
    const response = await axios.get(url, { headers, timeout });
    return response && Object.prototype.hasOwnProperty.call(response, "data") ? response.data : response;
  }

  if (typeof require === "function") {
    try {
      const axiosModule = require("axios");
      const axiosClient = axiosModule && (axiosModule.default || axiosModule);
      if (axiosClient && typeof axiosClient.get === "function") {
        const response = await axiosClient.get(url, { headers, timeout });
        return response && Object.prototype.hasOwnProperty.call(response, "data") ? response.data : response;
      }
    } catch (_) {
      // Fall through to fetch.
    }
  }

  if (typeof fetch === "function") {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer = null;
    if (controller) timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller ? controller.signal : undefined
      });
      if (!response || !response.ok) {
        throw new Error("HTTP request failed" + (response ? ": " + response.status : ""));
      }
      const body = await response.text();
      try {
        return JSON.parse(body);
      } catch (_) {
        return body;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw new Error("No supported HTTP client is available");
}

async function getMediaMeta(id, mediaType) {
  const type = normalizeMediaType(mediaType);
  const value = String(id == null ? "" : id).trim();
  if (!value) return { imdbId: null, title: "", year: "" };

  const isImdb = /^tt\d+$/i.test(value);
  if (isImdb) {
    try {
      const metaType = type === "tv" ? "series" : "movie";
      const data = await httpGet("https://v3-cinemeta.strem.io/meta/" + metaType + "/" + value + ".json");
      if (data && data.meta && data.meta.name) {
        return {
          imdbId: value,
          title: data.meta.name,
          year: data.meta.year || ""
        };
      }
    } catch (_) {
      // TMDB lookup below is only useful for TMDB numeric IDs.
    }
    return { imdbId: value, title: "", year: "" };
  }

  const endpoint = type === "tv" ? "tv" : "movie";
  for (const key of TMDB_API_KEYS) {
    try {
      const url = "https://api.themoviedb.org/3/" + endpoint + "/" +
        encodeURIComponent(value) + "?api_key=" + encodeURIComponent(key) +
        "&append_to_response=external_ids";
      const data = await httpGet(url, { timeout: REQUEST_TIMEOUT_MS });
      const imdbId = data && data.external_ids && data.external_ids.imdb_id;
      if (data && imdbId) {
        const title = data.title || data.name || data.original_title || data.original_name || "";
        const date = data.release_date || data.first_air_date || "";
        return { imdbId, title, year: String(date).split("-")[0] || "" };
      }
    } catch (_) {
      // Try the next configured key.
    }
  }

  return { imdbId: null, title: "", year: "" };
}

function formatCholeCard(opt) {
  var raw = [opt.filename || "", opt.rawText || "", opt.server || "", opt.quality || "", opt.size || "", opt.title || ""].join(" ");
  var text = raw.trim();
  var res = "";
  var qCheck = opt.quality ? String(opt.quality).trim() : "";
  if (/\b(?:2160p|4k|uhd)\b/i.test(qCheck) || /\b(?:2160p|4k|uhd)\b/i.test(text))
    res = "4K UHD";
  else if (/\b(?:1080p|fhd)\b/i.test(qCheck) || /\b(?:1080p|fhd)\b/i.test(text))
    res = "1080p FHD";
  else if (/\b(?:720p|hd)\b/i.test(qCheck) || /\b(?:720p|hd)\b/i.test(text))
    res = "720p HD";
  else if (/\b(?:480p|sd)\b/i.test(qCheck) || /\b(?:480p|sd)\b/i.test(text))
    res = "480p SD";
  else
    res = "1080p FHD";
  var source = "";
  if (/\bremux\b/i.test(text))
    source = "REMUX";
  else if (/\bbluray|blu-ray\b/i.test(text))
    source = "BluRay";
  else if (/\bweb-?dl|webrip\b/i.test(text))
    source = "WEB-DL";
  else if (/\bhdtv\b/i.test(text))
    source = "HDTV";
  var codecs = [];
  if (/\b(?:hevc|x265|h\.?265|10bit)\b/i.test(text))
    codecs.push("HEVC");
  else if (/\b(?:avc|x264|h\.?264)\b/i.test(text))
    codecs.push("AVC");
  var hdr = [];
  if (/\b(?:dolby\s*vision|dv)\b/i.test(text))
    hdr.push("Dolby Vision");
  if (/\bhdr10\+\b/i.test(text))
    hdr.push("HDR10+");
  else if (/\b(?:hdr10|hdr)\b/i.test(text))
    hdr.push("HDR");
  var audio = [];
  if (/\b(?:atmos|ddpa)\b/i.test(text))
    audio.push("Dolby Atmos 5.1");
  else if (/\btruehd\b/i.test(text))
    audio.push("TrueHD 5.1");
  else if (/\bdts-?hd(?:\s*ma)?\b/i.test(text))
    audio.push("DTS-HD MA 5.1");
  else if (/\bdts\b/i.test(text))
    audio.push("DTS 5.1");
  else if (/\b(?:ddp|dd\+|eac3)\b/i.test(text))
    audio.push("DDP 5.1");
  else if (/\b(?:dd|ac3)\b/i.test(text))
    audio.push("DD 5.1");
  else if (/\baac\b/i.test(text))
    audio.push("AAC");
  var langs = [];
  if (/\b(?:hindi|hin)\b/i.test(text))
    langs.push("\u{1F1EE}\u{1F1F3} Hindi");
  if (/\b(?:tamil|tam)\b/i.test(text))
    langs.push("\u{1F1EE}\u{1F1F3} Tamil");
  if (/\b(?:telugu|tel)\b/i.test(text))
    langs.push("\u{1F1EE}\u{1F1F3} Telugu");
  if (/\b(?:english|eng)\b/i.test(text))
    langs.push("\u{1F1EC}\u{1F1E7} English");
  if (/\b(?:japanese|jap|jpn)\b/i.test(text))
    langs.push("\u{1F1EF}\u{1F1F5} Japanese");
  if (/\bdual[- ]?audio\b/i.test(text))
    langs.push("\u{1F310} Dual-Audio");
  if (/\bmulti[- ]?audio\b/i.test(text))
    langs.push("\u{1F310} Multi-Audio");
  if (langs.length === 0)
    langs.push("\u{1F310} Multi-Audio");
  var uniqueLangs = Array.from(new Set(langs));
  var sizeMatch = text.match(/(?:💾\s*|\[|\b)([0-9.]+\s*[GM]B)(?:\]|\b)/i);
  var rawSize = opt.size || (sizeMatch ? sizeMatch[1] : "");
  var size = rawSize ? rawSize.replace(/([0-9.]+)\s*([GM]B)/i, "$1 $2").toUpperCase() : "";
  var server = opt.server || "DahmerMovies";
  var provider = opt.provider || "DahmerMovies";
  var nameParts = [provider];
  if (server && server !== provider)
    nameParts.push("\u{1F3F7}\uFE0F " + server);
  if (res)
    nameParts.push(res);
  if (source)
    nameParts.push(source);
  if (codecs.length)
    nameParts.push(codecs.join(" "));
  if (hdr.length)
    nameParts.push(hdr.join(" "));
  if (audio.length)
    nameParts.push(audio[0]);
  if (uniqueLangs.length)
    nameParts.push(uniqueLangs.slice(0, 2).join(" + "));
  var nameLine = nameParts.join(" \u2022 ");
  var filename = (opt.filename || "").trim();
  if (!filename || filename === opt.title) {
    var baseTitle = (opt.title || "Video").replace(/[^a-zA-Z0-9]+/g, ".");
    var yr = opt.year ? "." + opt.year : "";
    var se = opt.season && opt.episode ? ".S" + String(opt.season).padStart(2, "0") + "E" + String(opt.episode).padStart(2, "0") : "";
    var r = res ? "." + res.replace(/\s+/g, ".") : "";
    var s = source ? "." + source : "";
    var c = codecs.length ? "." + codecs.join(".") : "";
    var a = audio.length ? "." + audio[0].replace(/[^a-zA-Z0-9]+/g, ".") : "";
    var g = "-" + provider;
    filename = baseTitle + yr + se + r + s + c + a + g + ".mkv";
  }
  var specTags = [res, source].concat(codecs).filter(Boolean);
  var seasonEp = opt.season && opt.episode ? " \u2022 S" + String(opt.season).padStart(2, "0") + "E" + String(opt.episode).padStart(2, "0") : "";
  var line1 = "\u{1F3AC} " + (opt.title || "Unknown") + (opt.year ? " (" + opt.year + ")" : "") + seasonEp + (specTags.length ? " [" + specTags.join(" \u2022 ") + "]" : "");
  var line2 = "\u{1F4C4} " + filename;
  var av = hdr.concat(audio);
  var line3 = av.length ? "\u{1F48E} " + av.join(" \u2022 ") : "";
  var line4 = uniqueLangs.length ? "\u{1F310} " + uniqueLangs.join(" \u2022 ") : "";
  var metaArr = [];
  if (size)
    metaArr.push("\u{1F4E6} " + size);
  if (server)
    metaArr.push("\u{1F3F7}\uFE0F " + server);
  metaArr.push("\u{1F517} " + provider);
  var line5 = metaArr.join(" \u2022 ");
  var body = [line1, line2, line3, line4, line5].filter(Boolean).join(" ");
  var qualitySlug = "1080p";
  if (res.indexOf("4K") !== -1 || res.indexOf("2160") !== -1)
    qualitySlug = "4k";
  else if (res.indexOf("1080") !== -1)
    qualitySlug = "1080p";
  else if (res.indexOf("720") !== -1)
    qualitySlug = "720p";
  else if (res.indexOf("480") !== -1)
    qualitySlug = "480p";
  return {
    name: body,
    description: body,
    title: body,
    quality: qualitySlug,
    size: size || "Direct",
    provider: provider.toLowerCase()
  };
}

async function getStreams(tmdbId, mediaType = "movie", season = 1, episode = 1) {
  const type = normalizeMediaType(mediaType);
  const meta = await getMediaMeta(tmdbId, type);
  if (!meta || !meta.imdbId) return [];

  const streams = [];
  const seen = new Set();
  const seasonNumber = Math.max(1, parseInt(season, 10) || 1);
  const episodeNumber = Math.max(1, parseInt(episode, 10) || 1);

  const streamPath = type === "tv"
    ? "series/" + encodeURIComponent(meta.imdbId) + ":" + seasonNumber + ":" + episodeNumber
    : "movie/" + encodeURIComponent(meta.imdbId);

  for (const tag of CONFIG_TAGS) {
    try {
      const endpoint = "https://st.111477.xyz/config/" + tag + "/stream/" + streamPath + ".json";
      const data = await httpGet(endpoint, { timeout: REQUEST_TIMEOUT_MS });
      const rawStreams = data && Array.isArray(data.streams) ? data.streams : [];

      for (const item of rawStreams) {
        if (!item || typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) continue;
        const identity = item.url.trim();
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);

        const rawTitle = typeof item.title === "string" ? item.title : "";
        const filename = rawTitle.replace(/\s*\[.*?\]\s*$/, "").trim();
        const providerName = type === "tv" ? "DahmerMovies-TV" : "DahmerMovies";
        const card = formatCholeCard({
          title: meta.title || rawTitle || "Unknown",
          year: meta.year,
          season: type === "tv" ? seasonNumber : undefined,
          episode: type === "tv" ? episodeNumber : undefined,
          filename,
          rawText: rawTitle,
          server: "DahmerMovies",
          provider: providerName
        });

        streams.push(Object.assign({}, card, {
          url: identity,
          headers: { "User-Agent": USER_AGENT }
        }));
      }

      // Keep the original first-successful-config behavior, now without duplicate links.
      if (streams.length) break;
    } catch (_) {
      // A failed config is skipped so the next configured source can be tried.
    }
  }

  return streams;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
}
if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
if (typeof global !== "undefined") {
  global.getStreams = getStreams;
}
