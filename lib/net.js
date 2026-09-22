'use strict';
const { resolveHost, makeLookup } = require('./dns');

let undici = null;
try { undici = require('undici'); } catch { /* falls back to global fetch (no custom resolver) */ }

let backend = null; // tests can replace the transport
const _setBackend = (fn) => { backend = fn; };

const agents = new Map();
function getAgent(d) {
  if (!undici) return undefined;
  const key = JSON.stringify([d.mode, d.doh, d.dohUrl, d.ipv4Only, d.hosts]);
  let a = agents.get(key);
  if (!a) {
    if (agents.size >= 12) {
      const [oldKey, old] = agents.entries().next().value;
      agents.delete(oldKey);
      old.close().catch(() => {});
    }
    a = new undici.Agent({
      connect: { lookup: makeLookup(d), timeout: 10000 },
      keepAliveTimeout: 10000,
      connections: 24,
    });
    agents.set(key, a);
  }
  return a;
}

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function headersToObject(h) {
  if (!h) return {};
  if (typeof h.entries === 'function' && !Array.isArray(h)) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...h };
}

/**
 * Build a fetch() that applies the user's DNS config:
 *  - domain rewrites (mirror domains),
 *  - hosts overrides / DoH resolution (through the undici dispatcher),
 *  - private-address blocking, per-request timeout and a request trace.
 */
function createFetch(cfg, { trace = [], signal } = {}) {
  const d = cfg.dns || {};
  const agent = getAgent(d);
  const transport = () => backend || (undici ? undici.fetch : globalThis.fetch);
  const perRequestMs = Math.min(cfg.timeoutMs || 25000, 30000);

  return async function scopedFetch(input, init = {}) {
    const raw = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
    const u = new URL(raw);
    const originalHost = u.hostname;
    const rewritten = d.rewrites && d.rewrites[originalHost];
    if (rewritten) u.hostname = rewritten;

    const headers = headersToObject(init.headers);
    const has = (n) => Object.keys(headers).some((k) => k.toLowerCase() === n);
    if (!has('user-agent')) headers['User-Agent'] = DEFAULT_UA;
    if (rewritten) {
      for (const k of Object.keys(headers)) {
        if (['referer', 'origin'].includes(k.toLowerCase()) && typeof headers[k] === 'string') {
          headers[k] = headers[k].split(originalHost).join(rewritten);
        }
      }
    }

    const entry = { host: u.hostname, path: u.pathname, method: (init.method || 'GET').toUpperCase() };
    if (rewritten) entry.mirror = `${originalHost} → ${rewritten}`;
    const t0 = Date.now();
    const push = (extra) => { if (trace.length < 300) trace.push({ ...entry, ms: Date.now() - t0, ...extra }); };

    let info;
    try {
      info = await resolveHost(u.hostname, d);
    } catch (err) {
      push({ error: err.message });
      throw err;
    }
    entry.dns = info.source;
    entry.ip = info.ips[0];

    const signals = [AbortSignal.timeout(perRequestMs)];
    if (init.signal) signals.push(init.signal);
    if (signal) signals.push(signal);

    try {
      const res = await transport()(u.toString(), { ...init, headers, signal: AbortSignal.any(signals), dispatcher: agent });
      push({ status: res.status });
      return res;
    } catch (err) {
      push({ error: err.cause && err.cause.code ? `${err.message} (${err.cause.code})` : err.message });
      throw err;
    }
  };
}

module.exports = { createFetch, _setBackend, hasUndici: () => Boolean(undici) };
