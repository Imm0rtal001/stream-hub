'use strict';
const net = require('net');

const DOH_PRESETS = {
  cloudflare: 'https://1.1.1.1/dns-query',
  google: 'https://8.8.8.8/resolve',
  quad9: 'https://dns.quad9.net:5053/dns-query',
};

const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

function cleanHost(v, allowWildcard = true) {
  if (typeof v !== 'string') return null;
  let h = v.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
  if (!allowWildcard && h.startsWith('*.')) return null;
  return HOST_RE.test(h) ? h : null;
}

function cleanMap(obj, valueFn, { max = 60, wildcard = true } = {}) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj).slice(0, max)) {
    const hk = cleanHost(k, wildcard);
    const hv = valueFn(v);
    if (hk && hv) out[hk] = hv;
  }
  return out;
}

const clampInt = (v, min, max, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

function cleanSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, 60)) {
    if (!/^[\w.-]{1,64}$/.test(k)) continue;
    if (['string', 'number', 'boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
}

/**
 * Turn arbitrary (untrusted) input into a valid config.
 * `env` supplies server-wide defaults; pass {} to get the user-only view.
 */
function normalize(input, env = process.env) {
  const i = input && typeof input === 'object' ? input : {};
  const d = i.dns && typeof i.dns === 'object' ? i.dns : {};

  const modeOk = (m) => m === 'system' || m === 'doh';
  const mode = modeOk(d.mode) ? d.mode : modeOk(env.DNS_MODE) ? env.DNS_MODE : 'system';
  const dohRaw = d.doh || env.DOH_PROVIDER || 'cloudflare';
  let doh = ['cloudflare', 'google', 'quad9', 'custom'].includes(dohRaw) ? dohRaw : 'cloudflare';
  const urlRaw = typeof d.dohUrl === 'string' && d.dohUrl.trim() ? d.dohUrl.trim() : env.DOH_URL || '';
  const dohUrl = /^https:\/\//i.test(urlRaw) ? urlRaw.slice(0, 300) : '';
  if (doh === 'custom' && !dohUrl) doh = 'cloudflare';

  const providers = {};
  if (i.providers && typeof i.providers === 'object') {
    for (const [id, p] of Object.entries(i.providers).slice(0, 60)) {
      if (!/^[\w.-]{1,64}$/.test(id) || !p || typeof p !== 'object') continue;
      const entry = {};
      if (typeof p.enabled === 'boolean') entry.enabled = p.enabled;
      const s = cleanSettings(p.settings);
      if (Object.keys(s).length) entry.settings = s;
      providers[id] = entry;
    }
  }

  return {
    v: 1,
    tmdbKey: (typeof i.tmdbKey === 'string' ? i.tmdbKey.trim().slice(0, 64) : '') || env.TMDB_API_KEY || '',
    timeoutMs: clampInt(i.timeoutMs, 3000, 55000, 25000),
    sort: i.sort === 'quality' ? 'quality' : 'provider',
    maxPerProvider: clampInt(i.maxPerProvider, 0, 50, 0),
    providers,
    dns: {
      mode,
      doh,
      dohUrl,
      ipv4Only: d.ipv4Only !== false,
      hosts: cleanMap(d.hosts, (v) => (typeof v === 'string' && net.isIP(v.trim()) ? v.trim() : null)),
      rewrites: cleanMap(d.rewrites, (v) => cleanHost(v, false), { wildcard: false }),
    },
  };
}

/** What we store / show back to the UI: never includes server env secrets. */
const userView = (input) => normalize(input, {});

module.exports = { normalize, userView, cleanHost, DOH_PRESETS };
