'use strict';
const nodeDns = require('dns').promises;
const net = require('net');
const { DOH_PRESETS } = require('./config');

const cache = new Map(); // "host|A" -> { ips, exp }
const CACHE_MAX = 500;

let httpGet = (u, o) => globalThis.fetch(u, o);
const _setHttp = (fn) => { httpGet = fn; cache.clear(); };

const allowPrivate = () => process.env.ALLOW_PRIVATE_NETWORK === '1';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
  if (v.startsWith('::ffff:')) {
    const tail = v.slice(7);
    return net.isIPv4(tail) ? isPrivateIp(tail) : true;
  }
  return false;
}

function hostsMatch(hosts, host) {
  if (!hosts) return null;
  if (hosts[host]) return hosts[host];
  for (const [k, ip] of Object.entries(hosts)) {
    if (k.startsWith('*.') && host.endsWith(k.slice(1))) return ip;
  }
  return null;
}

const dohBase = (d) => (d.doh === 'custom' && d.dohUrl ? d.dohUrl : DOH_PRESETS[d.doh] || DOH_PRESETS.cloudflare);

async function dohQuery(base, host, type) {
  const key = `${base}|${host}|${type}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ips;

  const u = `${base}${base.includes('?') ? '&' : '?'}name=${encodeURIComponent(host)}&type=${type}`;
  const r = await httpGet(u, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`DoH HTTP ${r.status}`);
  const j = await r.json();
  const want = type === 'A' ? 1 : 28;
  const answers = (j.Answer || []).filter((a) => a.type === want && net.isIP(a.data));
  const ips = answers.map((a) => a.data);
  const ttl = Math.min(300, ...answers.map((a) => a.TTL || 60));
  if (ips.length) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { ips, exp: Date.now() + Math.max(15, ttl) * 1000 });
  }
  return ips;
}

async function viaDoh(host, d) {
  const base = dohBase(d);
  const types = d.ipv4Only === false ? ['A', 'AAAA'] : ['A'];
  const settled = await Promise.allSettled(types.map((t) => dohQuery(base, host, t)));
  const ips = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  if (!ips.length) {
    const failed = settled.find((s) => s.status === 'rejected');
    throw failed ? failed.reason : new Error('DoH returned no records');
  }
  return ips;
}

async function viaSystem(host, d) {
  const list = await nodeDns.lookup(host, { all: true, family: d.ipv4Only === false ? 0 : 4 });
  return list.map((x) => x.address);
}

/** Resolve a hostname according to the DNS config. Returns { ips, source, ms }. */
async function resolveHost(host, d = {}) {
  const t0 = Date.now();
  let ips;
  let source;

  if (net.isIP(host)) {
    ips = [host];
    source = 'literal';
  } else if (hostsMatch(d.hosts, host)) {
    ips = [hostsMatch(d.hosts, host)];
    source = 'hosts override';
  } else if (d.mode === 'doh') {
    try {
      ips = await viaDoh(host, d);
      source = `doh:${d.doh}`;
    } catch (err) {
      ips = await viaSystem(host, d);
      source = `system (doh failed: ${err.message})`;
    }
  } else {
    ips = await viaSystem(host, d);
    source = 'system';
  }

  if (!allowPrivate()) ips = ips.filter((ip) => !isPrivateIp(ip));
  if (!ips.length) {
    throw Object.assign(new Error(`Blocked: ${host} resolves to a private or reserved address`), { code: 'EBLOCKED' });
  }
  ips.sort((a, b) => (net.isIPv4(a) ? 0 : 1) - (net.isIPv4(b) ? 0 : 1));
  return { ips, source, ms: Date.now() - t0 };
}

/** dns.lookup-compatible function for undici's `connect.lookup`. */
function makeLookup(d) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    resolveHost(hostname, d).then((r) => {
      let list = r.ips.map((ip) => ({ address: ip, family: net.isIPv6(ip) ? 6 : 4 }));
      if (options && (options.family === 4 || options.family === 6)) {
        const f = list.filter((x) => x.family === options.family);
        if (f.length) list = f;
      }
      if (options && options.all) cb(null, list);
      else cb(null, list[0].address, list[0].family);
    }, (err) => cb(err));
  };
}

module.exports = { resolveHost, makeLookup, isPrivateIp, _setHttp, _clearCache: () => cache.clear() };
