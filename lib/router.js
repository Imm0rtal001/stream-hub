'use strict';
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const { enc, dec, cors, send, json, readJson, originOf, streamHeaders } = require('./util');
const { parseStreamMeta } = require('./streamMeta');
const { normalize, userView, cleanHost, DOH_PRESETS } = require('./config');
const store = require('./store');
const registry = require('./registry');
const stremio = require('./stremio');
const nuvio = require('./nuvio');
const { runProviders } = require('./runner');
const { resolveHost } = require('./dns');
const { hasUndici } = require('./net');

let uiCache = null;
const ui = () => (uiCache = uiCache || fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8'));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function handler(req, res) {
  try {
    await route(req, res);
  } catch (err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    json(res, status, { error: err.message || 'Internal error' });
  }
}

async function route(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; return res.end(); }
  if (p === '/health') return json(res, 200, { ok: true, version: pkg.version });
  if (p === '/favicon.ico') { res.statusCode = 204; return res.end(); }
  if (p === '/') return send(res, 200, ui(), 'text/html; charset=utf-8', 'public, max-age=0, must-revalidate');
  if (p.startsWith('/api/')) return api(req, res, p);

  // ----- scoped routes: /c/<config>/…  |  /u/<profile>/…  |  default config -----
  let cfg = normalize({});
  let prefix = '';
  let rest = p;
  let m;
  if ((m = /^\/c\/([^/]+)(\/.*)?$/.exec(p))) {
    let raw;
    try { raw = dec(m[1]); } catch { throw new HttpError(400, 'Invalid config in URL'); }
    cfg = normalize(raw);
    prefix = `/c/${m[1]}`;
    rest = m[2] || '/';
  } else if ((m = /^\/u\/([^/]+)(\/.*)?$/.exec(p))) {
    if (!store.enabled()) throw new HttpError(501, 'Profiles need a Redis store (see README)');
    const profile = await store.getProfile(m[1]);
    if (!profile) throw new HttpError(404, 'Profile not found');
    cfg = normalize(profile.config);
    prefix = `/u/${m[1]}`;
    rest = m[2] || '/';
  }
  const base = originOf(req) + prefix;

  if (rest === '/' || rest === '/configure') return send(res, 200, ui(), 'text/html; charset=utf-8', 'no-cache');
  if (rest === '/manifest.json') return json(res, 200, stremio.buildManifest(cfg), 'public, max-age=0, s-maxage=60');

  if ((m = /^\/stream\/(movie|series)\/(.+)\.json$/.exec(rest))) {
    const out = await stremio.handleStream(cfg, m[1], m[2], base);
    const cacheable = out.streams.length && !out.streams[0].externalUrl;
    return json(res, 200, out, cacheable ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=300' : 'no-store');
  }

  if (rest === '/nuvio/manifest.json') return json(res, 200, nuvio.buildManifest(cfg), 'public, max-age=0, s-maxage=60');
  if ((m = /^\/nuvio\/providers\/([\w.-]+\.js)$/.exec(rest))) {
    const code = nuvio.providerSource(cfg, m[1]);
    if (code == null) throw new HttpError(404, 'Unknown provider file');
    return send(res, 200, code, 'application/javascript; charset=utf-8', 'public, max-age=0, s-maxage=60');
  }

  throw new HttpError(404, 'Not found');
}

async function api(req, res, p) {
  if (p === '/api/status' && req.method === 'GET') {
    return json(res, 200, {
      version: pkg.version,
      profiles: store.enabled(),
      serverTmdbKey: Boolean(process.env.TMDB_API_KEY),
      customResolver: hasUndici(),
      dohPresets: Object.keys(DOH_PRESETS),
      serverDns: { mode: process.env.DNS_MODE || 'system', doh: process.env.DOH_PROVIDER || 'cloudflare' },
    });
  }

  if (p === '/api/providers' && req.method === 'GET') {
    const list = await Promise.all(registry.listProviders().map((e) => registry.describe(e)));
    return json(res, 200, { providers: list });
  }

  if (p === '/api/test' && req.method === 'POST') {
    const b = await readJson(req);
    const cfg = normalize(b.config);
    if (!cfg.tmdbKey) throw new HttpError(400, 'Add a TMDB API key first (Settings tab).');
    const type = b.type === 'series' ? 'series' : 'movie';
    let target;
    try { target = await stremio.resolveTarget(cfg, type, String(b.id || '')); } catch (e) { throw new HttpError(400, e.message); }
    const only = Array.isArray(b.only) ? b.only.filter((x) => typeof x === 'string').slice(0, 20) : null;
    const t0 = Date.now();
    const out = await runProviders({ cfg, ...target, only });
    return json(res, 200, {
      target, ms: Date.now() - t0, report: out.report, trace: out.trace, logs: out.logs,
      streams: out.streams.map((s) => {
        const meta = parseStreamMeta(s);
        return {
          provider: s._provider.id, name: stremio.clean(s.name), title: stremio.clean(s.title),
          quality: meta.quality, size: meta.size, server: meta.server, language: meta.language,
          audioCodec: meta.audioCodec, videoCodec: meta.videoCodec, hdr: meta.hdr, badges: meta.badges,
          url: s.url, headers: streamHeaders(s),
        };
      }),
    });
  }

  if (p === '/api/dns' && req.method === 'POST') {
    const b = await readJson(req);
    const cfg = normalize(b.config);
    const hosts = (Array.isArray(b.hosts) ? b.hosts : []).map((h) => cleanHost(h, false)).filter(Boolean).slice(0, 12);
    const results = await Promise.all(hosts.map(async (h) => {
      const target = cfg.dns.rewrites[h] || h;
      try {
        const r = await resolveHost(target, cfg.dns);
        return { host: h, target: target !== h ? target : undefined, ips: r.ips.slice(0, 4), source: r.source, ms: r.ms };
      } catch (e) {
        return { host: h, target: target !== h ? target : undefined, error: e.message };
      }
    }));
    return json(res, 200, { results });
  }

  let m;
  if (p === '/api/profile' && req.method === 'POST') {
    if (!store.enabled()) throw new HttpError(501, 'Profiles are disabled: connect a Redis store (see README).');
    const b = await readJson(req);
    return json(res, 200, await store.createProfile(b.config));
  }
  if ((m = /^\/api\/profile\/([a-f0-9]{18})$/.exec(p))) {
    if (!store.enabled()) throw new HttpError(501, 'Profiles are disabled');
    const secret = req.headers['x-profile-secret'] || '';
    if (req.method === 'GET') {
      const r = await store.readWithSecret(m[1], secret);
      if (!r.ok) throw new HttpError(r.status, r.status === 404 ? 'Profile not found' : 'Wrong edit key');
      return json(res, 200, { config: r.config });
    }
    if (req.method === 'PUT') {
      const b = await readJson(req);
      const r = await store.updateProfile(m[1], secret, b.config);
      if (!r.ok) throw new HttpError(r.status, r.status === 404 ? 'Profile not found' : 'Wrong edit key');
      return json(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Unknown API route');
}

module.exports = { handler, route };
