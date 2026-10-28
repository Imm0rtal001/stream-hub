'use strict';
// Live check of one provider with a real TMDB id, using the same sandbox, DNS layer and
// timeouts as the deployed addon.
//
//   node scripts/check-provider.js moviebox 550                 (movie: Fight Club)
//   node scripts/check-provider.js moviebox 1396 tv 1 1          (series: Breaking Bad S1E1)
//   TMDB_API_KEY=... node scripts/check-provider.js vidbolt 603
//
// Prints the provider's own debug log, every network request (host, status, ms), the streams it
// found, and whether the first stream URL actually answers. Exit code 0 = streams found and reachable.
const fs = require('fs');
const path = require('path');
const { normalize } = require('../lib/config');
const { createFetch } = require('../lib/net');
const { loadProvider } = require('../lib/sandbox');
const { listProviders, readSource } = require('../lib/registry');

const [id, tmdbId = '550', typeArg = 'movie', seasonArg, episodeArg] = process.argv.slice(2);
if (!id) {
  console.log('Usage: node scripts/check-provider.js <provider-id> <tmdb-id> [movie|tv] [season] [episode]');
  console.log('Providers: ' + listProviders().map((p) => p.id).join(', '));
  process.exit(2);
}
const entry = listProviders().find((p) => p.id.toLowerCase() === id.toLowerCase());
if (!entry) { console.error(`Unknown provider "${id}".`); process.exit(2); }
const mediaType = typeArg === 'tv' || typeArg === 'series' ? 'tv' : 'movie';
const season = mediaType === 'tv' ? Number(seasonArg || 1) : null;
const episode = mediaType === 'tv' ? Number(episodeArg || 1) : null;

(async () => {
  const cfg = normalize({ timeoutMs: 40000 });
  if (!cfg.tmdbKey) { console.error('No TMDB key. Set TMDB_API_KEY.'); process.exit(2); }
  const trace = [];
  const logs = [];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
  const t0 = Date.now();
  let streams = [];
  let crash = null;
  try {
    const api = loadProvider({ key: entry.id, code: readSource(entry), fetch: createFetch(cfg, { trace, signal: ac.signal }), tmdbKey: cfg.tmdbKey, settings: {}, logs });
    streams = await api.getStreams(String(tmdbId), mediaType, season, episode);
  } catch (e) { crash = e; }
  clearTimeout(timer);
  const ms = Date.now() - t0;
  streams = (Array.isArray(streams) ? streams : []).filter((s) => s && /^https?:\/\//i.test(s.url || ''));

  console.log(`\n=== ${entry.name} | tmdb ${tmdbId} ${mediaType}${season != null ? ` S${season}E${episode}` : ''} | ${ms} ms ===`);
  console.log('\n-- provider log --');
  console.log(logs.length ? logs.join('\n') : '(the provider logged nothing)');
  console.log('\n-- network --');
  for (const r of trace) console.log(`${String(r.status || 'ERR').padEnd(4)} ${r.method.padEnd(4)} ${r.host}${r.path.slice(0, 60)}  ${r.ms}ms${r.error ? '  ' + r.error : ''}${r.ip ? '  ip ' + r.ip : ''}`);
  if (crash) console.log('\nCRASH: ' + (crash.stack || crash.message));

  console.log(`\n-- streams: ${streams.length} --`);
  for (const s of streams.slice(0, 8)) console.log(`${String(s.quality || '?').padEnd(14)} ${String(s.name || s.title || '').replace(/[\u200B\uFEFF]/g, '').slice(0, 50).padEnd(50)} ${s.url.slice(0, 90)}`);

  let reachable = false;
  if (streams.length) {
    const s = streams[0];
    const headers = Object.assign({}, s.headers || (s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) || {}, { Range: 'bytes=0-1023' });
    try {
      const r = await createFetch(cfg, {})(s.url, { headers, signal: AbortSignal.timeout(15000) });
      reachable = r.status === 200 || r.status === 206;
      console.log(`\nfirst stream answers: HTTP ${r.status} ${r.headers.get && r.headers.get('content-type') || ''} ${reachable ? '(playable)' : '(NOT playable from here; may still work with the player\'s own headers/IP)'}`);
    } catch (e) { console.log('\nfirst stream request failed: ' + e.message); }
  }

  const verdict = streams.length ? (reachable ? 'WORKING' : 'FOUND STREAMS, link check failed') : 'NOT WORKING (no streams)';
  console.log(`\nVERDICT: ${verdict}`);
  if (!streams.length) {
    const bad = trace.filter((r) => r.error || (r.status && r.status >= 400));
    if (bad.length) console.log('Failed requests: ' + bad.slice(0, 6).map((r) => `${r.host} ${r.status || r.error}`).join('; '));
    console.log('Read the provider log above: its last line says which step stopped.');
  }
  process.exit(streams.length && reachable ? 0 : 1);
})();
