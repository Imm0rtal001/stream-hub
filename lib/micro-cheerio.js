"use strict";
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

function collectDescendants(node, out) {
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === "tag") {
      out.push(child);
      collectDescendants(child, out);
    }
  }
  return out;
}

function collectChildElements(node, out) {
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) {
    if (children[i].type === "tag") out.push(children[i]);
  }
  return out;
}

function queryAll(contextNodes, selectorString) {
  const groups = splitTopLevel(selectorString, ",").map((g) => g.trim()).filter(Boolean);
  const foundIdx = {}; // _idx -> el, for identity dedupe (plain object, not Map)
  const foundOrder = [];

  for (let g = 0; g < groups.length; g++) {
    const steps = splitSteps(groups[g]);
    let current = contextNodes;
    for (let s = 0; s < steps.length; s++) {
      const step = steps[s];
      const next = [];
      const seenIdx = {};
      for (let c = 0; c < current.length; c++) {
        const scopeNode = current[c];
        const pool = step.combinator === "child" ? collectChildElements(scopeNode, []) : collectDescendants(scopeNode, []);
        for (let p = 0; p < pool.length; p++) {
          const el = pool[p];
          if (!seenIdx[el._idx] && matchCompound(el, step.compound)) {
            seenIdx[el._idx] = true;
            next.push(el);
          }
        }
      }
      current = next;
    }
    for (let c = 0; c < current.length; c++) {
      const el = current[c];
      if (!foundIdx[el._idx]) {
        foundIdx[el._idx] = true;
        foundOrder.push(el);
      }
    }
  }

  return foundOrder.sort((a, b) => a._idx - b._idx);
}

// ---------------------------------------------------------------------------
// Cheerio-like wrapper API — plain constructor functions + prototype methods
// (no `class` syntax), since sandboxed JS runtimes that dynamically load
// these files are not guaranteed to support ES6 classes even where they
// support arrow functions / let/const / generators.
// ---------------------------------------------------------------------------

function ArrayResult(arr) {
  this._arr = arr;
}
ArrayResult.prototype.get = function (i) {
  return i === undefined ? this._arr.slice() : this._arr[i];
};

function Cheerio(elements, root) {
  this._els = elements || [];
  this._root = root;
  this.length = this._els.length;
}
Cheerio.prototype.each = function (fn) {
  this._els.forEach(function (el, i) {
    fn(i, el);
  });
  return this;
};
Cheerio.prototype.map = function (fn) {
  return new ArrayResult(
    this._els.map(function (el, i) {
      return fn(i, el);
    })
  );
};
Cheerio.prototype.filter = function (fn) {
  return new Cheerio(
    this._els.filter(function (el, i) {
      return fn(i, el);
    }),
    this._root
  );
};
Cheerio.prototype.first = function () {
  return new Cheerio(this._els.slice(0, 1), this._root);
};
Cheerio.prototype.last = function () {
  return new Cheerio(this._els.slice(-1), this._root);
};
Cheerio.prototype.eq = function (i) {
  const el = this._els[i];
  return new Cheerio(el ? [el] : [], this._root);
};
Cheerio.prototype.get = function (i) {
  return i === undefined ? this._els.slice() : this._els[i];
};
Cheerio.prototype.text = function () {
  return this._els.map(getText).join("");
};
Cheerio.prototype.html = function () {
  if (!this._els.length) return null;
  return serializeInner(this._els[0]);
};
Cheerio.prototype.attr = function (name) {
  if (!this._els.length) return undefined;
  return this._els[0].attribs ? this._els[0].attribs[String(name).toLowerCase()] : undefined;
};
Cheerio.prototype.find = function (selector) {
  return new Cheerio(queryAll(this._els, selector), this._root);
};
Cheerio.prototype.next = function () {
  const out = [];
  for (let i = 0; i < this._els.length; i++) {
    const el = this._els[i];
    const siblings = (el.parent && el.parent.children) || [];
    const idx = siblings.indexOf(el);
    for (let j = idx + 1; j < siblings.length; j++) {
      if (siblings[j].type === "tag") {
        out.push(siblings[j]);
        break;
      }
    }
  }
  return new Cheerio(out, this._root);
};
Cheerio.prototype.parent = function () {
  const out = [];
  const seenIdx = {};
  for (let i = 0; i < this._els.length; i++) {
    const p = this._els[i].parent;
    if (p && p.type === "tag" && !seenIdx[p._idx]) {
      seenIdx[p._idx] = true;
      out.push(p);
    }
  }
  return new Cheerio(out, this._root);
};

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

module.exports = { load };
