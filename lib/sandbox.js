'use strict';
// Runs Nuvio-style provider files (CommonJS, using injected globals such as
// `fetch`, `cheerio`, `TMDB_API_KEY` and `SCRAPER_SETTINGS`) inside a fresh vm
// context per run, so each request gets its own DNS-aware fetch and settings.
const vm = require('vm');
const nodeCrypto = require('crypto');

let cheerioMod = null;
function realCheerio() {
  if (!cheerioMod) {
    try { cheerioMod = require('cheerio'); } catch {
      throw new Error('The "cheerio" package is not installed. Run `npm install`.');
    }
  }
  return cheerioMod;
}
// Lazy shim so providers that `require("cheerio")` at load time can still be introspected.
const cheerioShim = new Proxy({}, {
  get: (_t, prop) => (prop === 'load' ? (...a) => realCheerio().load(...a) : realCheerio()[prop]),
});

const REQUIRES = {
  cheerio: cheerioShim,
  'cheerio-without-node-native': cheerioShim,
  'react-native-cheerio': cheerioShim,
  crypto: nodeCrypto,
  url: require('url'),
};

function requireShim(name) {
  if (Object.prototype.hasOwnProperty.call(REQUIRES, name)) return REQUIRES[name];
  throw new Error(`Provider requires unsupported module "${name}"`);
}

const scripts = new Map(); // key -> vm.Script

function compile(key, code) {
  let s = scripts.get(key);
  if (!s) {
    s = new vm.Script(`(function (module, exports, require) {\n${code}\n})`, { filename: `provider:${key}.js` });
    if (scripts.size > 100) scripts.clear();
    scripts.set(key, s);
  }
  return s;
}

function loadProvider({ key, code, fetch, tmdbKey = '', settings = {}, logs = [] }) {
  const push = (level) => (...args) => {
    if (logs.length < 200) {
      logs.push(`[${level}] ${args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ')}`.slice(0, 500));
    }
  };
  const sandbox = {
    fetch,
    cheerio: cheerioShim,
    TMDB_API_KEY: tmdbKey,
    SCRAPER_SETTINGS: settings,
    console: { log: push('log'), info: push('info'), warn: push('warn'), error: push('error'), debug: () => {} },
    URL, URLSearchParams, AbortController, AbortSignal, Headers, TextEncoder, TextDecoder, Buffer,
    atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone,
    crypto: nodeCrypto.webcrypto,
  };
  const ctx = vm.createContext(sandbox, { name: `provider:${key}` });
  ctx.global = ctx;
  const fn = compile(key, code).runInContext(ctx);
  const mod = { exports: {} };
  fn(mod, mod.exports, requireShim);
  const api = mod.exports && Object.keys(mod.exports).length ? mod.exports : { getStreams: ctx.getStreams, onSettings: ctx.onSettings };
  if (typeof api.getStreams !== 'function') throw new Error('Provider does not export getStreams()');
  return api;
}

function safeJson(v) { try { return JSON.stringify(v); } catch { return String(v); } }

module.exports = { loadProvider };
