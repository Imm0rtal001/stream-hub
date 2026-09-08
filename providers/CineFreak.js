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
const PROVIDER_NAME = "CineFreak";
const BASE_URL = "https://cinefreak.net";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = "307b7b8ef035c6aa336900aef4e203bd";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  "Cookie": "xla=s4t",
};

async function fetchHtml(url, extra) {
  try {
    const res = await fetch(url, { headers: Object.assign({}, HEADERS, extra) });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

async function fetchJson(url, extra) {
  try {
    const res = await fetch(url, { headers: Object.assign({}, HEADERS, extra) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

function originOf(url) {
  try { const u = new URL(url); return u.protocol + "//" + u.host; } catch { return ""; }
}

function decodeBase64Url(str) {
  try {
    return atob(str.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""));
  } catch { return null; }
}

function toQualityLabel(raw) {
  const m = /(\d{3,4})[pP]/.exec(raw || "");
  if (!m) return "Unknown";
  const n = parseInt(m[1], 10);
  if (n >= 2160) return "2160p";
  if (n >= 1080) return "1080p";
  if (n >= 720) return "720p";
  if (n >= 480) return "480p";
  return "Unknown";
}

function isHighQuality(quality) {
  return quality === "1080p" || quality === "2160p";
}

function formatTitle(releaseTitle, size, quality) {
  const t = String(releaseTitle || "");

  const line1Parts = [];
  if (quality) line1Parts.push(quality);
  if (size && size !== "Unknown") line1Parts.push(size);

  const line2Parts = [];

  const src = /bluray|blu\-ray|bdrip/i.test(t) ? "Blu-ray"
    : /hdrip|webrip/i.test(t) ? "WEBRip"
      : /web\-?dl/i.test(t) ? "WEB-DL"
        : "";
  if (src) line2Parts.push(src);

  if (/imax/i.test(t)) line2Parts.push("IMAX");

  let audio = "";
  const am = t.match(/(TrueHD\s*7\.1|DDP\s*7\.1|DDP\s*5\.1|DD\s*5\.1|5\.1|AAC)/i);
  if (am) {
    audio = am[1].toUpperCase().replace(/\s+/g, "");
    if (audio === "5.1") audio = "DDP5.1";
    if (audio.includes("TRUEHD")) audio = "TrueHD 7.1";
  } else if (/dolby\s*digital/i.test(t)) {
    audio = "Dolby Digital";
  }
  if (/atmos/i.test(t)) audio = audio ? `${audio} • Atmos` : "Atmos";
  if (audio) line2Parts.push(audio);

  const range = /dolby\s*vision|dovi/i.test(t) ? "Dolby Vision"
    : /hdr10/i.test(t) ? "HDR10"
      : /hdr/i.test(t) ? "HDR"
        : /10bit|10\-bit/i.test(t) ? "10-Bit"
          : /\bsdr\b/i.test(t) ? "SDR"
            : "";
  if (range) line2Parts.push(range);

  const codec = /hevc|x265|h\.?265/i.test(t) ? "H.265"
    : /x264|h\.?264/i.test(t) ? "H.264"
      : "";
  if (codec) line2Parts.push(codec);

  const line1 = line1Parts.join(" • ");
  const line2 = line2Parts.join(" • ");
  return [line1, line2].filter(Boolean).join("\n");
}

function dedupe(streams) {
  const seen = new Set();
  return streams.filter(s => s.url && !seen.has(s.url) && seen.add(s.url));
}

async function tmdbLookup(tmdbId, mediaType) {
  const ep = mediaType === "tv" ? "tv" : "movie";
  const data = await fetchJson(`${TMDB_API}/${ep}/${tmdbId}?api_key=${TMDB_KEY}`);
  if (!data) return null;
  return {
    title: (mediaType === "tv" ? data.name : data.title) || "",
    isTv: mediaType === "tv",
  };
}

async function searchCinefreak(query) {
  const data = await fetchJson(`${BASE_URL}/search-api.php?q=${encodeURIComponent(query)}&pg=1`);
  return (data && Array.isArray(data.results)) ? data.results : [];
}

function selectResult(results, title, mediaType) {
  const norm = title.toLowerCase().trim();

  function looksLikeTv(r) {
    const t = r.t.toLowerCase();
    return t.includes("season") || t.includes("series") || t.includes("episode");
  }

  for (const r of results) {
    if (mediaType === "tv" && !looksLikeTv(r)) continue;
    if (mediaType === "movie" && looksLikeTv(r)) continue;
    const rn = r.t.toLowerCase().replace(/\s*season\s*\d+/gi, "").replace(/\s*\(.*?\)/g, "").trim();
    if (rn === norm || rn.includes(norm) || norm.includes(rn)) return r;
  }

  return results[0] || null;
}

async function extractCineCloud(url, qualityHint) {
  const streams = [];
  try {
    const html = await fetchHtml(url);
    if (!html) return streams;
    const $ = cheerio.load(html);
    const quality = toQualityLabel(qualityHint);

    if (!isHighQuality(quality)) return streams;

    let releaseTitle = "";
    const titleCandidates = [
      $("h1").first().text(),
      $("h2").first().text(),
      $("title").text(),
      $(".file-name, .filename, .release-name, .movie-title").first().text(),
    ];
    for (const c of titleCandidates) {
      const clean = c.trim();
      if (clean && /\d{3,4}p|bluray|webrip|web-?dl|x26[45]|hevc|aac|ddp/i.test(clean)) {
        releaseTitle = clean;
        break;
      }
    }

    let fileSize = "";
    $("tr").each((_, row) => {
      if (fileSize) return;
      const first = $(row).find("td").first();
      if (first.text().toLowerCase().includes("file size")) {
        const right = $(row).find("td.text-right");
        if (right.length) fileSize = right.last().text().trim();
      }
    });

    const base = originOf(url);
    const resumeJobs = [];
    const sizeLabel = formatTitle(releaseTitle, fileSize, quality);

    $("a[href]").each((_, el) => {
      const text = $(el).text().trim();
      const href = ($(el).attr("href") || "").trim();
      if (!href) return;
      const fullHref = href.startsWith("http") ? href : base + href;

      if (/fast\s+cloud/i.test(text) || /\[fsl\]/i.test(text)) {
        streams.push({
          url: fullHref,
          title: `${PROVIDER_NAME} • FSL`,
          size: sizeLabel,
          headers: { Referer: url },
        });
      } else if (/cloud\s*\[resumable\]/i.test(text)) {
        resumeJobs.push(fullHref);
      }
    });

    const resumeResults = await Promise.allSettled(
      resumeJobs.map(async resumeUrl => {
        const subHtml = await fetchHtml(resumeUrl, { Referer: url });
        if (!subHtml) return [];
        const $2 = cheerio.load(subHtml);
        const links = [];
        $2("a.download-now[href]").each((_, el) => {
          const link = ($2(el).attr("href") || "").trim();
          if (link) links.push(link);
        });
        return links;
      })
    );

    for (const r of resumeResults) {
      if (r.status !== "fulfilled") continue;
      for (const finalUrl of r.value) {
        streams.push({
          url: finalUrl,
          title: `${PROVIDER_NAME} • Cloudflare`,
          size: sizeLabel,
          headers: { Referer: url },
        });
      }
    }
  } catch { }
  return streams;
}

async function resolveLink(href, qualityHint) {
  try {
    const m = /[?&]id=([^&]+)/.exec(href);
    if (!m) return [];

    let encoded = m[1];
    try { encoded = decodeURIComponent(encoded); } catch { }

    const decoded = decodeBase64Url(encoded);
    if (!decoded) return [];

    const target = decoded.split("newgo32")[0].trim();
    if (!target || !target.startsWith("http")) return [];

    if (target.includes("cinecloud")) return extractCineCloud(target, qualityHint);

    return [];
  } catch { return []; }
}

function parseMovieLinks(html) {
  const $ = cheerio.load(html);
  const links = [];
  const counts = {};

  $("h4.movie-title").each((_, el) => {
    const qm = /(2160p|1080p|720p|480p)/i.exec($(el).text());
    if (!qm) return;
    const quality = qm[1];

    $(el).next().find("a.dlbtn-download[href]").each((_, a) => {
      const href = ($(a).attr("href") || "").trim();
      if (!href) return;
      counts[quality] = (counts[quality] || 0) + 1;
      const label = counts[quality] === 1 ? quality : `${quality}_${counts[quality]}`;
      links.push({ quality: label, href });
    });
  });

  return links;
}

function collectGenerateLinks(cardHtml) {
  const NEEDLE = "/generate.php?id=";
  const links = [];
  let pos = 0;

  while (true) {
    const hrefStart = cardHtml.indexOf(NEEDLE, pos);
    if (hrefStart === -1) break;

    const aOpen = cardHtml.lastIndexOf("<a ", hrefStart);
    if (aOpen === -1 || aOpen < pos) { pos = hrefStart + 1; continue; }

    const aClose = cardHtml.indexOf("</a>", hrefStart);
    if (aClose === -1) { pos = hrefStart + 1; continue; }

    const gtIdx = cardHtml.indexOf(">", hrefStart);
    if (gtIdx === -1 || gtIdx > aClose) { pos = aClose + 4; continue; }

    const label = cardHtml.substring(gtIdx + 1, aClose).trim();
    const quoteIdx = cardHtml.indexOf('"', hrefStart);
    if (quoteIdx === -1) { pos = aClose + 4; continue; }

    const snippet = cardHtml.substring(hrefStart, quoteIdx);
    const idMatch = snippet.match(/id=([a-zA-Z0-9+/=]+)/);
    if (!idMatch) { pos = aClose + 4; continue; }

    const hrefTagStart = cardHtml.lastIndexOf('href="', hrefStart);
    const fullHref = cardHtml
      .substring(hrefTagStart + 6, cardHtml.indexOf('"', hrefTagStart + 6))
      .replace(/&amp;/g, "&");

    const qm = /(2160p|1080p|720p|480p)/i.exec(label);
    const quality = qm ? qm[1] : (label || "Unknown");

    links.push({ href: fullHref || `${NEEDLE}${idMatch[1]}`, quality });
    pos = aClose + 4;
  }

  return links;
}

function parseEpisodeLinks(html, targetEpisode) {
  if (!html) return [];

  const cards = html.split('<div class="ep-card"');

  const EP_PATTERNS = [
    /episode-badge[^>]*>\s*(?:Episode\s*)?(\d+)/i,
    /ep-num[^>]*>\s*(\d+)\s*</i,
    /data-episode="(\d+)"/i,
    /\bEpisode\s+(\d+)\b/i,
  ];

  for (let i = 1; i < cards.length; i++) {
    for (const pat of EP_PATTERNS) {
      const m = cards[i].match(pat);
      if (m && parseInt(m[1], 10) === targetEpisode) {
        return collectGenerateLinks(cards[i]);
      }
    }
  }

  return [];
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (mediaType === "tv" && (season == null || episode == null)) return [];

    const tmdb = await tmdbLookup(tmdbId, mediaType);
    if (!tmdb || !tmdb.title) return [];

    const { title } = tmdb;

    const primaryQuery = (mediaType === "tv" && season != null)
      ? `${title} Season ${season}`
      : title;

    let results = await searchCinefreak(primaryQuery);
    let match = selectResult(results, title, mediaType);

    if (!match && mediaType === "tv") {
      results = await searchCinefreak(title);
      match = selectResult(results, title, mediaType);
    }

    if (!match) return [];

    const pageUrl = match.l.startsWith("http")
      ? match.l
      : `${BASE_URL}/${match.l.replace(/^\//, "")}/`;

    const html = await fetchHtml(pageUrl);
    if (!html) return [];

    const rawLinks = mediaType === "movie"
      ? parseMovieLinks(html)
      : parseEpisodeLinks(html, parseInt(episode, 10));

    if (!rawLinks.length) return [];

    const batches = await Promise.allSettled(
      rawLinks.map(({ quality, href }) => resolveLink(href, quality))
    );

    return dedupe(
      batches
        .filter(r => r.status === "fulfilled")
        .flatMap(r => r.value)
    );
  } catch { return []; }
}

module.exports = { getStreams };
