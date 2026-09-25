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
  const cfgRaw = { tmdbKey: 'k'.repeat(32), providers: { 'fake-native': { enabled: false } }, dns: { mode: 'doh', rewrites: { 'mirror-me.example': 'mirror-new.example' } } };
  const prefix = `/c/${enc(cfgRaw)}`;

  await t('manifest is valid for Stremio', async () => {
    const r = await call('GET', `${prefix}/manifest.json`);
    assert.equal(r.statusCode, 200);
    const m = r.json;
    assert.deepEqual(m.resources, ['stream']);
    assert.ok(m.types.includes('movie') && m.types.includes('series'));
    assert.ok(Array.isArray(m.catalogs));
    assert.equal(m.behaviorHints.configurable, true);
    assert.match(m.logo, /^data:image\/svg\+xml;base64,/, 'manifest ships its own icon, not a placeholder');
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
    const c = { ...cfgRaw, providers: { ...cfgRaw.providers, fake: { enabled: false } } };
    const r = await call('GET', `/c/${enc(c)}/stream/movie/tt1375666.json`);
    assert.deepEqual(r.json.streams, []);
  });
  await t('sort by quality + maxPerProvider', async () => {
    const c = { ...cfgRaw, sort: 'quality', maxPerProvider: 1 };
    const r = await call('GET', `/c/${enc(c)}/stream/movie/tt1375666.json`);
    assert.equal(r.json.streams.length, 1);
    assert.equal(r.json.streams[0].name, 'fake\n1080p');
  });
  await t('native (behaviorHints) provider contract: headers and quality are recovered from text', async () => {
    const c = { tmdbKey: 'k'.repeat(32), providers: { fake: { enabled: false }, 'fake-native': { enabled: true } } };
    const r = await call('GET', `/c/${enc(c)}/stream/movie/tt1375666.json`);
    const s = r.json.streams;
    assert.equal(s.length, 2);
    assert.equal(s[0].name, 'fake-native\n4K', '2160p normalized to a 4K badge from the title text');
    assert.deepEqual(s[0].behaviorHints.proxyHeaders, { request: { Referer: 'https://mirror-me.example/' } }, 'behaviorHints.proxyHeaders carried through untouched');
    const sorted = await call('GET', `/c/${enc({ ...c, sort: 'quality' })}/stream/movie/tt1375666.json`);
    assert.equal(sorted.json.streams[0].name, 'fake-native\n4K', '2160p (no `quality` field) still sorts above 720p');
    const testRes = await call('POST', '/api/test', { body: { config: c, type: 'movie', id: 'tt1375666' } });
    const row = testRes.json.streams.find((x) => x.quality === '2160p');
    assert.ok(row, 'quality is recovered for the /api/test view too');
    assert.deepEqual(row.headers, { Referer: 'https://mirror-me.example/' });
  });

  const realDir = path.join(__dirname, '..', 'providers');
  const realManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

  await t('dahmermovies falls through to a later folder-name guess when an earlier one has no matches', async () => {
    const code = fs.readFileSync(path.join(realDir, 'dahmermovies.js'), 'utf8');
    let folderCalls = 0;
    const fetchFn = async (url) => {
      if (String(url).includes('api.themoviedb.org')) {
        return { ok: true, status: 200, text: async () => '', json: async () => ({ title: "Foo & Bar's: Two", release_date: '2021-01-01' }) };
      }
      folderCalls++;
      const decoded = decodeURIComponent(url);
      // Only the "strip all punctuation" folder-name guess matches this
      // fake listing; every earlier, punctuation-preserving guess must
      // come back empty and be tried in turn before this one is reached.
      const isRightGuess = decoded.includes('Foo Bars Two (2021)');
      const html = isRightGuess
        ? '<table><tr><td><a href="Foo.Bars.Two.2021.1080p.WEB-DL.mkv">Foo.Bars.Two.2021.1080p.WEB-DL.mkv</a></td></tr></table>'
        : '<table></table>';
      return { ok: true, status: 200, text: async () => html, json: async () => ({}) };
    };
    const api = loadProvider({ key: 'real:dahmermovies-fallback', code, fetch: fetchFn });
    const streams = await api.getStreams('123', 'movie', null, null);
    assert.ok(folderCalls >= 2, 'tried more than one folder-name guess before succeeding');
    assert.equal(streams.length, 1);
    assert.match(streams[0].url, /Foo\.Bars\.Two\.2021\.1080p/);
  });

  await t('all 9 newly added providers are registered and load', () => {
    const ids = realManifest.scrapers.map((p) => p.id);
    for (const id of ['animesalt', 'animeworld', 'hdhub4u', 'hianime', 'moviebox', 'reanime', 'rogmovies', 'uhdmovies', 'vegamovies']) {
      assert.ok(ids.includes(id), `${id} missing from manifest`);
    }
    assert.equal(realManifest.scrapers.length, 14);
    for (const entry of realManifest.scrapers) {
      const code = fs.readFileSync(path.join(realDir, path.basename(entry.filename)), 'utf8');
      const api = loadProvider({ key: `real:${entry.id}`, code, fetch: async () => { throw new Error('offline'); } });
      assert.equal(typeof api.getStreams, 'function', entry.id);
    }
  });
  await t('mirror-domain detection covers ENDPOINT-named and array-literal constants', () => {
    const hdhub4uSrc = fs.readFileSync(path.join(realDir, 'hdhub4u.js'), 'utf8');
    assert.deepEqual(registry.detectDomains(hdhub4uSrc), ['new6.hdhub4u.cl', 'search.pingora.fyi']);
    const reanimeSrc = fs.readFileSync(path.join(realDir, 'reanime.js'), 'utf8');
    const domains = registry.detectDomains(reanimeSrc);
    assert.ok(['reanime.to', 'reanime.cz', 'reanime.wtf'].every((d) => domains.includes(d)));
  });
  await t('hianime exposes its sub/dub/quality settings schema', async () => {
    const code = fs.readFileSync(path.join(realDir, 'hianime.js'), 'utf8');
    const api = loadProvider({ key: 'schema:hianime', code, fetch: async () => {} });
    const schema = await api.onSettings();
    assert.ok(schema.some((s) => s.key === 'enableDub'));
    assert.ok(schema.some((s) => s.key === 'enable1080p'));
  });
  await t('crypto-js-lite matches known MD5/HMAC-MD5 vectors (moviebox\'s dependency, when the real package is absent)', () => {
    const c = require('../lib/cryptojs-lite');
    assert.equal(c.MD5('').toString(c.enc.Hex), 'd41d8cd98f00b204e9800998ecf8427e');
    assert.equal(c.HmacMD5('The quick brown fox jumps over the lazy dog', 'key').toString(c.enc.Hex), '80070713463e7749b90c2dc24911e275');
    assert.equal(c.enc.Base64.parse(Buffer.from('hello world').toString('base64')).toString(c.enc.Utf8), 'hello world');
  });
  await t('moviebox resolves crypto-js (real package or lite fallback) at module load time', () => {
    // moviebox dereferences crypto-js via an esbuild __toESM() helper at the
    // top of the file, so merely loading the module (not calling getStreams)
    // already exercises the fallback path end to end.
    const code = fs.readFileSync(path.join(realDir, 'moviebox.js'), 'utf8');
    const api = loadProvider({ key: 'real:moviebox', code, fetch: async () => { throw new Error('offline'); } });
    assert.equal(typeof api.getStreams, 'function');
  });

  console.log('stream metadata (badges, server, language, audio/video codec)');
  const { parseStreamMeta } = require('../lib/streamMeta');
  await t('parses language/audio/codec/server out of a HubCloud-style release string', () => {
    const meta = parseStreamMeta({
      name: 'Rogmovies • 2160P • HubCloud', title: 'Rogmovies • 2160P • HubCloud',
      size: 'English • Hindi • 3.1 GB\nWEB-DL • DDP5.1 • Atmos • H.265',
      url: 'https://hubcloud.ist/abc',
    });
    assert.equal(meta.size, '3.1 GB');
    assert.equal(meta.language, 'English • Hindi');
    assert.equal(meta.audioCodec, 'DDP5.1 • Atmos');
    assert.equal(meta.videoCodec, 'H.265');
    assert.equal(meta.server, 'HubCloud');
    assert.deepEqual(meta.badges, ['4K', 'H.265'], '2160p normalizes to a 4K badge');
  });
  await t('parses a plain scraped release filename', () => {
    const meta = parseStreamMeta({ title: 'Movie.Name.2023.1080p.WEB-DL.DDP5.1.Hindi.English.x264', size: '1.4GB' });
    assert.equal(meta.size, '1.4 GB');
    assert.equal(meta.language, 'Hindi • English'); // appears in that order in the release name
    assert.equal(meta.audioCodec, 'DDP5.1');
    assert.equal(meta.videoCodec, 'H.264');
    assert.deepEqual(meta.badges, ['1080p', 'H.264']);
  });
  await t('omits fields it cannot determine, rather than guessing', () => {
    const meta = parseStreamMeta({ title: 'unlabeled stream', url: 'https://example.com/x.mkv' });
    assert.deepEqual(meta, { quality: '', size: '', language: '', audioCodec: '', videoCodec: '', hdr: '', server: '', badges: [] });
  });
  await t('end to end: the Stremio stream gets a badge name and clean icon-prefixed description', async () => {
    const c = { tmdbKey: 'k'.repeat(32), providers: { fake: { enabled: false }, 'fake-native': { enabled: true } } };
    const r = await call('GET', `/c/${enc(c)}/stream/movie/tt1375666.json`);
    const s = r.json.streams[0];
    assert.equal(s.name, 'fake-native\n4K');
    assert.ok(!s.description.includes('fake-native'), 'no redundant title line when title === name');
  });
  console.log('nuvio');
  await t('nuvio manifest lists scrapers with relative filenames', async () => {
    const r = await call('GET', `${prefix}/nuvio/manifest.json`);
    assert.ok(Array.isArray(r.json.scrapers));
    assert.ok(r.json.scrapers.some((sc) => sc.filename === 'providers/fake.js'));
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
      const c = await call('POST', '/api/profile', { body: { config: { tmdbKey: 'k'.repeat(32), providers: { fake: { enabled: true }, 'fake-native': { enabled: false } } } } });
      assert.equal(c.statusCode, 200);
      const { id, secret } = c.json;
      const m = await call('GET', `/u/${id}/manifest.json`);
      assert.equal(m.statusCode, 200);
      assert.equal((await call('GET', `/api/profile/${id}`, { headers: { 'x-profile-secret': 'wrong' } })).statusCode, 403);
      const got = await call('GET', `/api/profile/${id}`, { headers: { 'x-profile-secret': secret } });
      assert.equal(got.json.config.providers.fake.enabled, true);
      const put = await call('PUT', `/api/profile/${id}`, { headers: { 'x-profile-secret': secret }, body: { config: { tmdbKey: 'k'.repeat(32), providers: { fake: { enabled: false }, 'fake-native': { enabled: false } } } } });
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
