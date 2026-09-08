"use strict"

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
const TMDB_KEY = "307b7b8ef035c6aa336900aef4e203bd";
const BASE_URL = "https://new3.moviesdrive.christmas";
const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  "Connection": "keep-alive",
};

const HUBCLOUD_SERVER_LABELS = new Map([
  ["r2.dev", "Direct R2"],
  ["workers.dev", "ZipDisk"],
  ["fsl server", "FSL"],
  ["s3 server", "S3"],
  ["fslv2", "FSLv2"],
  ["mega server", "Mega"],
]);

async function fetchTmdbMeta(tmdbId, mediaType) {
  try {
    const type = mediaType === "tv" ? "tv" : "movie";
    const res = await fetch(
      `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=external_ids`,
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title || data.name || "",
      imdbId: data.external_ids?.imdb_id ?? null,
    };
  } catch {
    return null;
  }
}

async function extractHubCloudLinks(url, referer) {
  try {
    let currentUrl = url.replace("hubcloud.ink", "hubcloud.dad");
    let html = await (await fetch(currentUrl, { headers: { ...REQUEST_HEADERS, Referer: referer } })).text();

    if (!currentUrl.includes("hubcloud.php")) {
      const $first = cheerio.load(html);
      let nextUrl = $first("#download").attr("href")
        || (html.match(/var url = '([^']*)'/) || [])[1]
        || "";

      if (nextUrl) {
        if (!nextUrl.startsWith("http")) {
          const base = new URL(currentUrl);
          nextUrl = `${base.protocol}//${base.hostname}/${nextUrl.replace(/^\//, "")}`;
        }
        html = await (await fetch(nextUrl, { headers: { ...REQUEST_HEADERS, Referer: currentUrl } })).text();
        currentUrl = nextUrl;
      }
    }

    const $ = cheerio.load(html);
    const size = $("i#size").text().trim();
    const header = $("div.card-header").text().trim();
    const qMatch = header.match(/(\d{3,4})[pP]/);
    const quality = qMatch ? parseInt(qMatch[1]) : 1080;

    const results = [];
    for (const el of $("a.btn").get()) {
      const link = $(el).attr("href") || "";
      const text = $(el).text().toLowerCase();

      const isValidLink =
        text.includes("download file") ||
        text.includes("fsl server") ||
        text.includes("s3 server") ||
        text.includes("fslv2") ||
        text.includes("mega server") ||
        link.includes("r2.dev");

      if (!isValidLink) continue;

      let serverLabel = "HubCloud";
      for (const [key, label] of HUBCLOUD_SERVER_LABELS) {
        if (link.includes(key) || text.includes(key)) { serverLabel = label; break; }
      }

      results.push({ name: serverLabel, quality, url: link, size });
    }

    return results;
  } catch {
    return [];
  }
}

async function dispatchExtractor(url, referer) {
  try {
    const host = new URL(url).hostname;
    if (host.includes("hubcloud")) return extractHubCloudLinks(url, referer);
    return [];
  } catch {
    return [];
  }
}

async function resolveServerLinks(url) {
  try {
    const html = await (await fetch(url, { headers: { ...REQUEST_HEADERS } })).text();

    if (url.includes("search-recover.php")) {
      const qMatch = html.match(/const Q_INITIAL\s*=\s*"([^"]+)"/);
      const tokenMatch = html.match(/const FROM_AC_TOKEN\s*=\s*"([^"]+)"/);

      if (qMatch && tokenMatch) {
        const base = url.split("?")[0];
        const params = new URLSearchParams({ api: "search", q: qMatch[1], page: "1", from_ac: tokenMatch[1] });
        const data = await (await fetch(`${base}?${params}`, {
          headers: { ...REQUEST_HEADERS, Accept: "application/json" },
        })).json();
        if (data.hits) return data.hits.map(h => h.url).filter(Boolean);
      }
    }

    const $ = cheerio.load(html);
    return $("a[href]")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(href => /hubcloud/i.test(href));
  } catch {
    return [];
  }
}

