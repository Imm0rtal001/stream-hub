'use strict';
process.env.PROVIDERS_DIR = require('path').join(__dirname, 'fixtures', 'providers');
delete process.env.TMDB_API_KEY;
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const dns = require('../lib/dns');
const net = require('../lib/net');
const registry = require('../lib/registry');
const { normalize } = require('../lib/config');
const { enc } = require('../lib/util');
const { handler: route } = require('../lib/router');
const { loadProvider } = require('../lib/sandbox');

registry._configure({ scrapers: [] }); // fixtures dir provides "fake" via auto-detect

const requests = [];
net._setBackend(async (url, init) => {
  const u = new URL(url);
  requests.push({ url, headers: init.headers });
  if (u.hostname === 'api.themoviedb.org' && u.pathname.startsWith('/3/find/')) {
    return new Response(JSON.stringify({ movie_results: [{ id: 27205 }], tv_results: [{ id: 1399 }] }), { status: 200 });
  }
  if (u.hostname === 'mirror-new.example' || u.hostname === 'mirror-me.example') {
    return new Response(JSON.stringify({ url: 'https://cdn.example/file.mkv' }), { status: 200 });
  }
  return new Response('nope', { status: 404 });
});
dns._setHttp(async (url) => {
  const u = new URL(url);
  const name = u.searchParams.get('name');
  const map = { 'api.themoviedb.org': '13.224.161.90', 'mirror-new.example': '93.184.216.34', 'mirror-me.example': '93.184.216.35', 'evil.example': '127.0.0.1' };
  const ip = map[name];
  return new Response(JSON.stringify({ Answer: ip ? [{ type: 1, TTL: 120, data: ip }] : [] }), { status: 200 });
});

function call(method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers: { host: 'hub.test', 'x-forwarded-proto': 'https', ...headers }, body };
    const out = { headers: {}, statusCode: 200 };
    const res = {
      setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; },
      set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
      end: (b) => { out.body = b; try { out.json = JSON.parse(b); } catch { /* not json */ } resolve(out); },
    };
    route(req, res).catch(reject);
  });
}

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
}

