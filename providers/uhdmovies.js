/*
 * CVN-UHDMovies — Nuvio single-file provider
 * Promise-based implementation for the Nuvio/Hermes plugin runtime.
 * Includes public TheNaukriAdda redirect/form resolution for UHDMovies links.
 * Requires Nuvio's bundled module: cheerio-without-node-native
 *
 * This provider only returns publicly exposed direct media URLs and normal
 * redirects. It does not defeat CAPTCHA, login, paywall, or anti-bot controls.
 */
const cheerio = require("cheerio-without-node-native");

const BASE_URL = "https://uhdmovies.ceo";
const TMDB_API_KEY = "2315c44fee9ad6b8cd02933ac6393a60";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};
const MEDIA_RE = /\.(mp4|mkv|m3u8|mpd|avi)(?:$|[?#])/i;
const HOST_RE = /driveseed\.org|video-seed\.dev|workers\.dev|r2\.dev|drive\.google\.com|hubcloud|gdflix|thenaukriadda/i;
const QUALITY_RE = /(2160p|4k|1080p|720p|480p)/i;
const SIZE_RE = /(\d+(?:\.\d+)?\s?(?:GB|MB))/i;

function request(url, options) {
  options = options || {};
  const init = {
    method: options.method || "GET",
    headers: Object.assign({}, HEADERS, options.headers || {})
  };
  if (options.body !== undefined) init.body = options.body;
  if (options.signal) init.signal = options.signal;

  return fetch(url, init).then(function (response) {
    return response.text().then(function (body) {
      const headers = {};
      if (response.headers && response.headers.forEach) {
        response.headers.forEach(function (value, key) {
          headers[String(key).toLowerCase()] = value;
        });
      }
      if (!response.ok && !(options.allowRedirect && response.status >= 300 && response.status < 400)) {
        throw new Error("HTTP " + response.status + " for " + url);
      }
      return {
        status: response.status,
        headers: headers,
        data: body || "",
        url: response.url || url
      };
    });
  });
}

function load(html) {
  return cheerio.load(html || "");
}
function absUrl(href, base) {
  try { return new URL(href, base).href; } catch (e) { return ""; }
}
function norm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function getMeta(tmdbId, mediaType) {
  if (!TMDB_API_KEY) return Promise.reject(new Error("TMDB_API_KEY is missing"));
  const kind = mediaType === "tv" ? "tv" : "movie";
  const url = "https://api.themoviedb.org/3/" + kind + "/" +
    encodeURIComponent(String(tmdbId)) + "?api_key=" + encodeURIComponent(TMDB_API_KEY);
  return request(url).then(function (response) {
    const data = JSON.parse(response.data);
    const title = data.title || data.name || "";
    const date = data.release_date || data.first_air_date || "";
    if (!title) throw new Error("TMDB returned no title for ID " + tmdbId);
    return { title: title, year: String(date).slice(0, 4) };
  });
}

function choosePost(searchHtml, meta) {
  const $ = load(searchHtml);
  const wanted = norm(meta.title);
  const anchors = $("a[href]");
  let best = null;
  let bestScore = -1;

  anchors.each(function (_, el) {
    const a = $(el);
    const href = absUrl(a.attr("href"), BASE_URL);
    const title = a.text().replace(/\s+/g, " ").trim();
    const n = norm(title);
    if (!href || !title || !href.startsWith(BASE_URL)) return;
    if (/\/(category|tag|page)\//i.test(href) || href === BASE_URL + "/") return;
    if (n.indexOf(wanted) === -1 && wanted.indexOf(n) === -1) return;

    let score = n.indexOf(wanted) !== -1 ? 5 : 2;
    if (meta.year && title.indexOf(meta.year) !== -1) score += 3;
    if (/download/i.test(title)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = href;
    }
  });
  return best;
}

function parsePostLinks(html, postUrl, mediaType, season, episode) {
  const $ = load(html);
  const results = [];
  const seen = {};
  const allText = $(".entry-content, .post-content, article, main").first().text() || $("body").text();
  const seasonHeading = new RegExp("season\\s*0*" + Number(season || 1) + "\\b", "i");

  $("a[href]").each(function (_, el) {
    const a = $(el);
    const href = absUrl(a.attr("href"), postUrl);
    const label = a.text().replace(/\s+/g, " ").trim();
    const context = (a.parent().text() || label).replace(/\s+/g, " ").trim();
    if (!href || !/^https?:\/\//i.test(href)) return;
    if (href.indexOf(BASE_URL) === 0) return;
    if (/facebook|twitter|telegram|instagram|youtube|whatsapp|t\.me/i.test(href)) return;

    const combined = (label + " " + href + " " + context).toLowerCase();
    if (!HOST_RE.test(href) && !/download|g-?drive|episode|watch|stream/i.test(combined)) return;

    if (mediaType === "tv" && season) {
      const seasonMatch = combined.match(/season\s*0*(\d+)/i);
      if (seasonMatch && Number(seasonMatch[1]) !== Number(season)) return;
    }
    if (mediaType === "tv" && episode) {
      const epMatch = combined.match(/(?:episode|ep)\s*0*(\d+)/i);
      if (epMatch && Number(epMatch[1]) !== Number(episode)) return;
    }

    if (seen[href]) return;
    seen[href] = true;
    const qualityMatch = combined.match(QUALITY_RE) || allText.match(QUALITY_RE);
    const sizeMatch = combined.match(SIZE_RE) || context.match(SIZE_RE);
    results.push({
      url: href,
      label: label || "Download",
      quality: qualityMatch ? qualityMatch[1].toLowerCase().replace("4k", "2160p") : "",
      size: sizeMatch ? sizeMatch[1] : ""
    });
  });
  return results;
}

function findLinks(args) {
  return getMeta(args.tmdbId, args.mediaType).then(function (meta) {
    const query = encodeURIComponent(meta.title + (args.mediaType === "movie" && meta.year ? " " + meta.year : ""));
    return request(BASE_URL + "/?s=" + query).then(function (searchResponse) {
      const postUrl = choosePost(searchResponse.data, meta);
      if (!postUrl) return [];
      return request(postUrl, { headers: { "Referer": BASE_URL + "/" } }).then(function (postResponse) {
        return parsePostLinks(postResponse.data, postUrl, args.mediaType, args.season, args.episode);
      });
    });
  });
}

function mediaFromHtml(html, pageUrl) {
  const $ = load(html);
  const found = [];
  const seen = {};
  $("video[src], video source[src], source[src], iframe[src], a[href]").each(function (_, el) {
    const node = $(el);
    const value = node.attr("src") || node.attr("href");
    const url = absUrl(value, pageUrl);
    if (!url || !/^https?:\/\//i.test(url) || seen[url]) return;
    if (MEDIA_RE.test(url) || HOST_RE.test(url)) {
      seen[url] = true;
      found.push(url);
    }
  });
  return found;
}

function unwrapVideoSeed(url) {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)video-seed\.dev$/i.test(parsed.hostname)) return url;
    const candidate = parsed.searchParams.get("url") || parsed.searchParams.get("file") ||
      parsed.searchParams.get("src") || parsed.searchParams.get("link");
    return candidate && /^https?:\/\//i.test(candidate) ? candidate : url;
  } catch (e) {
    return url;
  }
}

function resolveVideoSeed(url) {
  const unwrapped = unwrapVideoSeed(url);
  if (unwrapped !== url || !/video-seed\.dev/i.test(url)) return Promise.resolve(unwrapped);
  // Follow ordinary public redirects; if it remains an HTML landing page, do not
  // misreport that page as a playable video.
  return request(url).then(function (response) {
    const finalUrl = response.url || url;
    if (MEDIA_RE.test(finalUrl) || !/video-seed\.dev/i.test(finalUrl)) return finalUrl;
    const links = mediaFromHtml(response.data, finalUrl).filter(function (candidate) {
      return MEDIA_RE.test(candidate);
    });
    return links[0] || "";
  }).catch(function () { return ""; });
}

function extractDriveSeed(url) {
  const candidates = [];
  function collect(pageUrl) {
    return request(pageUrl, { headers: { "Referer": url } }).then(function (response) {
      mediaFromHtml(response.data, response.url || pageUrl).forEach(function (link) {
        if (candidates.indexOf(link) === -1) candidates.push(link);
      });
    }).catch(function () { return null; });
  }
  return collect(url).then(function () {
    const zUrl = url.replace("/file/", "/zfile/");
    const w1 = url.replace("/file/", "/wfile/") + "?type=1";
    const w2 = url.replace("/file/", "/wfile/") + "?type=2";
    return collect(zUrl).then(function () {
      return collect(w1).then(function () { return collect(w2); });
    });
  }).then(function () {
    const tasks = candidates.map(function (candidate) {
      if (/video-seed\.dev/i.test(candidate)) {
        return resolveVideoSeed(candidate).then(function (resolved) {
          return resolved ? [resolved] : [];
        });
      }
      if (MEDIA_RE.test(candidate)) return Promise.resolve([candidate]);
      return Promise.resolve([]);
    });
    return Promise.all(tasks).then(function (groups) {
      const out = [];
      groups.forEach(function (group) {
        group.forEach(function (link) {
          if (out.indexOf(link) === -1) out.push(link);
        });
      });
      return out.map(function (link) {
        return { server: /video-seed/i.test(link) ? "VideoSeed" : "DriveSeed", link: link };
      });
    });
  });
}


function redirectFromHtml(html, baseUrl) {
  const patterns = [
    /location\.replace\(\s*["']([^"']+)["']\s*\)/i,
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /location\.href\s*=\s*["']([^"']+)["']/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = String(html || "").match(patterns[i]);
    if (match && match[1]) return absUrl(match[1].replace(/\\\\/g, ""), baseUrl);
  }
  const meta = String(html || "").match(/<meta[^>]+url\s*=\s*([^"'>\s]+)["']?[^>]*>/i);
  return meta ? absUrl(meta[1], baseUrl) : "";
}

function submitPublicForm(html, pageUrl, depth) {
  if (depth > 3) return Promise.resolve([]);
  const $ = load(html);
  const form = $("form").first();
  if (!form || !form.length) return Promise.resolve([]);
  const action = absUrl(form.attr("action") || pageUrl, pageUrl);
  const fields = [];
  form.find("input[name]").each(function (_, el) {
    const input = $(el);
    const name = input.attr("name");
    const value = input.val() || input.attr("value") || "";
    if (name) fields.push(encodeURIComponent(name) + "=" + encodeURIComponent(String(value)));
  });
  if (!fields.length || !action) return Promise.resolve([]);
  return request(action, {
    method: "POST",
    body: fields.join("&"),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": pageUrl,
      "Origin": (function () { try { return new URL(action).origin; } catch (e) { return ""; } })()
    }
  }).then(function (response) {
    const redirected = redirectFromHtml(response.data, response.url || action);
    if (redirected && redirected !== pageUrl && redirected !== action) return resolveLink(redirected);
    const extracted = mediaFromHtml(response.data, response.url || action).filter(function (link) {
      return link !== pageUrl && !/thenaukriadda/i.test(link);
    });
    const jobs = extracted.map(function (link) { return resolveLink(link); });
    if (jobs.length) {
      return Promise.all(jobs).then(function (groups) {
        const all = [];
        groups.forEach(function (group) { group.forEach(function (item) { all.push(item); }); });
        if (all.length) return all;
        return submitPublicForm(response.data, response.url || action, depth + 1);
      });
    }
    return submitPublicForm(response.data, response.url || action, depth + 1);
  }).catch(function () { return []; });
}

function resolvePublicShortener(url) {
  // TheNaukriAdda is an intermediate public link page used by UHDMovies.
  // Follow ordinary HTTP redirects and publicly exposed page redirects/forms.
  // Do not attempt CAPTCHA, login, token forgery, or anti-bot circumvention.
  return request(url).then(function (response) {
    const finalUrl = response.url || url;

    if (finalUrl !== url && !/thenaukriadda/i.test(finalUrl)) {
      return resolveLink(finalUrl);
    }

    const html = response.data || "";
    const redirected = redirectFromHtml(html, finalUrl);
    if (redirected && redirected !== finalUrl) {
      return resolveLink(redirected);
    }

    const $ = load(html);
    const candidates = [];
    const seen = {};

    function addCandidate(value) {
      const candidate = absUrl(String(value || "").trim(), finalUrl);
      if (!candidate || candidate === finalUrl || seen[candidate]) return;
      if (!/^https?:\/\//i.test(candidate)) return;
      if (/^(mailto:|javascript:)/i.test(candidate)) return;
      if (/facebook|twitter|telegram|instagram|youtube|whatsapp|t\.me/i.test(candidate)) return;
      seen[candidate] = true;
      candidates.push(candidate);
    }

    // Publicly exposed anchors and common redirect attributes.
    $("a[href], [data-href], [data-url], [data-link]").each(function (_, el) {
      const node = $(el);
      addCandidate(node.attr("href") || node.attr("data-href") ||
        node.attr("data-url") || node.attr("data-link"));
    });

    // Some pages expose the destination in a simple client-side redirect.
    const scriptPatterns = [
      /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/ig,
      /window\.open\(\s*["']([^"']+)["']/ig,
      /(?:window\.)?location\.replace\(\s*["']([^"']+)["']\s*\)/ig
    ];
    scriptPatterns.forEach(function (pattern) {
      let match;
      while ((match = pattern.exec(html)) !== null) addCandidate(match[1]);
    });

    // If an ordinary public redirect target is exposed, follow it.
    const externalCandidates = candidates.filter(function (candidate) {
      return !/thenaukriadda/i.test(candidate);
    });
    if (externalCandidates.length) {
      const jobs = externalCandidates.slice(0, 5).map(function (candidate) {
        return resolveLink(candidate);
      });
      return Promise.all(jobs).then(function (groups) {
        const output = [];
        groups.forEach(function (group) {
          group.forEach(function (item) {
            if (item && item.link && !output.some(function (old) {
              return old.link === item.link;
            })) output.push(item);
          });
        });
        if (output.length) return output;
        return submitPublicForm(html, finalUrl, 1);
      });
    }

    // Continue only through normal public HTML form submission.
    return submitPublicForm(html, finalUrl, 1);
  }).catch(function (error) {
    console.error("[CVN-UHDMovies] TheNaukriAdda resolver:", error && error.message ? error.message : String(error));
    return [];
  });
}

function resolveLink(url) {
  if (/thenaukriadda\.in/i.test(url)) return resolvePublicShortener(url);
  if (/video-seed\.dev/i.test(url)) {
    return resolveVideoSeed(url).then(function (link) {
      return link ? [{ server: "VideoSeed", link: link }] : [];
    });
  }
  if (/driveseed\.org/i.test(url)) return extractDriveSeed(url);

  if (MEDIA_RE.test(url)) {
    return Promise.resolve([{ server: "Direct", link: url }]);
  }

  // Follow regular public redirects and inspect the returned page for media URLs.
  return request(url).then(function (response) {
    const finalUrl = response.url || url;
    if (MEDIA_RE.test(finalUrl)) return [{ server: "Direct", link: finalUrl }];
    const links = mediaFromHtml(response.data, finalUrl);
    const tasks = links.map(function (link) {
      if (/video-seed\.dev/i.test(link)) {
        return resolveVideoSeed(link).then(function (resolved) {
          return resolved ? [{ server: "VideoSeed", link: resolved }] : [];
        });
      }
      if (/driveseed\.org/i.test(link)) return extractDriveSeed(link);
      if (MEDIA_RE.test(link)) return Promise.resolve([{ server: "Direct", link: link }]);
      return Promise.resolve([]);
    });
    return Promise.all(tasks).then(function (groups) {
      const out = [];
      groups.forEach(function (group) {
        group.forEach(function (item) {
          if (!out.some(function (existing) { return existing.link === item.link; })) out.push(item);
        });
      });
      return out;
    });
  }).catch(function () { return []; });
}

function getStreams(tmdbId, mediaType, season, episode) {
  const type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  return findLinks({
    tmdbId: tmdbId,
    mediaType: type,
    season: season,
    episode: episode
  }).then(function (links) {
    const limited = links.slice(0, 12);
    return Promise.all(limited.map(function (item) {
      return resolveLink(item.url).then(function (streams) {
        return streams.map(function (stream) {
          return {
            name: "CVN-UHDMovies",
            title: [item.quality, item.size, stream.server].filter(Boolean).join(" • ") || "UHDMovies Stream",
            url: stream.link,
            quality: item.quality || "Unknown",
            headers: { "Referer": item.url, "User-Agent": USER_AGENT },
            size: item.size || undefined
          };
        });
      }).catch(function () { return []; });
    })).then(function (groups) {
      const result = [];
      const seen = {};
      groups.forEach(function (group) {
        group.forEach(function (stream) {
          if (!stream.url || seen[stream.url]) return;
          seen[stream.url] = true;
          result.push(stream);
        });
      });
      return result;
    });
  }).catch(function (error) {
    console.error("[CVN-UHDMovies] Provider error:", error && error.message ? error.message : String(error));
    return [];
  });
}

module.exports = { getStreams: getStreams };
