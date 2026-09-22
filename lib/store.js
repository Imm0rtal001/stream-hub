'use strict';
// Optional persistent profiles on Upstash Redis (Vercel Marketplace integration).
// Uses the REST API directly so there is no extra dependency.
const { sha256, randHex } = require('./util');
const { userView } = require('./config');

const url = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const token = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const enabled = () => Boolean(url() && token());

let http = (u, o) => globalThis.fetch(u, o);
const _setHttp = (fn) => { http = fn; };

async function redis(...cmd) {
  const r = await http(url(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(5000),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `Redis HTTP ${r.status}`);
  return j.result;
}

const key = (id) => `streamhub:profile:${id}`;
const validId = (id) => /^[a-f0-9]{18}$/.test(id);

async function getProfile(id) {
  if (!enabled() || !validId(id)) return null;
  const raw = await redis('GET', key(id));
  return raw ? JSON.parse(raw) : null;
}

async function createProfile(config) {
  const id = randHex(9);
  const secret = randHex(24);
  await redis('SET', key(id), JSON.stringify({ secretHash: sha256(secret), config: userView(config), updated: Date.now() }));
  return { id, secret };
}

async function updateProfile(id, secret, config) {
  const p = await getProfile(id);
  if (!p) return { ok: false, status: 404 };
  if (p.secretHash !== sha256(secret || '')) return { ok: false, status: 403 };
  p.config = userView(config);
  p.updated = Date.now();
  await redis('SET', key(id), JSON.stringify(p));
  return { ok: true };
}

async function readWithSecret(id, secret) {
  const p = await getProfile(id);
  if (!p) return { ok: false, status: 404 };
  if (p.secretHash !== sha256(secret || '')) return { ok: false, status: 403 };
  return { ok: true, config: p.config };
}

module.exports = { enabled, getProfile, createProfile, updateProfile, readWithSecret, _setHttp };