(async () => {
  console.log('config');
  await t('normalize sanitises hosts, rewrites and clamps numbers', () => {
    const c = normalize({
      timeoutMs: 999999, tmdbKey: ' abc ', sort: 'weird',
      dns: { mode: 'doh', doh: 'nope', hosts: { 'A.Example': '1.2.3.4', 'bad host': '1.1.1.1', 'x.example': 'not-ip' }, rewrites: { 'old.example': 'https://new.example/path', '*.wild.example': 'z.example' } },
    }, {});
    assert.equal(c.timeoutMs, 55000);
    assert.equal(c.tmdbKey, 'abc');
    assert.equal(c.sort, 'provider');
    assert.equal(c.dns.doh, 'cloudflare');
    assert.deepEqual(c.dns.hosts, { 'a.example': '1.2.3.4' });
    assert.deepEqual(c.dns.rewrites, { 'old.example': 'new.example' });
  });

  console.log('dns');
  await t('DoH resolves and blocks private addresses', async () => {
    const d = normalize({ dns: { mode: 'doh' } }, {}).dns;
    const r = await dns.resolveHost('api.themoviedb.org', d);
    assert.deepEqual(r.ips, ['13.224.161.90']);
    assert.match(r.source, /doh:cloudflare/);
    await assert.rejects(() => dns.resolveHost('evil.example', d), /private or reserved/);
  });
  await t('hosts override beats DoH, wildcard works', async () => {
    const d = normalize({ dns: { mode: 'doh', hosts: { 'api.themoviedb.org': '9.9.9.9', '*.cdn.example': '8.8.4.4' } } }, {}).dns;
    assert.deepEqual((await dns.resolveHost('api.themoviedb.org', d)).ips, ['9.9.9.9']);
    assert.deepEqual((await dns.resolveHost('a.cdn.example', d)).ips, ['8.8.4.4']);
  });
  await t('private ip detection', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.20.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.ok(dns.isPrivateIp(ip), ip);
    for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700::1111']) assert.ok(!dns.isPrivateIp(ip), ip);
  });

  console.log('sandbox + real providers');
  await t('all shipped providers compile and export getStreams', () => {
    const dir = path.join(__dirname, '..', 'providers');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 5);
    for (const f of files) {
      const api = loadProvider({ key: `real:${f}`, code: fs.readFileSync(path.join(dir, f), 'utf8'), fetch: async () => { throw new Error('offline'); } });
      assert.equal(typeof api.getStreams, 'function', f);
    }
  });
  await t('4khdhub settings schema is readable', async () => {
    const dir = path.join(__dirname, '..', 'providers');
    const api = loadProvider({ key: 'real:4k', code: fs.readFileSync(path.join(dir, '4khdhub.js'), 'utf8'), fetch: async () => { } });
    const schema = await api.onSettings();
    assert.ok(schema.some((s) => s.type === 'toggle' && s.key === 'sortBySize'));
    assert.ok(schema.some((s) => s.type === 'select' && s.key === 'max4K'));
  });

  console.log('stremio');
  const cfgRaw = { tmdbKey: 'k'.repeat(32), dns: { mode: 'doh', rewrites: { 'mirror-me.example': 'mirror-new.example' } } };
  const prefix = `/c/${enc(cfgRaw)}`;

  await t('manifest is valid for Stremio', async () => {
    const r = await call('GET', `${prefix}/manifest.json`);
    assert.equal(r.statusCode, 200);
    const m = r.json;
    assert.deepEqual(m.resources, ['stream']);
    assert.ok(m.types.includes('movie') && m.types.includes('series'));
    assert.ok(Array.isArray(m.catalogs));
    assert.equal(m.behaviorHints.configurable, true);
    assert.equal(r.headers['access-control-allow-origin'], '*');
  });
  await t('movie stream: IMDb→TMDB, mirror rewrite, DoH, header proxying, invisible chars stripped', async () => {
    requests.length = 0;
    const r = await call('GET', `${prefix}/stream/movie/tt1375666.json`);
    assert.equal(r.statusCode, 200);
    const s = r.json.streams;
    assert.equal(s.length, 2, 'ftp stream dropped');
    assert.equal(s[0].url, 'https://cdn.example/file.mkv');
    assert.equal(s[0].name, 'fake\n1080p');
    assert.ok(!/[\u200B\uFEFF]/.test(s[0].description));
    assert.deepEqual(s[0].behaviorHints.proxyHeaders, { request: { Referer: 'https://mirror-me.example/' } });
    assert.ok(s[0].behaviorHints.notWebReady);
    const site = requests.find((x) => x.url.includes('/search?id=27205'));
    assert.ok(site, 'provider request reached the mirror');
    assert.ok(site.url.startsWith('https://mirror-new.example/'), site.url);
    assert.equal(site.headers.Referer, 'https://mirror-new.example/');
    assert.match(r.headers['cache-control'], /s-maxage=300/);
  });
  await t('series stream needs season/episode and passes them on', async () => {
    requests.length = 0;
    const bad = await call('GET', `${prefix}/stream/series/tt0903747.json`);
    assert.deepEqual(bad.json.streams, []);
    const ok = await call('GET', `${prefix}/stream/series/${encodeURIComponent('tt0903747:2:5')}.json`);
    assert.equal(ok.json.streams.length, 2);
    assert.ok(requests.some((x) => x.url.includes('t=tv&s=2&e=5')));
  });
  await t('tmdb: ids work without lookup', async () => {
    requests.length = 0;
    const r = await call('GET', `${prefix}/stream/movie/${encodeURIComponent('tmdb:27205')}.json`);
    assert.equal(r.json.streams.length, 2);
    assert.ok(!requests.some((x) => x.url.includes('/find/')));
  });
  await t('missing TMDB key returns a helpful external link', async () => {
    const r = await call('GET', `/c/${enc({})}/stream/movie/tt1375666.json`);
    assert.equal(r.json.streams.length, 1);
    assert.match(r.json.streams[0].externalUrl, /^https:\/\/hub\.test\/c\/.+\/configure$/);
    assert.equal(r.headers['cache-control'], 'no-store');
  });
  await t('provider disabled in config is skipped', async () => {
    const c = { ...cfgRaw, providers: { fake: { enabled: false } } };
    const r = await call('GET', `/c/${enc(c)}/stream/movie/tt1375666.json`);
    assert.deepEqual(r.json.streams, []);
  });
  await t('sort by quality + maxPerProvider', async () => {
    const c = { ...cfgRaw, sort: 'quality', maxPerProvider: 1 };
    const r = await call('GET', `/c/${enc(c)}/stream/movie/tt1375666.json`);
    assert.equal(r.json.streams.length, 1);
    assert.equal(r.json.streams[0].name, 'fake\n1080p');
  });

  console.log('nuvio');
  await t('nuvio manifest lists scrapers with relative filenames', async () => {
    const r = await call('GET', `${prefix}/nuvio/manifest.json`);
    assert.ok(Array.isArray(r.json.scrapers));
    assert.equal(r.json.scrapers[0].filename, 'providers/fake.js');
  });
  await t('nuvio provider file has mirror domains rewritten', async () => {
    const r = await call('GET', `${prefix}/nuvio/providers/fake.js`);
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['content-type'], /javascript/);
    assert.ok(r.body.includes('https://mirror-new.example') && !r.body.includes('mirror-me.example'));
    const bad = await call('GET', `${prefix}/nuvio/providers/..%2F..%2Fetc.js`);
    assert.equal(bad.statusCode, 404);
  });

  console.log('api');
  await t('providers API exposes settings schema + detected domains', async () => {
    const r = await call('GET', '/api/providers');
    const f = r.json.providers.find((p) => p.id === 'fake');
    assert.equal(f.settings[0].key, 'flag');
    assert.deepEqual(f.domains, ['mirror-me.example']);
  });
  await t('test endpoint returns streams, per-provider report and trace', async () => {
    const r = await call('POST', '/api/test', { body: { config: cfgRaw, type: 'movie', id: 'tt1375666' } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json.streams.length, 2);
    assert.equal(r.json.report[0].id, 'fake');
    assert.ok(r.json.trace.some((x) => x.mirror));
    assert.ok(r.json.logs.some((l) => l.includes('fake provider got')));
  });
  await t('dns endpoint resolves hosts and reports failures', async () => {
    const r = await call('POST', '/api/dns', { body: { config: cfgRaw, hosts: ['api.themoviedb.org', 'mirror-me.example', 'evil.example'] } });
    const by = Object.fromEntries(r.json.results.map((x) => [x.host, x]));
    assert.deepEqual(by['api.themoviedb.org'].ips, ['13.224.161.90']);
    assert.equal(by['mirror-me.example'].target, 'mirror-new.example');
    assert.match(by['evil.example'].error, /private/);
  });
  await t('profiles are disabled without Redis', async () => {
    const r = await call('POST', '/api/profile', { body: { config: {} } });
    assert.equal(r.statusCode, 501);
  });
  await t('profiles: create, edit with secret, serve via /u/<id>', async () => {
    const store = require('../lib/store');
    const mem = new Map();
    store._setHttp(async (_u, o) => {
      const [cmd, k, v] = JSON.parse(o.body);
      if (cmd === 'SET') { mem.set(k, v); return new Response(JSON.stringify({ result: 'OK' })); }
      return new Response(JSON.stringify({ result: mem.get(k) || null }));
    });
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    try {
      const c = await call('POST', '/api/profile', { body: { config: { tmdbKey: 'k'.repeat(32), providers: { fake: { enabled: true } } } } });
      assert.equal(c.statusCode, 200);
      const { id, secret } = c.json;
      const m = await call('GET', `/u/${id}/manifest.json`);
      assert.equal(m.statusCode, 200);
      assert.equal((await call('GET', `/api/profile/${id}`, { headers: { 'x-profile-secret': 'wrong' } })).statusCode, 403);
      const got = await call('GET', `/api/profile/${id}`, { headers: { 'x-profile-secret': secret } });
      assert.equal(got.json.config.providers.fake.enabled, true);
      const put = await call('PUT', `/api/profile/${id}`, { headers: { 'x-profile-secret': secret }, body: { config: { tmdbKey: 'k'.repeat(32), providers: { fake: { enabled: false } } } } });
      assert.equal(put.statusCode, 200);
      const s1 = await call('GET', `/u/${id}/stream/movie/tt1375666.json`);
      assert.deepEqual(s1.json.streams, [], 'edited profile disables the provider');
      assert.equal((await call('GET', '/u/000000000000000000/manifest.json')).statusCode, 404);
    } finally {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
  });
  await t('bad config path returns 400, unknown route 404', async () => {
    assert.equal((await call('GET', '/c/!!!/manifest.json')).statusCode, 400);
    assert.equal((await call('GET', `${prefix}/nope`)).statusCode, 404);
  });

  console.log(`\n${passed} passed${process.exitCode ? ' — with failures' : ''}`);
})();
