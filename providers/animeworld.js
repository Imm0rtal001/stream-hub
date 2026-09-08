"use strict";

// ---------------------------------------------------------------------------
// Inlined dependency-free HTML/selector engine (replaces cheerio /
// cheerio-without-node-native). Kept in sync with lib/micro-cheerio.js; the
// standalone copy there is canonical and unit-tested — this file stays fully
// self-contained (no cross-file require) for maximum runtime portability,
// since Nuvio's sandbox may not resolve relative local requires.
// ---------------------------------------------------------------------------
const cheerio = (function () {
  /**
   * micro-cheerio — a tiny, dependency-free stand-in for `cheerio` /
   * `cheerio-without-node-native`, covering exactly the API surface this
   * repo's providers use: load(html), $(selector|element), .text(), .html(),
   * .attr(), .each(), .find(), .filter(), .map(), .get(), .first(), .last(),
   * .next(), .parent(), .length, and $.html().
   *
   * Selector grammar supported: tag, #id, .class (chainable, e.g. a.btn.big),
   * [attr] / [attr="v"] / [attr*="v"] / [attr^="v"] / [attr$="v"], descendant
   * (space) and child (>) combinators, comma-separated groups. That covers
   * every selector string actually used in providers/*.js — this is not a
   * general-purpose CSS engine, on purpose, to stay small and predictable.
   *
   * No external dependencies: only Node's built-in JS runtime is required, so
   * it also runs unmodified inside Nuvio's JS sandbox (which cannot resolve
   * npm packages).
   */

  // ---------------------------------------------------------------------------
  // HTML tokenizer / tree builder
  // ---------------------------------------------------------------------------

  const VOID_ELEMENTS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
  ]);
  const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

  const ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  };

  function decodeEntities(str) {
    if (!str || str.indexOf("&") === -1) return str;
    return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent) => {
      if (ent[0] === "#") {
        const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, ent) ? ENTITIES[ent] : m;
    });
  }

  function parseAttrs(str) {
    const attribs = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|[^\s"'=<>`]+))?/g;
    let m;
    while ((m = re.exec(str))) {
      const name = m[1].toLowerCase();
      let value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[2];
      if (value === undefined) value = "";
      attribs[name] = decodeEntities(value);
    }
    return attribs;
  }

  /** Parses an HTML string into a lightweight DOM tree. Lenient on purpose —
   * real scraped pages are rarely well-formed. */
  function parseHTML(html) {
    let idxCounter = 0;
    const root = { type: "root", tag: "#root", attribs: {}, children: [], parent: null, _idx: idxCounter++ };
    const stack = [root];
    const src = String(html || "");
    const len = src.length;
    let pos = 0;

    function top() {
      return stack[stack.length - 1];
    }
    function pushText(text) {
      if (!text) return;
      top().children.push({ type: "text", data: decodeEntities(text), parent: top() });
    }

    while (pos < len) {
      const lt = src.indexOf("<", pos);
      if (lt === -1) {
        pushText(src.slice(pos));
        break;
      }
      if (lt > pos) pushText(src.slice(pos, lt));

      if (src.startsWith("<!--", lt)) {
        const end = src.indexOf("-->", lt + 4);
        pos = end === -1 ? len : end + 3;
        continue;
      }
      if (src.startsWith("<!", lt) || src.startsWith("<?", lt)) {
        const end = src.indexOf(">", lt);
        pos = end === -1 ? len : end + 1;
        continue;
      }
      if (src.startsWith("</", lt)) {
        const m = /^<\/\s*([a-zA-Z][\w-]*)\s*>/.exec(src.slice(lt));
        if (!m) {
          pos = lt + 2;
          continue;
        }
        const name = m[1].toLowerCase();
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === name) {
            stack.length = i;
            break;
          }
        }
        pos = lt + m[0].length;
        continue;
      }
      // opening tag
      const tagMatch = /^<([a-zA-Z][\w-]*)/.exec(src.slice(lt));
      if (!tagMatch) {
        pushText(src[lt]);
        pos = lt + 1;
        continue;
      }
      const tagName = tagMatch[1].toLowerCase();
      let cursor = lt + tagMatch[0].length;
      // scan forward to the matching closing '>' honoring quoted attr values
      let inQuote = null;
      let closeAt = -1;
      for (let i = cursor; i < len; i++) {
        const ch = src[i];
        if (inQuote) {
          if (ch === inQuote) inQuote = null;
        } else if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (ch === ">") {
          closeAt = i;
          break;
        }
      }
      if (closeAt === -1) {
        pos = len;
        break;
      }
      const rawInner = src.slice(cursor, closeAt);
      const selfClosing = /\/\s*$/.test(rawInner);
      const attribs = parseAttrs(selfClosing ? rawInner.replace(/\/\s*$/, "") : rawInner);
      pos = closeAt + 1;

      const el = { type: "tag", tag: tagName, attribs, children: [], parent: top(), _idx: idxCounter++ };
      top().children.push(el);

      if (VOID_ELEMENTS.has(tagName) || selfClosing) {
        continue; // never pushed onto the stack
      }

      if (RAW_TEXT_ELEMENTS.has(tagName)) {
        const closeTagRe = new RegExp("</" + tagName + "\\s*>", "i");
        const rest = src.slice(pos);
        const m = closeTagRe.exec(rest);
        const rawText = m ? rest.slice(0, m.index) : rest;
        if (rawText) el.children.push({ type: "text", data: rawText, parent: el });
        pos = m ? pos + m.index + m[0].length : len;
        continue;
      }

      stack.push(el);
    }

    return root;
  }

  // ---------------------------------------------------------------------------
  // Serialization / text extraction
  // ---------------------------------------------------------------------------

  function escapeHTML(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function serializeAttribs(attribs) {
    return Object.keys(attribs)
      .map((k) => ` ${k}="${escapeHTML(attribs[k])}"`)
      .join("");
  }

  function serializeNode(node) {
    if (node.type === "text") return escapeHTML(node.data);
    if (node.type === "root") return node.children.map(serializeNode).join("");
    if (VOID_ELEMENTS.has(node.tag)) return `<${node.tag}${serializeAttribs(node.attribs)}>`;
    const inner = node.children.map(serializeNode).join("");
    return `<${node.tag}${serializeAttribs(node.attribs)}>${inner}</${node.tag}>`;
  }

  function serializeInner(node) {
    if (!node) return null;
    return node.children.map(serializeNode).join("");
  }

  function getText(node) {
    if (node.type === "text") return node.data;
    if (!node.children) return "";
    return node.children.map(getText).join("");
  }

  // ---------------------------------------------------------------------------
  // Selector engine
  // ---------------------------------------------------------------------------

  function splitTopLevel(str, separator) {
    const parts = [];
    let depth = 0;
    let cur = "";
    for (const ch of str) {
      if (ch === "[") depth++;
      if (ch === "]") depth = Math.max(0, depth - 1);
      if (ch === separator && depth === 0) {
        parts.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    parts.push(cur);
    return parts;
  }

  function parseCompound(token) {
    const compound = { tag: null, id: null, classes: [], attrs: [] };
    const re = /(^[a-zA-Z*][\w-]*)|(\.[\w-]+)|(#[\w-]+)|(\[[^\]]+\])/g;
    let m;
    let matched = false;
    while ((m = re.exec(token))) {
      matched = true;
      const piece = m[0];
      if (piece[0] === ".") {
        compound.classes.push(piece.slice(1));
      } else if (piece[0] === "#") {
        compound.id = piece.slice(1);
      } else if (piece[0] === "[") {
        const content = piece.slice(1, -1);
        const am = /^([a-zA-Z_:][\w-]*)\s*(?:([*^$]?=)\s*(?:"([^"]*)"|'([^']*)'|([^"'\]]*)))?$/.exec(content);
        if (am) {
          const name = am[1].toLowerCase();
          const op = am[2] || null;
          const value = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : am[5];
          compound.attrs.push({ name, op, value });
        }
      } else if (piece !== "*") {
        compound.tag = piece.toLowerCase();
      }
    }
    return matched ? compound : null;
  }

  function splitSteps(group) {
    const normalized = group.trim().replace(/\s*>\s*/g, " > ");
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const steps = [];
    let combinator = "descendant";
    for (const tok of tokens) {
      if (tok === ">") {
        combinator = "child";
        continue;
      }
      const compound = parseCompound(tok);
      if (compound) steps.push({ combinator, compound });
      combinator = "descendant";
    }
    return steps;
  }

  function matchCompound(el, compound) {
    if (el.type !== "tag") return false;
    if (compound.tag && el.tag !== compound.tag) return false;
    if (compound.id && (el.attribs.id || "") !== compound.id) return false;
    if (compound.classes.length) {
      const elClasses = (el.attribs.class || "").trim().split(/\s+/).filter(Boolean);
      for (const c of compound.classes) {
        if (elClasses.indexOf(c) === -1) return false;
      }
    }
    for (const attr of compound.attrs) {
      const value = el.attribs[attr.name];
      if (attr.op === null) {
        if (value === undefined) return false;
      } else if (value === undefined) {
        return false;
      } else if (attr.op === "=" && value !== attr.value) {
        return false;
      } else if (attr.op === "*=" && value.indexOf(attr.value) === -1) {
        return false;
      } else if (attr.op === "^=" && value.indexOf(attr.value) !== 0) {
        return false;
      } else if (attr.op === "$=" && value.slice(-attr.value.length) !== attr.value) {
        return false;
      }
    }
    return true;
  }

  function* descendants(node) {
    for (const child of node.children || []) {
      if (child.type === "tag") {
        yield child;
        yield* descendants(child);
      }
    }
  }

  function* childElements(node) {
    for (const child of node.children || []) {
      if (child.type === "tag") yield child;
    }
  }

  function queryAll(contextNodes, selectorString) {
    const groups = splitTopLevel(selectorString, ",").map((g) => g.trim()).filter(Boolean);
    const found = new Map(); // _idx -> el, for identity dedupe

    for (const group of groups) {
      const steps = splitSteps(group);
      let current = contextNodes;
      for (const step of steps) {
        const next = [];
        const seen = new Set();
        for (const scopeNode of current) {
          const pool = step.combinator === "child" ? childElements(scopeNode) : descendants(scopeNode);
          for (const el of pool) {
            if (!seen.has(el) && matchCompound(el, step.compound)) {
              seen.add(el);
              next.push(el);
            }
          }
        }
        current = next;
      }
      for (const el of current) found.set(el._idx, el);
    }

    return Array.from(found.values()).sort((a, b) => a._idx - b._idx);
  }

  // ---------------------------------------------------------------------------
  // Cheerio-like wrapper API
  // ---------------------------------------------------------------------------

  class ArrayResult {
    constructor(arr) {
      this._arr = arr;
    }
    get(i) {
      return i === undefined ? this._arr.slice() : this._arr[i];
    }
  }

  class Cheerio {
    constructor(elements, root) {
      this._els = elements || [];
      this._root = root;
    }
    get length() {
      return this._els.length;
    }
    each(fn) {
      this._els.forEach((el, i) => fn(i, el));
      return this;
    }
    map(fn) {
      return new ArrayResult(this._els.map((el, i) => fn(i, el)));
    }
    filter(fn) {
      return new Cheerio(
        this._els.filter((el, i) => fn(i, el)),
        this._root
      );
    }
    first() {
      return new Cheerio(this._els.slice(0, 1), this._root);
    }
    last() {
      return new Cheerio(this._els.slice(-1), this._root);
    }
    eq(i) {
      const el = this._els[i];
      return new Cheerio(el ? [el] : [], this._root);
    }
    get(i) {
      return i === undefined ? this._els.slice() : this._els[i];
    }
    text() {
      return this._els.map(getText).join("");
    }
    html() {
      if (!this._els.length) return null;
      return serializeInner(this._els[0]);
    }
    attr(name) {
      if (!this._els.length) return undefined;
      return this._els[0].attribs ? this._els[0].attribs[String(name).toLowerCase()] : undefined;
    }
    find(selector) {
      return new Cheerio(queryAll(this._els, selector), this._root);
    }
    next() {
      const out = [];
      for (const el of this._els) {
        const siblings = (el.parent && el.parent.children) || [];
        const i = siblings.indexOf(el);
        for (let j = i + 1; j < siblings.length; j++) {
          if (siblings[j].type === "tag") {
            out.push(siblings[j]);
            break;
          }
        }
      }
      return new Cheerio(out, this._root);
    }
    parent() {
      const out = [];
      const seen = new Set();
      for (const el of this._els) {
        if (el.parent && el.parent.type === "tag" && !seen.has(el.parent)) {
          seen.add(el.parent);
          out.push(el.parent);
        }
      }
      return new Cheerio(out, this._root);
    }
  }

  function load(html) {
    const root = parseHTML(html);
    function $(selectorOrEl) {
      if (typeof selectorOrEl === "string") {
        return new Cheerio(queryAll([root], selectorOrEl), root);
      }
      if (selectorOrEl && selectorOrEl.type === "tag") {
        return new Cheerio([selectorOrEl], root);
      }
      if (Array.isArray(selectorOrEl)) {
        return new Cheerio(selectorOrEl, root);
      }
      return new Cheerio([], root);
    }
    $.html = () => serializeInner(root);
    $.root = () => new Cheerio([root], root);
    return $;
  }
  return { load };
})();
const TMDB_API_URL = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "307b7b8ef035c6aa336900aef4e203bd";
const BASE_URL = "https://watchanimeworld.one";
const PLAYER_BASE_URL = "https://play.zephyrix.org";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const HEADER = { "User-Agent": USER_AGENT };

async function performGetRequest(url, headers = {}) {
  const response = await fetch(url, { headers: { ...HEADER, ...headers } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function performPostRequest(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...HEADER, "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchFromTmdb(path) {
  try {
    const response = await fetch(`${TMDB_API_URL}/${path}?api_key=${TMDB_API_KEY}`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function searchAnimeSite(title, mediaType) {
  try {
    const response = await performGetRequest(`${BASE_URL}/?s=${encodeURIComponent(title)}`, { "Referer": `${BASE_URL}/` });
    const html = await response.text();
    const $ = cheerio.load(html);
    const seenUrls = new Set();
    const results = [];

    $("a[href]").each((_, element) => {
      const href = $(element).attr("href") || "";
      const match = href.match(/^https?:\/\/[^/]+\/(series|movies)\/([^/]+)\//);
      if (!match || match[2] === "page" || seenUrls.has(href)) return;
      const isCorrectType = mediaType === "movie" ? match[1] === "movies" : match[1] === "series";
      if (!isCorrectType) return;
      seenUrls.add(href);
      results.push(href);
    });

    return results;
  } catch {
    return [];
  }
}

async function resolveEpisodeUrl(seriesUrl, seasonNumber, episodeNumber) {
  const response = await performGetRequest(seriesUrl, { "Referer": `${BASE_URL}/` });
  const html = await response.text();
  const epPattern = `${seasonNumber}x${episodeNumber}`;
  const postIdMatch = html.match(/postid-(\d+)/) || html.match(/data-post="(\d+)"/);

  if (postIdMatch) {
    try {
      const ajaxResponse = await performGetRequest(
        `${BASE_URL}/wp-admin/admin-ajax.php?action=action_select_season&season=${seasonNumber}&post=${postIdMatch[1]}`,
        { "Referer": seriesUrl }
      );
      const ajaxHtml = await ajaxResponse.text();
      const url = findEpisodeInHtml(ajaxHtml, epPattern);
      if (url) return url;
    } catch {
      // fall through
    }
  }

  return findEpisodeInHtml(html, epPattern);
}

function findEpisodeInHtml(html, epPattern) {
  const re = /href="(https?:\/\/[^"]+\/episode\/([^"]+))"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].includes(epPattern) || m[2].includes(epPattern)) return m[1];
  }
  return null;
}

async function extractStreamData(pageUrl) {
  const response = await performGetRequest(pageUrl, { "Referer": `${BASE_URL}/` });
  const html = await response.text();

  let streamMatch = html.match(/(?:src|data-src)="(https?:\/\/play\.[^"]+\/video\/([a-f0-9]+))"/i);
  if (!streamMatch) {
    const loose = html.match(/https?:\/\/play\.(zephyrflick|zephyrix)\.[^/\s"]+\/video\/([a-f0-9]+)/i);
    if (loose) streamMatch = [null, `${PLAYER_BASE_URL}/video/${loose[2]}`, loose[2]];
  }
  if (!streamMatch) return null;

  const playerPageUrl = streamMatch[1];
  const videoHash = streamMatch[2];

  let sessionCookie = "";
  try {
    const playerPageRes = await fetch(playerPageUrl, {
      headers: { ...HEADER, "Referer": `${BASE_URL}/` }
    });
    const rawCookie = playerPageRes.headers.get("set-cookie") || "";
    sessionCookie = rawCookie
      .split(/,(?=[^;]+=[^;]+)/)
      .map(c => c.trim().split(";")[0])
      .filter(Boolean)
      .join("; ");
  } catch {
    // non-fatal
  }

  const postHeaders = {
    "Referer": playerPageUrl,
    "Origin": PLAYER_BASE_URL,
    "X-Requested-With": "XMLHttpRequest",
    ...(sessionCookie ? { "Cookie": sessionCookie } : {})
  };

  const postData = await performPostRequest(
    `${PLAYER_BASE_URL}/player/index.php?data=${videoHash}&do=getVideo`,
    `hash=${videoHash}&r=${encodeURIComponent(`${BASE_URL}/`)}`,
    postHeaders
  );

  const m3u8Url = postData.securedLink || postData.videoSource || postData.source || postData.file;
  if (!m3u8Url) return null;

  const hashMatch = m3u8Url.match(/\/cdn\/hls\/([a-f0-9]+)\//);
  const contentHash = hashMatch ? hashMatch[1] : videoHash;

  return {
    url: m3u8Url,
    streamHeaders: {
      "Referer": `${PLAYER_BASE_URL}/`,
      "Origin": PLAYER_BASE_URL,
      "User-Agent": USER_AGENT,
      ...(sessionCookie ? { "Cookie": sessionCookie } : {})
    },
    subtitle: `${PLAYER_BASE_URL}/cdn/down/${contentHash}/Subtitle/subtitle_eng.srt`
  };
}

async function getStreams(tmdbId, mediaType = "tv", seasonNumber = 1, episodeNumber = 1) {
  try {
    if (mediaType === "tv" && (seasonNumber == null || episodeNumber == null)) return [];

    const [mediaEntry, seasonEpisodes] = await Promise.all([
      fetchFromTmdb(`${mediaType}/${tmdbId}`),
      mediaType === "tv" ? fetchFromTmdb(`tv/${tmdbId}/season/${seasonNumber}`) : Promise.resolve(null)
    ]);

    if (!mediaEntry) return [];
    const mediaTitle = mediaEntry.name || mediaEntry.title;
    if (!mediaTitle) return [];

    if (mediaType === "tv" && seasonEpisodes?.episodes) {
      const episodeNumberInt = parseInt(episodeNumber, 10) || 1;
      seasonEpisodes.episodes.find(ep => ep.episode_number === episodeNumberInt);
    }

    const searchResults = await searchAnimeSite(mediaTitle, mediaType);
    if (!searchResults.length) return [];

    let streamData = null;

    if (mediaType === "movie") {
      streamData = await extractStreamData(searchResults[0]);
    } else {
      let episodeUrl = await resolveEpisodeUrl(searchResults[0], seasonNumber, episodeNumber);
      if (!episodeUrl && seasonNumber !== 1) {
        episodeUrl = await resolveEpisodeUrl(searchResults[0], 1, episodeNumber);
      }
      if (episodeUrl) streamData = await extractStreamData(episodeUrl);
    }

    if (!streamData) return [];

    return [{
      name: "AnimeWorld • Zephyrix",
      title: "AnimeWorld • Zephyrix",
      url: streamData.url,
      quality: "1080p",
      headers: streamData.streamHeaders,
      subtitles: streamData.subtitle
        ? [{ url: streamData.subtitle, language: "en", name: "English" }]
        : []
    }];
  } catch {
    return [];
  }
}

module.exports = { getStreams };
