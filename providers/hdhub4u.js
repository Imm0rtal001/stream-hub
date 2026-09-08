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
const BASE_URL = "https://new5.hdhub4u.cl";
const SEARCH_ENDPOINT = "https://search.pingora.fyi/collections/post/documents/search";
const TMDB_ENDPOINT = "https://api.themoviedb.org/3";
const TMDB_KEY = "307b7b8ef035c6aa336900aef4e203bd";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36";
const DEFAULT_HEADERS = { "User-Agent": USER_AGENT, Cookie: "xla=s4t", Referer: `${BASE_URL}/` };
const BLOCKED_WORKER_SUBDOMAINS = ["terapiyo232", "pinajo4039500"];
function request(url_1) {
    return __awaiter(this, arguments, void 0, function* (url, options = {}) {
        const res = yield fetch(url, options);
        if (!res.ok)
            throw new Error(`HTTP ${res.status}: ${url}`);
        return res.text();
    });
}
function decodeBase64(value) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    const input = String(value || "").replace(/=+$/, "");
    let output = "", position = 0, accumulator, current, index = 0;
    while ((current = input.charAt(index++))) {
        current = alphabet.indexOf(current);
        if (current < 0)
            continue;
        accumulator = position % 4 ? accumulator * 64 + current : current;
        if (position++ % 4)
            output += String.fromCharCode((accumulator >> (-2 * position & 6)) & 255);
    }
    return output;
}
function caesarCipher(value) {
    return String(value || "").replace(/[a-zA-Z]/g, (char) => {
        const code = char.charCodeAt(0) + 13;
        return String.fromCharCode(code <= (char <= "Z" ? 90 : 122) ? code : code - 26);
    });
}
function resolveUrl(value, base = BASE_URL) {
    if (!value)
        return "";
    if (/^https?:\/\//i.test(value))
        return value;
    try {
        return new URL(value, base).toString();
    }
    catch (_a) {
        return "";
    }
}
function dedupeByUrl(streams) {
    const seen = new Set();
    return streams.filter(s => s.url && !seen.has(s.url) && seen.add(s.url));
}
function stripTitleArticles(value) {
    return String(value || "").toLowerCase()
        .replace(/\b(the|a|an)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ").trim();
}
function scoreTitleMatch(expected, candidate, expectedYear, candidateYear) {
    const expectedTokens = stripTitleArticles(expected).split(" ").filter(Boolean);
    const candidateTokens = stripTitleArticles(candidate).split(" ").filter(Boolean);
    if (!expectedTokens.length || !candidateTokens.length)
        return 0;
    const candidateSet = new Set(candidateTokens);
    const hits = expectedTokens.filter(t => candidateSet.has(t)).length;
    let score = hits / expectedTokens.length;
    if (expectedTokens.every(t => candidateSet.has(t)))
        score += 0.25;
    if (expectedYear && candidateYear === expectedYear)
        score += 0.25;
    else if (expectedYear && candidateYear && Math.abs(candidateYear - expectedYear) > 1)
        score -= 0.5;
    return score;
}
function parseSize(text) {
    const match = String(text || "").match(/([\d.]+)\s*(GB|MB|KB)/i);
    return match ? `${match[1]} ${match[2].toUpperCase()}` : "Unknown";
}
function parseQuality(t) {
    if (/\b(?:2160p|4k)\b/i.test(t))
        return "2160p";
    const match = String(t || "").match(/\b(1080|720|480|1440)p\b/i);
    return match ? `${match[1]}p` : null;
}
function isStreamable(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (host.endsWith(".workers.dev")) {
            const sub = host.slice(0, -".workers.dev".length).split(".").pop();
            if (BLOCKED_WORKER_SUBDOMAINS.includes(sub))
                return false;
        }
        return host.endsWith(".r2.cloudflarestorage.com") || host.endsWith(".workers.dev");
    }
    catch (_a) {
        return false;
    }
}
function sizeInGB(text) {
    const match = String(text || "").match(/([\d.]+)\s*(GB|MB|KB)/i);
    if (!match)
        return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    return unit === "GB" ? value : unit === "MB" ? value / 1024 : value / (1024 * 1024);
}
function formatTitle(t, size) {
    t = String(t || "");
    size = size || "Unknown";
    const src = /bluray|blu\-ray|bdrip/i.test(t) ? "Blu-ray" : /hdrip|webrip/i.test(t) ? "WEBRip" : "WEB-DL";
    const imax = /imax/i.test(t) ? " • IMAX" : "";
    const range = /dolby\s*vision|dovi/i.test(t) ? "Dolby Vision" : /hdr10/i.test(t) ? "HDR10" : /hdr/i.test(t) ? "HDR" : /10bit|10\-bit/i.test(t) ? "10-Bit" : /sdr/i.test(t.toLowerCase()) ? "SDR" : "";
    const codec = /hevc|x265|h265/i.test(t) ? "H.265" : "H.264";
    let audio = "AAC";
    const am = t.match(/(TrueHD\s*7\.1|DDP\s*7\.1|DDP\s*5\.1|DD\s*5\.1|5\.1|AAC)/i);
    if (am) {
        audio = am[1].toUpperCase().replace(/\s+/g, "");
        if (audio === "5.1")
            audio = "DDP5.1";
        if (audio.includes("TRUEHD"))
            audio = "TrueHD 7.1";
    }
    else if (/dolby\s*digital|dd/i.test(t)) {
        audio = "Dolby Digital";
    }
    if (/atmos/i.test(t))
        audio += " • Atmos";
    const langs = /dual|hindi\-eng|eng\-hin/i.test(t) ? "English • Hindi"
        : ([/english|eng/i.test(t) && "English", /hindi|hin/i.test(t) && "Hindi"].filter(Boolean).join(" • ") || "English");
    const line1 = `${langs}${size !== "Unknown" ? ` • ${size}` : ""}`;
    const line2 = `${src}${imax} • ${audio}${range ? " • " + range : ""} • ${codec}`;
    return `${line1}\n${line2}`;
}
function fetchTmdbMetadata(tmdbId, mediaType) {
    return __awaiter(this, void 0, void 0, function* () {
        const type = mediaType === "tv" ? "tv" : "movie";
        const res = yield fetch(`${TMDB_ENDPOINT}/${type}/${encodeURIComponent(tmdbId)}?api_key=${TMDB_KEY}`, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
        if (!res.ok)
            throw new Error(`TMDB HTTP ${res.status}`);
        const data = yield res.json();
        const releaseDate = type === "tv" ? data.first_air_date : data.release_date;
        return {
            title: type === "tv" ? data.name : data.title,
            year: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
        };
    });
}
function searchCatalog(query) {
    return __awaiter(this, void 0, void 0, function* () {
        const today = new Date().toISOString().slice(0, 10);
        const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}&query_by=post_title,category&query_by_weights=4,2&sort_by=sort_by_date:desc&limit=15&highlight_fields=none&use_cache=true&page=1&analytics_tag=${today}`;
        const res = yield fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok)
            throw new Error(`Search HTTP ${res.status}`);
        const data = yield res.json();
        return (data.hits || []).map(({ document }) => {
            const title = document.post_title || "";
            const yearMatch = title.match(/\b(19|20)\d{2}\b/);
            return { title, year: yearMatch ? Number(yearMatch[0]) : null, url: resolveUrl(document.permalink) };
        });
    });
}
function pickBestMatch(metadata, candidates, mediaType, season) {
    let best = null;
    for (const candidate of candidates) {
        let score = scoreTitleMatch(metadata.title, candidate.title, metadata.year, candidate.year);
        if (mediaType === "tv" && season) {
            const seasonMatch = candidate.title.match(/(?:season\s*|s)(\d+)/i);
            if (seasonMatch && Number(seasonMatch[1]) === Number(season))
                score += 0.5;
            else if (seasonMatch)
                score -= 0.75;
        }
        if (!best || score > best.score)
            best = Object.assign({}, candidate, { score });
    }
    return best && best.score >= 0.6 ? best : null;
}
function unwrapRedirect(url) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const html = yield request(url, { headers: DEFAULT_HEADERS });
            const pattern = /s\s*\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]|ck\s*\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/g;
            let encoded = "", match;
            while ((match = pattern.exec(html)))
                encoded += match[1] || match[2] || "";
            if (!encoded) {
                const redirect = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
                return redirect ? resolveUrl(redirect[1], url) : "";
            }
            const decoded = decodeBase64(caesarCipher(decodeBase64(decodeBase64(encoded))));
            const payload = JSON.parse(decoded);
            const direct = decodeBase64(payload.o || "").trim();
            if (direct)
                return direct;
            const token = decodeBase64(payload.data || "").trim();
            const blogUrl = String(payload.blog_url || "").trim();
            if (!blogUrl || !token)
                return "";
            const body = yield request(`${blogUrl}?re=${token}`, { headers: DEFAULT_HEADERS });
            return cheerio.load(body)("body").text().trim();
        }
        catch (_a) {
            return "";
        }
    });
}
function scrapeHubCloud(url, referer) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let pageUrl = url.replace("hubcloud.ink", "hubcloud.dad");
            let html = yield request(pageUrl, { headers: Object.assign({}, DEFAULT_HEADERS, { Referer: referer }) });
            if (!pageUrl.includes("hubcloud.php")) {
                const $page = cheerio.load(html);
                const nextUrl = $page("#download").attr("href") || (html.match(/var url\s*=\s*['"]([^'"]+)/) || [])[1];
                if (nextUrl) {
                    pageUrl = resolveUrl(nextUrl, pageUrl);
                    html = yield request(pageUrl, { headers: Object.assign({}, DEFAULT_HEADERS, { Referer: url }) });
                }
            }
            const $ = cheerio.load(html);
            const header = $("div.card-header").text().replace(/\s+/g, " ").trim();
            const size = parseSize($("i#size").text().trim());
            const streams = [];
            $("a.btn[href]").each((_, el) => {
                const href = $(el).attr("href");
                if (href && isStreamable(href))
                    streams.push({ url: href, size, title: header });
            });
            return streams;
        }
        catch (_a) {
            return [];
        }
    });
}
function resolveStreamUrl(url_1, referer_1) {
    return __awaiter(this, arguments, void 0, function* (url, referer, depth = 0) {
        if (!url || depth > 4)
            return [];
        const absolute = resolveUrl(url, referer);
        if (!absolute)
            return [];
        if (isStreamable(absolute))
            return [{ url: absolute, size: "Unknown", title: "" }];
        let host;
        try {
            host = new URL(absolute).hostname.toLowerCase();
        }
        catch (_a) {
            return [];
        }
        if (host.includes("hubcloud"))
            return scrapeHubCloud(absolute, referer);
        if (host.includes("hubdrive")) {
            try {
                const html = yield request(absolute, { headers: Object.assign({}, DEFAULT_HEADERS, { Referer: referer }) });
                const $ = cheerio.load(html);
                const next = $("a.btn.btn-primary.btn-user.btn-success1[href], a.btn-success[href]").first().attr("href");
                return next ? resolveStreamUrl(next, absolute, depth + 1) : [];
            }
            catch (_b) {
                return [];
            }
        }
        if (absolute.includes("?id=") || /techyboy4u|gadgetsweb|cryptoinsights|bloggingvector|ampproject/.test(host)) {
            const unwrapped = yield unwrapRedirect(absolute);
            return unwrapped ? resolveStreamUrl(unwrapped, absolute, depth + 1) : [];
        }
        if (host.includes("hblinks") || host.includes("hubstream.dad")) {
            try {
                const html = yield request(absolute, { headers: Object.assign({}, DEFAULT_HEADERS, { Referer: referer }) });
                const $ = cheerio.load(html);
                const links = $("h3 a[href], h4 a[href], h5 a[href], .entry-content a[href]")
                    .map((_, el) => $(el).attr("href")).get();
                return (yield Promise.all(links.map(link => resolveStreamUrl(link, absolute, depth + 1)))).flat();
            }
            catch (_c) {
                return [];
            }
        }
        return [];
    });
}
function scrapeMediaPage(pageUrl, mediaType, targetEpisode) {
    return __awaiter(this, void 0, void 0, function* () {
        const html = yield request(pageUrl, { headers: Object.assign({}, DEFAULT_HEADERS, { Referer: `${BASE_URL}/` }) });
        const $ = cheerio.load(html);
        const candidates = [];
        if (mediaType === "movie") {
            $("h3 a[href], h4 a[href], .page-body a[href]").each((_, el) => {
                const anchor = $(el);
                const href = anchor.attr("href");
                const context = `${anchor.text()} ${anchor.parent().text()}`;
                if (href && (/480|720|1080|2160|4k/i.test(context) || /hubcloud|hblinks|hubstream|hdstream4u/i.test(href))) {
                    candidates.push({ url: href, episode: null });
                }
            });
        }
        else {
            $("h3, h4").each((_, el) => {
                const heading = $(el);
                const episodeMatch = heading.text().match(/(?:episode\s*|e)(\d+)/i);
                if (!episodeMatch)
                    return;
                const ep = Number(episodeMatch[1]);
                heading.find("a[href]").each((__, anchor) => { candidates.push({ url: $(anchor).attr("href"), episode: ep }); });
            });
        }
        const targets = candidates.filter(c => mediaType === "movie" || targetEpisode == null || c.episode === Number(targetEpisode));
        const results = yield Promise.all(targets.map((c) => __awaiter(this, void 0, void 0, function* () {
            const streams = yield resolveStreamUrl(c.url, pageUrl);
            return streams.map(s => Object.assign({}, s, { episode: c.episode }));
        })));
        return results.flat();
    });
}
function getStreams(tmdbId_1) {
    return __awaiter(this, arguments, void 0, function* (tmdbId, mediaType = "movie", season = null, episode = null) {
        if (!tmdbId)
            return [];
        if (mediaType !== "movie" && mediaType !== "tv")
            return [];
        if (mediaType === "tv" && (season == null || episode == null))
            return [];
        try {
            const metadata = yield fetchTmdbMetadata(tmdbId, mediaType);
            const query = mediaType === "tv" && season ? `${metadata.title} Season ${season}` : metadata.title;
            const match = pickBestMatch(metadata, yield searchCatalog(query), mediaType, season);
            if (!match)
                return [];
            const raw = yield scrapeMediaPage(match.url, mediaType, episode);
            const seen = new Set();
            const streams = [];
            for (const s of raw) {
                if (!isStreamable(s.url))
                    continue;
                if (sizeInGB(s.size) < 1.2)
                    continue;
                if (seen.has(s.url))
                    continue;
                seen.add(s.url);
                const quality = parseQuality(s.title);
                const formatted = formatTitle(s.title, s.size);
                streams.push({
                    name: `HDHub4u${quality ? ` • ${quality}` : ""}`,
                    title: `HDHub4u${quality ? ` • ${quality}` : ""}`,
                    url: s.url,
                    size: formatted,
                });
            }
            return streams;
        }
        catch (e) {
            return [];
        }
    });
}
module.exports = { getStreams };
