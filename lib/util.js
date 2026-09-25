'use strict';
const crypto = require('crypto');

const enc = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
const dec = (str) => JSON.parse(Buffer.from(String(str), 'base64url').toString('utf8'));
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Profile-Secret');
}

function send(res, status, body, type, cache) {
  cors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(body);
}
const json = (res, status, obj, cache) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', cache);

async function readJson(req, limit = 200000) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function originOf(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const isLocal = /^(localhost|127\.|\[::1\])/.test(host);
  return `${isLocal ? 'http' : proto}://${host}`;
}

module.exports = { enc, dec, sha256, randHex, cors, send, json, readJson, originOf };

const QUALITY_RE = /(2160p|1440p|1080p|720p|480p|360p|4k)/i;

/**
 * A provider may return the "simple" contract ({url, quality, headers, ...})
 * or a "native" Stremio-shaped stream (with behaviorHints.proxyHeaders.request
 * already set, and quality baked into name/title text instead of its own
 * field). These two helpers normalize either shape for display and sorting.
 */
function streamHeaders(s) {
  if (s.headers && typeof s.headers === 'object') return s.headers;
  const ph = s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request;
  return ph && typeof ph === 'object' ? ph : null;
}
function streamQuality(s) {
  if (s.quality) return String(s.quality);
  const m = QUALITY_RE.exec(`${s.title || ''} ${s.name || ''}`);
  return m ? m[1] : '';
}

module.exports.streamHeaders = streamHeaders;
module.exports.streamQuality = streamQuality;
