"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
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
const PROVIDER = "Rogmovies";
const TMDB_KEY = "307b7b8ef035c6aa336900aef4e203bd";
const BASE_URL = "https://new2.rogmovies.click";
const HUB_DOMAIN = "https://hubcloud.cx";
const VC_DOMAIN = "https://vcloud.fit";
const MAX_1080P = 4;
const ALLOWED_Q = ['2160p', '4k', '1440p', '1080p'];
const Q_WEIGHTS = { '2160p': 4, '4k': 4, '1440p': 3, '1080p': 2, '720p': 1, 'HD': 0 };
const EXCLUDED = ['filepress', 'gdtot', 'dropgalaxy', 'gdflix', 'gdlink'];
const MOBILE_UAS = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36'
];
let count1080p = 0;
const mobileHdrs = () => ({
    "User-Agent": MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)],
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE_URL + "/"
});
const origin = url => {
    try {
        const p = url.split('//');
        return p[0] + '//' + p[1].split('/')[0];
    }
    catch (e) {
        return url;
    }
};
const fixUrl = url => !url ? '' : url.startsWith('https://') ? url : url.startsWith('http://') ? 'https://' + url.slice(7) : url.startsWith('//') ? 'https:' + url : BASE_URL + (url.startsWith('/') ? '' : '/') + url;
const normalizeQ = q => {
    if (!q)
        return null;
    const l = q.toLowerCase();
    return (l === '4k' || l === '4kp') ? '2160p' : ALLOWED_Q.includes(l) ? l : null;
};
const parseQ = t => { const m = String(t || '').match(/(2160|1080|720|480|1440)\s*P/i); return m ? m[1].toLowerCase() + 'p' : /4K|UHD/i.test(t) ? '2160p' : /1440|2K/i.test(t) ? '1440p' : 'HD'; };
const decodeEnt = s => (s || '').replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-').replace(/&#038;|&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&quot;/g, '"');
function fetchSafe(url_1) {
    return __awaiter(this, arguments, void 0, function* (url, opts = {}, timeout = 12000) {
        try {
            return yield Promise.race([
                fetch(url, Object.assign(Object.assign({}, opts), { headers: Object.assign({ "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.5", "Accept-Encoding": "identity" }, (opts.headers || {})) })),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))
            ]);
        }
        catch (e) {
            return null;
        }
    });
}
const fetchJson = (url_1, ...args_1) => __awaiter(void 0, [url_1, ...args_1], void 0, function* (url, opts = {}) {
    try {
        const r = yield fetchSafe(url, opts);
        if (!r || !r.ok)
            return null;
        return JSON.parse(yield r.text());
    }
    catch (e) {
        return null;
    }
});
const fetchHtml = (url_1, ...args_1) => __awaiter(void 0, [url_1, ...args_1], void 0, function* (url, opts = {}) {
    try {
        const r = yield fetchSafe(url, opts);
        if (!r || !r.ok)
            return null;
        return cheerio.load(yield r.text());
    }
    catch (e) {
        return null;
    }
});
function makeStream(_, title, url, quality, headers, mediaInfo, fallbackQ = 'HD') {
    if (!url || !url.startsWith('https://'))
        return null;
    const nq = normalizeQ(quality) || normalizeQ(fallbackQ);
    if (!nq || (nq === '1080p' && count1080p >= MAX_1080P))
        return null;
    const t = decodeEnt(title || '').replace(/[\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const sizeM = t.match(/\[\s*(\d+(?:\.\d+)?\s*[MG]B)\s*\]/i);
    const size = sizeM ? sizeM[1].trim() : 'N/A';
    const src = /bluray|blu\-ray|bdrip/i.test(t) ? 'Blu-ray' : /hdrip|webrip/i.test(t) ? 'WEBRip' : 'WEB-DL';
    const imax = /imax/i.test(t) ? ' • IMAX' : '';
    const range = /dolby\s*vision|dovi/i.test(t) ? 'Dolby Vision' : /hdr10/i.test(t) ? 'HDR10' : /hdr/i.test(t) ? 'HDR' : /10bit|10\-bit/i.test(t) ? '10-Bit' : /sdr/i.test(t.toLowerCase()) ? 'SDR' : '';
    const codec = /hevc|x265|h265/i.test(t) ? 'H.265' : 'H.264';
    let audio = 'AAC';
    const am = t.match(/(TrueHD\s*7\.1|DDP\s*7\.1|DDP\s*5\.1|DD\s*5\.1|5\.1|AAC)/i);
    if (am) {
        audio = am[1].toUpperCase().replace(/\s+/g, '');
        if (audio === '5.1')
            audio = 'DDP5.1';
        if (audio.includes('TRUEHD'))
            audio = 'TrueHD 7.1';
    }
    else if (/dolby\s*digital|dd/i.test(t))
        audio = 'Dolby Digital';
    if (/atmos/i.test(t))
        audio += ' • Atmos';
    const langs = /dual|hindi\-eng|eng\-hin/i.test(t) ? 'English • Hindi' : ([/english|eng/i.test(t) && 'English', /hindi|hin/i.test(t) && 'Hindi'].filter(Boolean).join(' • ') || 'English');
    const lUrl = url.toLowerCase();
    const host = (lUrl.includes('hubcloud') || lUrl.includes('/hub2/') || lUrl.includes('homelander.buzz') || lUrl.includes('whistle.lat') || lUrl.includes('mandalorian.buzz')) ? 'HubCloud' : (lUrl.includes('.r2.dev') || lUrl.includes('vcloud')) ? 'vCloud' : '';
    if (nq === '1080p')
        count1080p++;
    const line1 = `${langs}${size !== 'N/A' ? ` • ${size}` : ''}`;
    const line2 = `${src} • ${audio}${range ? ' • ' + range : ''} • ${codec}`;
    return {
        name: `${PROVIDER} • ${nq.toUpperCase()}${imax}${host ? ' • ' + host : ''}`,
        title: `${PROVIDER} • ${nq.toUpperCase()}${imax}${host ? ' • ' + host : ''}`,
        size: `${line1}\n${line2}`,
        url,
        _resWeight: Q_WEIGHTS[nq] || 0,
        _sizeWeight: sizeM ? parseFloat(sizeM[1]) * (sizeM[1].toUpperCase().includes('GB') ? 1024 : 1) : 0,
        behaviorHints: { notWebReady: true, proxyHeaders: { request: headers || { "Referer": BASE_URL + "/" } } }
    };
}
const dedupe = streams => { const s = new Set(); return (streams || []).filter(x => x && x.url && !s.has(x.url) && s.add(x.url)); };
const isHubVc = s => {
    if (!s || !s.url)
        return false;
    const l = s.url.toLowerCase();
    return l.includes('hubcloud') || l.includes('vcloud') || l.includes('/hub2/') || l.includes('homelander.buzz') || l.includes('whistle.lat') || l.includes('mandalorian.buzz') || l.includes('.r2.dev') || (s.name && (s.name.includes('HubCloud') || s.name.includes('vCloud')));
};
function isStrictMatch(reqTitle, reqYear, scrTitle, scrYear, alts = []) {
    if (!scrTitle)
        return false;
    const sc = scrTitle.toLowerCase().replace(/download\s*/gi, '').replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, ' ');
    if (![reqTitle, ...alts].filter(Boolean).some(t => { const c = t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, ' '); return c && (sc.includes(c) || sc.startsWith(c)); }))
        return false;
    if (reqYear && scrYear && !isNaN(parseInt(reqYear)) && !isNaN(parseInt(scrYear)) && Math.abs(parseInt(reqYear) - parseInt(scrYear)) > 1)
        return false;
    return true;
}
function getTMDBInfo(id, type) {
    return __awaiter(this, void 0, void 0, function* () {
        const isImdb = String(id).startsWith('tt'), t = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
        try {
            if (isImdb) {
                const d = yield fetchJson(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`);
                const list = d ? (t === 'tv' ? d.tv_results : d.movie_results) : null;
                if (list && list.length) {
                    const i = list[0];
                    return { title: t === 'tv' ? i.name : i.title, year: (i.first_air_date || i.release_date || '').split('-')[0], imdbId: id, tmdbId: i.id };
                }
                return { title: String(id), year: null, imdbId: id, tmdbId: null };
            }
            const d = yield fetchJson(`https://api.themoviedb.org/3/${t}/${id}?api_key=${TMDB_KEY}&append_to_response=external_ids,alternative_titles`);
            if (d) {
                const alts = ((d.alternative_titles && (d.alternative_titles.titles || d.alternative_titles.results)) || []).map(x => String(x.title || ''));
                return { title: t === 'tv' ? d.name : d.title, year: (d.first_air_date || d.release_date || '').split('-')[0], imdbId: d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || null, tmdbId: d.id, altTitles: alts };
            }
        }
        catch (e) { }
        return { title: String(id), year: null, imdbId: null, tmdbId: null };
    });
}
function searchByTitle(query, year) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!query)
            return [];
        const d = yield fetchJson(`${BASE_URL}/search.php?q=${encodeURIComponent(query + (year ? ' ' + year : ''))}&page=1&per_page=15`, { headers: Object.assign(Object.assign({}, mobileHdrs()), { 'Accept-Encoding': 'identity' }) });
        if (!d || !d.hits || !d.hits.length)
            return [];
        return d.hits.map(h => {
            const doc = h.document || {}, title = (doc.post_title || '').replace(/Download\s*/gi, '').trim();
            return { postId: String(doc.id || ''), title, permalink: doc.permalink || '', imdbId: doc.imdb_id || '', year: (Array.isArray(doc.category) ? doc.category.find(c => /^(19|20)\d{2}$/.test(String(c).trim())) : null) || (title.match(/\b(19|20)\d{2}\b/) || [null])[0] };
        });
    });
}
function fetchPostContent(postId, link) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!postId)
            return null;
        try {
            const r = yield fetchSafe(`${BASE_URL}/wp-json/wp/v2/posts/${postId}`, { headers: mobileHdrs() }, 15000);
            if (r && r.ok) {
                const json = JSON.parse(yield r.text());
                if (json && json.content && json.content.rendered && /nexdrive|vcloud|hubcloud|fastdl|genxfm/i.test(json.content.rendered))
                    return { title: (json.title && json.title.rendered || '').replace(/Download\s*/gi, '').trim(), html: json.content.rendered };
            }
        }
        catch (e) { }
        try {
            const $ = yield fetchHtml(link ? fixUrl(link) : `${BASE_URL}/?p=${postId}`, { headers: mobileHdrs() });
            if ($) {
                const html = $('.entry-content').html() || $('.post-content').html();
                if (html)
                    return { title: $('title').text().replace(/Download\s*/gi, '').trim(), html };
            }
        }
        catch (e) { }
        return null;
    });
}
function extractNexdriveLinks(html) {
    if (!html)
        return [];
    const $ = cheerio.load(html), seen = new Set(), links = [];
    $('a[href*="nexdrive"], a[href*="genxfm"], a[href*="fastdl"], a[href*="vcloud"], a[href*="hubcloud"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || !href.startsWith('https://') || seen.has(href))
            return;
        const text = ($(el).text() || '').trim();
        if (EXCLUDED.some(e => text.toLowerCase().includes(e)))
            return;
        seen.add(href);
        let quality = 'HD', label = text || 'Download';
        const pos = html.indexOf(href);
        if (pos > 0) {
            const before = html.substring(Math.max(0, pos - 3000), pos);
            const hms = before.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi);
            if (hms && hms.length) {
                const hctx = hms[hms.length - 1].replace(/<[^>]*>/g, '').trim().replace(/Download/ig, '');
                if (hctx.length > 5)
                    label = hctx;
            }
            let last = null, li = -1, m, qp = /(?:^|>|\s)(\d{3,4}p|4K|UHD|HDR)(?:<|\s|$)/gi;
            while ((m = qp.exec(before)) !== null) {
                if (m.index > li) {
                    li = m.index;
                    last = m[1];
                }
            }
            if (last)
                quality = parseQ(last);
            if (!quality || quality === 'HD') {
                const hq = before.match(/<(?:h[1-6]|strong|b)[^>]*>[^<]*?(\d{3,4}p|4K|UHD)[^<]*?<\//i);
                if (hq)
                    quality = parseQ(hq[1]);
            }
        }
        const nq = normalizeQ(quality);
        if (nq)
            links.push({ href, quality: nq, label });
    });
    return links;
}
function extractSeasonFromContent(html, season) {
    if (!html || season == null)
        return html;
    let clean = html.split('id="comments"')[0];
    if (clean.length === html.length)
        clean = html.split('class="comments-area"')[0];
    const re = /(?:Season|Saison|Staffel)\s+0*(\d+)\b(?!\s*(?:-|–|to|and|&|&#))/gi;
    let m, blocks = [];
    while ((m = re.exec(clean)) !== null) {
        const ts = Math.max(clean.lastIndexOf('<h', m.index), clean.lastIndexOf('<strong', m.index));
        const start = (ts < 0 || m.index - ts > 500) ? m.index : ts;
        const ctx = clean.substring(start, m.index + 50).toLowerCase();
        if (!ctx.includes('download') && !ctx.includes('episode'))
            blocks.push({ season: parseInt(m[1]), index: start });
    }
    if (!blocks.length)
        return clean;
    const tb = blocks.find(b => b.season === season);
    if (!tb)
        return clean;
    const nb = blocks.find(b => b.index > tb.index && b.season !== season);
    return clean.substring(tb.index, nb ? nb.index : clean.length);
}
function extractSingleVc(vcUrl, referer, targetSeason, targetEp, label, fallbackQ, mediaInfo) {
    return __awaiter(this, void 0, void 0, function* () {
        const streams = [], lower = vcUrl.toLowerCase();
        if (!vcUrl.startsWith('https://') || (!lower.includes('vcloud') && !lower.includes('hubcloud') && !lower.includes('nexdrive') && !lower.includes('fastdl')))
            return streams;
        const isHub = lower.includes('hubcloud'), latestBase = isHub ? HUB_DOMAIN : VC_DOMAIN, cur = origin(vcUrl);
        const newUrl = (cur !== latestBase && (vcUrl.includes('vcloud') || vcUrl.includes('hubcloud'))) ? vcUrl.replace(cur, latestBase) : vcUrl;
        const $ = yield fetchHtml(newUrl, { headers: Object.assign(Object.assign({}, mobileHdrs()), { 'Referer': referer || BASE_URL + '/', 'Cookie': 'xla=s4t' }), redirect: 'manual' });
        if (!$)
            return streams;
        const raw = $.html(), pageTitle = $('title').text() || '';
        if (targetSeason != null || targetEp != null) {
            const sem = pageTitle.match(/[.\s_\-](?:S|Season)\s*0*(\d{1,2})[.\s_\-]*(?:E|Ep|Episode)\s*0*(\d{1,2})[.\s_\-]/i);
            if (sem) {
                if (targetSeason != null && parseInt(sem[1]) !== targetSeason)
                    return streams;
                if (targetEp != null && parseInt(sem[2]) !== targetEp)
                    return streams;
            }
            else {
                const sm = pageTitle.match(/[.\s_\-](?:S|Season)\s*0*(\d{1,2})[.\s_\-]/i);
                if (sm && targetSeason != null && parseInt(sm[1]) !== targetSeason)
                    return streams;
            }
        }
        const headerText = $('div.card-header').text() || '';
        let quality = parseQ(headerText) || fallbackQ || 'HD';
        const tasks = [];
        const synced = href => href.includes('?') ? href + '&s=' + (1 + new Date().getMinutes()) : href + '?s=' + (1 + new Date().getMinutes());
        const varAtob = raw.match(/var\s+url\s*=\s*atob\(atob\('([^']+)'\)\)/);
        const varUrl = raw.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/);
        let bridgeUrl = varAtob ? (function () {
            try {
                return atob(atob(varAtob[1]));
            }
            catch (e) {
                return varAtob[1];
            }
        })() : varUrl ? varUrl[1] : '';
        if (bridgeUrl && bridgeUrl.includes('.workers.dev') && bridgeUrl.startsWith('https://')) {
            tasks.push(() => streams.push(makeStream('Worker', (label || 'Worker') + ' [' + headerText + ']', synced(bridgeUrl), quality, { 'Referer': newUrl }, mediaInfo, fallbackQ)));
            bridgeUrl = '';
        }
        const skipBtn = lt => lt.includes('10gbps') || lt.includes('gdflix') || lt.includes('dropgalaxy') || lt.includes('telegram');
        $('a.btn, a').each((_, el) => {
            const href = $(el).attr('href') || '', text = ($(el).text() || '').trim(), lt = text.toLowerCase();
            if (!href || href === '#' || !href.startsWith('https://') || href.toLowerCase().includes('.zip') || skipBtn(lt))
                return;
            if (lt.includes('fslv2'))
                tasks.push(() => streams.push(makeStream('FSLv2', (label || text) + ' [' + headerText + ']', href, quality, { 'Referer': newUrl }, mediaInfo, fallbackQ)));
            else if (lt.includes('fsl'))
                tasks.push(() => streams.push(makeStream('FSL', (label || text) + ' [' + headerText + ']', synced(href), quality, { 'Referer': newUrl }, mediaInfo, fallbackQ)));
            else if (lt.includes('worker'))
                tasks.push(() => streams.push(makeStream('Worker', (label || text) + ' [' + headerText + ']', synced(href), quality, { 'Referer': newUrl }, mediaInfo, fallbackQ)));
        });
        if (tasks.length) {
            tasks.forEach(fn => fn());
            return streams;
        }
        if (!bridgeUrl) {
            const dlHref = $('#download').attr('href') || $('a').filter((_, el) => { const h = $(el).attr('href') || ''; return h.includes('hubcloud.php') || h.includes('token') || h.includes('dl'); }).first().attr('href');
            if (dlHref && dlHref.startsWith('http'))
                bridgeUrl = dlHref;
        }
        if (!bridgeUrl) {
            const redir = $('a[href*="vcloud.zip"]').filter((_, el) => { const h = $(el).attr('href') || ''; return !h.includes('/api/') && h !== newUrl && h.startsWith('https://'); }).first().attr('href');
            if (redir)
                return extractSingleVc(redir, referer, targetSeason, targetEp, label, fallbackQ, mediaInfo);
        }
        if (!bridgeUrl)
            return streams;
        if (!bridgeUrl.startsWith('http'))
            bridgeUrl = origin(newUrl) + bridgeUrl;
        if (!bridgeUrl.startsWith('https://'))
            return streams;
        const $b = yield fetchHtml(bridgeUrl, { headers: Object.assign(Object.assign({}, mobileHdrs()), { 'Referer': newUrl, 'Cookie': 'xla=s4t' }) });
        if (!$b)
            return streams;
        const bHeader = $b('div.card-header').text() || '', bQ = parseQ(bHeader) || quality;
        const bVar = $b.html().match(/var\s+url\s*=\s*['"]([^'"]+)['"]/);
        if (bVar && bVar[1] && bVar[1].includes('.workers.dev') && bVar[1].startsWith('https://'))
            tasks.push(() => streams.push(makeStream('Worker', (label || 'Worker') + ' [' + bHeader + ']', synced(bVar[1]), bQ, { 'Referer': bridgeUrl }, mediaInfo, fallbackQ)));
        $b('a.btn, a').each((_, el) => {
            const href = $b(el).attr('href') || '', text = ($b(el).text() || '').trim(), lt = text.toLowerCase();
            if (!href || href === '#' || !href.startsWith('https://') || href.toLowerCase().includes('.zip') || skipBtn(lt))
                return;
            if (lt.includes('fslv2'))
                tasks.push(() => streams.push(makeStream('FSLv2', (label || text) + ' [' + bHeader + ']', href, bQ, { 'Referer': bridgeUrl }, mediaInfo, fallbackQ)));
            else if (lt.includes('fsl'))
                tasks.push(() => streams.push(makeStream('FSL', (label || text) + ' [' + bHeader + ']', synced(href), quality, { 'Referer': bridgeUrl }, mediaInfo, fallbackQ)));
        });
        if (!tasks.length) {
            const fsl = $b('#fsl').attr('href');
            if (fsl && fsl.startsWith('https://'))
                tasks.push(() => streams.push(makeStream('FSL', (label || 'FSL') + ' [' + headerText + ']', synced(fsl), quality, { 'Referer': bridgeUrl }, mediaInfo, fallbackQ)));
        }
        tasks.forEach(fn => fn());
        return streams;
    });
}
function loadStreamsFromUrl(url, label, quality, referer, targetSeason, targetEp, mediaInfo) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!url || !url.startsWith('https://'))
            return [];
        const lower = url.toLowerCase();
        if (lower.includes('vcloud') || lower.includes('hubcloud'))
            return extractSingleVc(url, referer || url, targetSeason, targetEp, label, quality, mediaInfo);
        if (!lower.includes('nexdrive') && !lower.includes('genxfm') && !lower.includes('fastdl'))
            return [];
        const $ = yield fetchHtml(url, { headers: Object.assign(Object.assign({}, mobileHdrs()), { 'Referer': referer || BASE_URL + '/' }), redirect: 'manual' });
        if (!$)
            return [];
        const streams = [], tasks = [];
        $('a[href*="vcloud"], a[href*="hubcloud"]').each((_, el) => {
            let href = $(el).attr('href');
            if (!href || !href.startsWith('https://'))
                return;
            if (href.startsWith('/'))
                href = origin(url) + href;
            if (href.includes('/api/index.php?link=')) {
                tasks.push(() => __awaiter(this, void 0, void 0, function* () {
                    const $a = yield fetchHtml(href, { headers: Object.assign(Object.assign({}, mobileHdrs()), { 'Referer': url }), redirect: 'manual' });
                    if (!$a)
                        return [];
                    const rv = $a('a.btn-success, a.btn').attr('href');
                    return (rv && rv.startsWith('https://')) ? extractSingleVc(rv.startsWith('/') ? origin(href) + rv : rv, href, targetSeason, targetEp, label, quality, mediaInfo) : [];
                }));
            }
            else
                tasks.push(() => extractSingleVc(href, url, targetSeason, targetEp, label, quality, mediaInfo));
        });
        if (targetEp != null) {
            const pi = targetEp - 1;
            if (pi >= 0 && pi < tasks.length) {
                try {
                    const r = yield tasks[pi]();
                    if (r && r.length) {
                        r.forEach(s => s && s.url && streams.push(s));
                        return streams;
                    }
                }
                catch (e) { }
            }
            for (let i = 0; i < tasks.length; i += 5) {
                if (i === Math.floor(pi / 5) * 5)
                    continue;
                const res = yield Promise.all(tasks.slice(i, i + 5).map(fn => fn().catch(() => [])));
                let found = false;
                res.forEach(r => {
                    if (r && r.length) {
                        r.forEach(s => s && s.url && streams.push(s));
                        found = true;
                    }
                });
                if (found)
                    break;
            }
        }
        else {
            for (let i = 0; i < tasks.length; i += 5) {
                const res = yield Promise.all(tasks.slice(i, i + 5).map(fn => fn().catch(() => [])));
                res.forEach(r => Array.isArray(r) && r.forEach(s => s && s.url && streams.push(s)));
            }
        }
        return streams;
    });
}
function extractFromPost(post, label, isTv, targetSeason, targetEp, mediaYear) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let html = post.html, seasonLabel = '';
            if (isTv && targetSeason != null) {
                html = extractSeasonFromContent(html, targetSeason) || html;
                seasonLabel = ' S' + targetSeason + (targetEp ? 'E' + targetEp : '');
            }
            const mediaInfo = (seasonLabel.trim() || mediaYear || '').trim();
            const links = extractNexdriveLinks(html).slice(0, 15);
            if (!links.length)
                return [];
            const results = yield Promise.all(links.map(l => loadStreamsFromUrl(l.href, l.label || (seasonLabel + '[' + l.quality + ']'), l.quality, BASE_URL + '/', targetSeason, targetEp, mediaInfo).catch(() => [])));
            return results.flat();
        }
        catch (e) {
            return [];
        }
    });
}
function getStreams(tmdbId, mediaType, season, episode) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            count1080p = 0;
            const isTv = mediaType === 'tv' || mediaType === 'series';
            const media = yield getTMDBInfo(tmdbId, mediaType);
            const { title: mediaTitle, year: mediaYear, altTitles = [] } = media;
            const imdbId = (!media.imdbId || !media.imdbId.startsWith('tt')) && String(tmdbId).startsWith('tt') ? String(tmdbId) : media.imdbId;
            let results = [];
            if (imdbId && imdbId.startsWith('tt'))
                results = yield searchByTitle(imdbId, null);
            if (!results.length || !results.some(r => r.imdbId === imdbId)) {
                let q = mediaTitle + (isTv && season != null ? ' season ' + Number(season) : mediaYear ? ' ' + mediaYear : '');
                results = yield searchByTitle(q, mediaYear);
                if (!results.length && isTv && season != null)
                    results = yield searchByTitle(mediaTitle, mediaYear);
            }
            if (!results.length)
                return [];
            let best = null;
            const targetImdb = imdbId && imdbId.startsWith('tt') ? imdbId : null;
            for (const r of results) {
                if (targetImdb && r.imdbId === targetImdb) {
                    if (!isTv || !season) {
                        best = r;
                        break;
                    }
                    const range = /(?:s|season|staffel|saison)\s*0*(\d+)\s*(?:-|–|to|and|&|&#)\s*0*(\d+)\b/i.exec(r.title);
                    const inRange = range && parseInt(season) >= parseInt(range[1]) && parseInt(season) <= parseInt(range[2]);
                    if (inRange || new RegExp('(?:s|season|staffel|saison)\\s*0*' + Number(season) + '\\b', 'i').test(r.title)) {
                        best = r;
                        break;
                    }
                }
                if (!best && isStrictMatch(mediaTitle, mediaYear, r.title, r.year, altTitles))
                    best = r;
            }
            if (!best || !best.postId)
                return [];
            const post = yield fetchPostContent(best.postId, best.permalink);
            if (!post)
                return [];
            const streams = yield extractFromPost(post, post.title || best.title, isTv, season != null ? Number(season) : null, episode != null ? Number(episode) : null, mediaYear);
            return dedupe(streams).filter(isHubVc).sort((a, b) => b._resWeight - a._resWeight || b._sizeWeight - a._sizeWeight);
        }
        catch (e) {
            count1080p = 0;
            return [];
        }
    });
}
module.exports = { getStreams };
