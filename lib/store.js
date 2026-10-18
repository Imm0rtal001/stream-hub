'use strict';
// Persistent profiles: one stable link whose settings are saved automatically.
// Backends (first match wins):
//   1. Upstash Redis REST (Vercel Marketplace)  -> UPSTASH_REDIS_REST_URL / _TOKEN (or KV_REST_API_*)
//   2. A JSON file for local / self-hosted runs -> DATA_DIR (dev-server.js defaults it to ./data)
// Vercel's filesystem is read-only/ephemeral, so on Vercel use Redis.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sha256, randHex } = require('./util');
const { userView } = require('./config');

const url = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const token = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const redisOn = () => Boolean(url() && token());
const fileDir = () => process.env.DATA_DIR || '';
const fileOn = () => !redisOn() && Boolean(fileDir());
const enabled = () => redisOn() || fileOn();
const kind = () => (redisOn() ? 'redis' : fileOn() ? 'file' : null);

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

// ---- file backend (serialised writes, atomic rename) ----
let fileQueue = Promise.resolve();
const filePath = () => path.join(fileDir(), 'profiles.json');
function readFileMap() {
  try { return JSON.parse(fs.readFileSync(filePath(), 'utf8')) || {}; } catch { return {}; }
}
function writeFileMap(map) {
  fs.mkdirSync(fileDir(), { recursive: true });
  const tmp = `${filePath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map));
  fs.renameSync(tmp, filePath());
}

async function rawGet(k) {
  if (redisOn()) return redis('GET', k);
  return readFileMap()[k] || null;
}
async function rawSet(k, v) {
  if (redisOn()) return redis('SET', k, v);
  const job = fileQueue.then(() => { const m = readFileMap(); m[k] = v; writeFileMap(m); });
  fileQueue = job.catch(() => {});
  return job;
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const key = (id) => `streamhub:profile:${id}`;
const validId = (id) => /^[a-f0-9]{18}$/.test(id);

async function getProfile(id) {
  if (!enabled() || !validId(id)) return null;
  const raw = await rawGet(key(id));
  return raw ? JSON.parse(raw) : null;
}

async function createProfile(config) {
  const id = randHex(9);
  const secret = randHex(24);
  await rawSet(key(id), JSON.stringify({ secretHash: sha256(secret), config: userView(config), updated: Date.now() }));
  return { id, secret };
}

async function updateProfile(id, secret, config) {
  const p = await getProfile(id);
  if (!p) return { ok: false, status: 404 };
  if (!safeEq(p.secretHash, sha256(secret || ''))) return { ok: false, status: 403 };
  p.config = userView(config);
  p.updated = Date.now();
  await rawSet(key(id), JSON.stringify(p));
  return { ok: true, updated: p.updated };
}

async function readWithSecret(id, secret) {
  const p = await getProfile(id);
  if (!p) return { ok: false, status: 404 };
  if (!safeEq(p.secretHash, sha256(secret || ''))) return { ok: false, status: 403 };
  return { ok: true, config: p.config, updated: p.updated };
}

module.exports = { enabled, kind, getProfile, createProfile, updateProfile, readWithSecret, _setHttp };
