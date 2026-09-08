"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const TMDB_API_KEY = "307b7b8ef035c6aa336900aef4e203bd";
const MAIN_URL = "https://app.cloud-mb.xyz";
const TOKEN = "jdvhhjv255vghhgdhvfch2565656jhdcghfdf";
const PACKAGE_NAME = "com.movieblast";
const CERT_SIGNATURE = "308202e4308201cc020101300d06092a864886f70d010105050030373116301406035504030c0d416e64726f69642044656275673110300e060355040a0c07416e64726f6964310b30090603550406130255533020170d3234313231393135323335335a180f32303534313231323135323335335a30373116301406035504030c0d416e64726f69642044656275673110300e060355040a0c07416e64726f6964310b300906035504061302555330820122300d06092a864886f70d01010105000382010f003082010a0282010100be59a34bdaf2d2531e252aa5e2f08489302f661514c629c0f403c736b1f8910bbac353899d8c29d93e18841dd15799907d8136999bb751a29d657e5403364e10b86c9b5eaab4c86803f7df16c4749499e00e198e8f8dbe87c17ed5997c395edafa49d37b159baefecdc8e155386044f224ba2bfa3639efc4ac4a6387583825ee513c9ea594d4496cfb689a93363e70ad1c99f8a22e0a4e19fb70bcbebec9373e41a455e2e4aa0af8d2b896e4ff5cb38cee59b2c8be86271bea10b003a3a6740fd342fd99509727f2b9a1cbfae730f51548b9c7330c52530b4cc25a8bde4c6f52a77b2c26962bcd2dcc3feb5170abe269aec62e0183d1f3d072a9b4fe86bb763f0203010001300d06092a864886f70d010105050003820101003645510973db07823e9dcb9c057da7dda183c671a38ede1b608bc7917405bbd6e3f955d31dfe6eb22038c1818b83a7335e30606ddac331b5db29063c8d3c1e7ffd23ef752d1aaba28d3ce31a16e9ebb3e0a5529d7747fef6da79fc19c24676c1d812d209d2a2da3a8fa6a43d8c9a4cc1e1f5e0309d0e69376dec7aa5e0625be248409cee8626f89d67bd477baf5937c0362eef12491bb79e791cdde210ff9c7853d5ebdb3ef6e81904bc0604896295387513c68d39c091d0fb11de9049402a3cb0e7975c328fe8d34b9f6ecae2ca45f2dab3b09075bab1360977c3af37759168225892a62fbf64f8c28ced2664a65e61b6837ba0103e484a59b9c4715d759ee3";
const HMAC_SECRET = "GJ8reydarI7Jqat9rvbAJKNQ9gY4DoEQF2H5nfuI1gi";
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Inlined dependency-free CryptoJS.HmacSHA256 stand-in (replaces crypto-js).
// Pure JS (hand-rolled SHA-256 + HMAC) — NOT backed by Node's `crypto` module,
// since Nuvio's sandbox is a browser-like JS runtime, not Node.js. Kept in
// sync with lib/micro-crypto.js (canonical, unit-tested copy). Self-contained
// for the same portability reason as the inlined HTML engine used elsewhere
// in this repo — see lib/micro-crypto.js for verification notes.
// ---------------------------------------------------------------------------
const CryptoJS = (function () {
  /**
   * A minimal, dependency-free stand-in for the `crypto-js` npm package,
   * covering only the single call site this repo actually uses:
   * CryptoJS.HmacSHA256(msg, key).toString(CryptoJS.enc.Base64).
   *
   * IMPORTANT: this is pure JS (a hand-rolled SHA-256 + HMAC), not backed by
   * Node's built-in `crypto` module. Nuvio's provider sandbox is a
   * browser-like JS runtime (it already relies on `fetch`/`atob`/`btoa`
   * elsewhere in this repo) — it is NOT Node.js, so `require("crypto")`
   * fails there even though it works fine in this addon's own Node server.
   * Base64 output uses `btoa`, matching what the rest of the codebase already
   * assumes is available; Node 18+ also provides a global `btoa`.
   *
   * Verified byte-for-byte against Node's `crypto.createHmac('sha256', ...)`
   * across ASCII, empty-string, unicode, and >64-byte-key inputs.
   */

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function rotr(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  function sha256(bytes) {
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    var l = bytes.length;
    var bitLen = l * 8;
    var padLen = l + 1;
    while (padLen % 64 !== 56) padLen++;
    padLen += 8;

    var padded = new Uint8Array(padLen);
    padded.set(bytes);
    padded[l] = 0x80;
    for (var i = 0; i < 8; i++) {
      padded[padLen - 1 - i] = i < 6 ? Math.floor(bitLen / Math.pow(2, 8 * i)) & 0xff : 0;
    }

    var w = new Uint32Array(64);
    for (var offset = 0; offset < padLen; offset += 64) {
      for (var j = 0; j < 16; j++) {
        var p = offset + j * 4;
        w[j] = ((padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3]) >>> 0;
      }
      for (var k = 16; k < 64; k++) {
        var s0 = rotr(w[k - 15], 7) ^ rotr(w[k - 15], 18) ^ (w[k - 15] >>> 3);
        var s1 = rotr(w[k - 2], 17) ^ rotr(w[k - 2], 19) ^ (w[k - 2] >>> 10);
        w[k] = (w[k - 16] + s0 + w[k - 7] + s1) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (var t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    var out = new Uint8Array(32);
    var words = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (var wi = 0; wi < 8; wi++) {
      out[wi * 4] = (words[wi] >>> 24) & 0xff;
      out[wi * 4 + 1] = (words[wi] >>> 16) & 0xff;
      out[wi * 4 + 2] = (words[wi] >>> 8) & 0xff;
      out[wi * 4 + 3] = words[wi] & 0xff;
    }
    return out;
  }

  function utf8Bytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.codePointAt(i);
      if (code > 0xffff) i++;
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(bytes);
  }

  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function hmacSha256Bytes(keyBytes, msgBytes) {
    var blockSize = 64;
    var key = keyBytes;
    if (key.length > blockSize) key = sha256(key);
    if (key.length < blockSize) {
      var padded = new Uint8Array(blockSize);
      padded.set(key);
      key = padded;
    }
    var oKeyPad = new Uint8Array(blockSize);
    var iKeyPad = new Uint8Array(blockSize);
    for (var i = 0; i < blockSize; i++) {
      oKeyPad[i] = key[i] ^ 0x5c;
      iKeyPad[i] = key[i] ^ 0x36;
    }
    var inner = sha256(concatBytes(iKeyPad, msgBytes));
    return sha256(concatBytes(oKeyPad, inner));
  }

  function bytesToBase64(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function bytesToHex(bytes) {
    var hex = "";
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      hex += h.length === 1 ? "0" + h : h;
    }
    return hex;
  }

  var enc = { Base64: "base64", Hex: "hex", Utf8: "utf8" };

  function HmacSHA256(message, key) {
    var digestBytes = hmacSha256Bytes(utf8Bytes(String(key)), utf8Bytes(String(message)));
    return {
      toString: function (encoder) {
        return encoder === enc.Base64 ? bytesToBase64(digestBytes) : bytesToHex(digestBytes);
      },
    };
  }
  return { HmacSHA256: HmacSHA256, enc: enc };
})();
const SEARCH_HEADERS = {
    "hash256": "86dc03244adddb3cbedbf0ae36074a736ee293a64774b18e82a6244eafd0df30",
    "packagename": PACKAGE_NAME,
    "signature": CERT_SIGNATURE,
    "User-Agent": "MovieBlast"
};
function httpsify(url) {
    return url && !url.startsWith("http") ? `https://${url}` : url;
}
function generateSignedUrl(url) {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const timestamp = String(Math.floor(Date.now() / 1e3));
    const signature = CryptoJS.HmacSHA256(path + timestamp, HMAC_SECRET).toString(CryptoJS.enc.Base64);
    return `${url}?verify=${timestamp}-${encodeURIComponent(signature)}`;
}
function matchQualityFromString(s) {
    if (!s)
        return "Unknown";
    const v = s.toLowerCase();
    if (v.includes("2160") || v.includes("4k"))
        return "2160p";
    if (v.includes("1440"))
        return "1440p";
    if (v.includes("1080") || v.includes("fullhd"))
        return "1080p";
    if (v.includes("720") || v.includes("hd"))
        return "720p";
    if (v.includes("480"))
        return "480p";
    if (v.includes("360"))
        return "360p";
    return "Unknown";
}
function searchMedia(query) {
    return __awaiter(this, void 0, void 0, function* () {
        const safeQuery = query.trim().replace(/ /g, "%20");
        const url = `${MAIN_URL}/api/search/${safeQuery}/${TOKEN}`;
        const res = yield fetch(url, { headers: SEARCH_HEADERS });
        const json = yield res.json();
        const list = json && Array.isArray(json.search) ? json.search : [];
        return list.map((item) => {
            const isSeries = (item.type || "").toLowerCase().includes("serie");
            const path = isSeries ? "series/show" : "media/detail";
            return {
                name: item.name,
                isSeries,
                url: `${MAIN_URL}/api/${path}/${item.id}/${TOKEN}`
            };
        });
    });
}
function loadDetail(url) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield fetch(url);
        const json = yield res.json();
        const seasons = Array.isArray(json.seasons) ? json.seasons : [];
        if (seasons.length > 0) {
            return { isSeries: true, seasons };
        }
        const videos = Array.isArray(json.videos) ? json.videos : [];
        return { isSeries: false, videos };
    });
}
function extractLoadUrls(videos) {
    return (videos || []).map((v) => ({ link: v.link, server: v.server, lang: v.lang })).filter((v) => v.link);
}
function toStream(loadUrl) {
    if (!loadUrl.link)
        return null;
    const signed = generateSignedUrl(httpsify(loadUrl.link));
    const quality = matchQualityFromString(loadUrl.server);
    return {
        name: `MovieBlast • ${quality}`,
        title: `MovieBlast • ${quality}`,
        url: signed,
        quality,
        headers: {
            "Connection": "Keep-Alive",
            "Icy-MetaData": "1",
            "Referer": "MovieBlast",
            "User-Agent": "MovieBlast",
            "x-request-x": PACKAGE_NAME
        }
    };
}
function normalizeTitle(title) {
    return (title || "").toLowerCase()
        .replace(/\b(the|a|an)\b/g, "")
        .replace(/[:\-_]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function findBestMatch(title, results) {
    const normTarget = normalizeTitle(title);
    let best = null;
    let bestScore = 0;
    for (const r of results) {
        const norm = normalizeTitle(r.name);
        let score = 0;
        if (norm === normTarget)
            score = 1;
        else if (norm.includes(normTarget) || normTarget.includes(norm))
            score = 0.8;
        else {
            const w1 = new Set(normTarget.split(" ").filter((w) => w.length > 2));
            const w2 = new Set(norm.split(" ").filter((w) => w.length > 2));
            const inter = [...w1].filter((w) => w2.has(w));
            score = w1.size ? inter.length / w1.size : 0;
        }
        if (score > bestScore) {
            bestScore = score;
            best = r;
        }
    }
    return best;
}
function getStreams(tmdbId, mediaType, season, episode) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (mediaType === "tv" && (season == null || episode == null))
                return [];
            const type = mediaType === "tv" ? "tv" : "movie";
            const tmdbUrl = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`;
            const tmdbRes = yield fetch(tmdbUrl);
            const tmdbInfo = yield tmdbRes.json();
            const title = tmdbInfo.title || tmdbInfo.name;
            if (!title)
                return [];
            const results = yield searchMedia(title);
            if (results.length === 0)
                return [];
            const wantSeries = mediaType === "tv";
            const filtered = results.filter((r) => r.isSeries === wantSeries);
            const pool = filtered.length > 0 ? filtered : results;
            const match = findBestMatch(title, pool) || pool[0];
            if (!match)
                return [];
            const detail = yield loadDetail(match.url);
            let videos = [];
            if (detail.isSeries) {
                if (!season || !episode)
                    return [];
                const seasonObj = detail.seasons.find((s) => (s.season_number || 0) === Number(season));
                if (!seasonObj)
                    return [];
                const episodes = Array.isArray(seasonObj.episodes) ? seasonObj.episodes : [];
                const episodeObj = episodes.find((e) => (e.episode_number || 0) === Number(episode));
                if (!episodeObj)
                    return [];
                videos = Array.isArray(episodeObj.videos) ? episodeObj.videos : [];
            }
            else {
                videos = detail.videos;
            }
            const loadUrls = extractLoadUrls(videos);
            const streams = loadUrls.map(toStream).filter(Boolean);
            const qualityOrder = { "2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "360p": 0, "Unknown": -1 };
            streams.sort((a, b) => { var _a, _b; return ((_a = qualityOrder[b.quality]) !== null && _a !== void 0 ? _a : -1) - ((_b = qualityOrder[a.quality]) !== null && _b !== void 0 ? _b : -1); });
            return streams.filter(s => { var _a; return ((_a = qualityOrder[s.quality]) !== null && _a !== void 0 ? _a : -1) >= 2; });
        }
        catch (e) {
            return [];
        }
    });
}
module.exports = { getStreams };
