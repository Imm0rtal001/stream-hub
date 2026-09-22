'use strict';
const { listProviders, readSource } = require('./registry');
const { loadProvider } = require('./sandbox');
const { createFetch } = require('./net');

const isEnabled = (entry, cfg) => {
  const o = cfg.providers[entry.id];
  return o && typeof o.enabled === 'boolean' ? o.enabled : entry.enabled !== false;
};

const QUALITY_WEIGHT = (q) => {
  const s = String(q || '').toLowerCase();
  if (/2160|4k|uhd/.test(s)) return 4;
  if (/1440/.test(s)) return 3.5;
  if (/1080/.test(s)) return 3;
  if (/720/.test(s)) return 2;
  if (/480|360/.test(s)) return 1;
  return 0;
};

/**
 * Run every enabled provider for one title in parallel.
 * @returns {{streams: object[], report: object[], trace: object[], logs: string[]}}
 */
async function runProviders({ cfg, mediaType, tmdbId, season = null, episode = null, only = null }) {
  const trace = [];
  const logs = [];
  const entries = listProviders().filter((p) =>
    (only ? only.includes(p.id) : isEnabled(p, cfg)) && (p.supportedTypes || ['movie', 'tv']).includes(mediaType));

  const jobs = entries.map(async (entry) => {
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    const rep = { id: entry.id, name: entry.name, ms: 0, count: 0 };
    try {
      const fetchFn = createFetch(cfg, { trace, signal: ac.signal });
      const api = loadProvider({
        key: entry.id, code: readSource(entry), fetch: fetchFn, tmdbKey: cfg.tmdbKey,
        settings: (cfg.providers[entry.id] || {}).settings || {}, logs,
      });
      const timeout = new Promise((_, rej) => ac.signal.addEventListener('abort', () => rej(new Error(`Timed out after ${cfg.timeoutMs} ms`))));
      const out = await Promise.race([api.getStreams(String(tmdbId), mediaType, season, episode), timeout]);
      const list = (Array.isArray(out) ? out : []).filter((s) => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url));
      rep.count = list.length;
      return { entry, list, rep };
    } catch (err) {
      rep.error = err && err.message ? err.message : String(err);
      return { entry, list: [], rep };
    } finally {
      clearTimeout(timer);
      ac.abort(); // cancel any still-running requests from this provider
      rep.ms = Date.now() - t0;
    }
  });

  const results = await Promise.all(jobs);
  let streams = results.flatMap((r) => {
    const list = cfg.maxPerProvider ? r.list.slice(0, cfg.maxPerProvider) : r.list;
    return list.map((s) => ({ ...s, _provider: r.entry }));
  });
  if (cfg.sort === 'quality') {
    streams = streams.map((s, i) => ({ s, i })).sort((a, b) =>
      QUALITY_WEIGHT(b.s.quality) - QUALITY_WEIGHT(a.s.quality) || a.i - b.i).map((x) => x.s);
  }
  return { streams, report: results.map((r) => r.rep), trace, logs };
}

module.exports = { runProviders, isEnabled };