function buildStreamEntry(stream, displayTitle) {
  return {
    name: `MoviesDrive • ${stream.name}`,
    title: `MoviesDrive • ${stream.name}`,
    url: stream.url,
    quality: stream.quality,
    ...(stream.size ? { size: stream.size } : {}),
  };
}

function parseSizeBytes(sizeStr) {
  const match = (sizeStr || "").match(/([\d.]+)\s*(GB|MB|KB)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === "GB") return val * 1073741824;
  if (unit === "MB") return val * 1048576;
  if (unit === "KB") return val * 1024;
  return 0;
}

function applyStreamLimits(streams) {
  const seen = new Set();
  const deduped = streams.filter(s => s.url && s.quality >= 1080 && !seen.has(s.url) && seen.add(s.url));

  const above1080 = deduped
    .filter(s => s.quality > 1080)
    .sort((a, b) => parseSizeBytes(b.size) - parseSizeBytes(a.size))
    .slice(0, 3);
  const at1080 = deduped
    .filter(s => s.quality === 1080)
    .sort((a, b) => parseSizeBytes(b.size) - parseSizeBytes(a.size))
    .slice(0, 2);

  return [...above1080, ...at1080];
}

async function resolveMovieStreams(downloadLinks, referer, displayTitle) {
  const results = [];
  for (const link of [...new Set(downloadLinks)]) {
    const serverUrls = await resolveServerLinks(link);
    const groups = await Promise.all(serverUrls.map(u => dispatchExtractor(u, referer)));
    for (const group of groups) {
      for (const s of group) results.push(buildStreamEntry(s, displayTitle));
    }
  }
  return results;
}

async function resolveEpisodeStreams(pageUrl, season, episode, displayTitle) {
  try {
    const html = await (await fetch(pageUrl, { headers: REQUEST_HEADERS })).text();
    const $ = cheerio.load(html);
    const epRegex = new RegExp(`Ep${String(episode).padStart(2, "0")}|Ep${episode}`, "i");
    const results = [];

    const epEntries = $("h5").filter((_, el) => epRegex.test($(el).text())).get();
    for (const entry of epEntries) {
      const epLinks = [
        $(entry).next().find("a").attr("href"),
        $(entry).next().next().find("a").attr("href"),
      ].filter(Boolean);

      const groups = await Promise.all(epLinks.map(u => dispatchExtractor(u, pageUrl)));
      for (const group of groups) {
        for (const s of group) results.push(buildStreamEntry(s, displayTitle));
      }
    }

    return results;
  } catch {
    return [];
  }
}

async function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType === "tv" && season == null) return [];

  const meta = await fetchTmdbMeta(tmdbId, mediaType);
  if (!meta?.imdbId) return [];

  const { title, imdbId } = meta;

  try {
    const searchRes = await fetch(`${BASE_URL}/search.php?q=${imdbId}`, { headers: REQUEST_HEADERS });
    if (!searchRes.ok) return [];

    const searchData = await searchRes.json();
    const match = (searchData.hits || [])
      .map(h => h.document)
      .find(d => d.imdb_id === imdbId);

    if (!match) return [];

    const pageUrl = match.permalink.startsWith("http") ? match.permalink : `${BASE_URL}${match.permalink}`;
    const pageHtml = await (await fetch(pageUrl, { headers: REQUEST_HEADERS })).text();
    const $ = cheerio.load(pageHtml);

    let streams = [];

    if (mediaType === "movie") {
      const downloadLinks = $("h5 > a").map((_, el) => $(el).attr("href")).get();
      streams = await resolveMovieStreams(downloadLinks, pageUrl, title);
    } else {
      const seasonRegex = new RegExp(`Season ${season}`, "i");
      const seasonEntries = $("h5").filter((_, el) => seasonRegex.test($(el).text())).get();
      const displayTitle = `${title} S${season}E${episode}`;

      for (const entry of seasonEntries) {
        const seasonPageUrl = $(entry).next().find("a").attr("href");
        if (!seasonPageUrl) continue;
        const epStreams = await resolveEpisodeStreams(seasonPageUrl, season, episode, displayTitle);
        streams.push(...epStreams);
      }
    }

    return applyStreamLimits(streams);
  } catch {
    return [];
  }
}

module.exports = { getStreams };
