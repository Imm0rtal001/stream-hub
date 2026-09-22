'use strict';
const fs = require('fs');
const path = require('path');
const manifest = require('../manifest.json');
const { loadProvider } = require('./sandbox');

const DIR = process.env.PROVIDERS_DIR || path.join(__dirname, '..', 'providers');
let overrideManifest = null;
const _configure = (m) => { overrideManifest = m; sourceCache.clear(); schemaCache.clear(); };

const sourceCache = new Map();
const schemaCache = new Map();

function listProviders() {
  const base = (overrideManifest || manifest).scrapers.map((s) => ({ ...s }));
  const known = new Set(base.map((s) => path.basename(s.filename)));
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')); } catch { /* none */ }
  // Any provider file dropped into /providers shows up automatically.
  for (const f of files) {
    if (known.has(f)) continue;
    const id = f.replace(/\.js$/, '');
    base.push({
      id, name: id, description: 'Auto-detected provider', version: '0.0.0', author: '',
      supportedTypes: ['movie', 'tv'], filename: `providers/${f}`, enabled: true, formats: [], logo: '', contentLanguage: [],
    });
  }
  return base;
}

const getProvider = (id) => listProviders().find((p) => p.id === id);

function readSource(entry) {
  const file = path.basename(entry.filename);
  if (!/^[\w.-]+\.js$/.test(file)) throw new Error('Bad provider filename');
  if (!sourceCache.has(file)) sourceCache.set(file, fs.readFileSync(path.join(DIR, file), 'utf8'));
  return sourceCache.get(file);
}

/** Origins the provider talks to, so the UI can offer mirror-domain fields. */
function detectDomains(src) {
  const found = new Set();
  const re = /(?:const|let|var)\s+[A-Za-z0-9_]*(?:URL|API|BASE|HOST|DOMAIN)[A-Za-z0-9_]*\s*=\s*['"`](https?:\/\/[^'"`/\s]+)/gi;
  let m;
  while ((m = re.exec(src))) {
    const host = m[1].replace(/^https?:\/\//, '');
    if (!/themoviedb\.org$/.test(host)) found.add(host);
  }
  return [...found];
}

async function settingsSchema(entry) {
  if (schemaCache.has(entry.id)) return schemaCache.get(entry.id);
  let schema = [];
  try {
    const api = loadProvider({
      key: `schema:${entry.id}`, code: readSource(entry),
      fetch: () => Promise.reject(new Error('offline')),
    });
    if (typeof api.onSettings === 'function') {
      const out = await Promise.race([api.onSettings(), new Promise((r) => setTimeout(() => r([]), 1500))]);
      if (Array.isArray(out)) schema = out;
    }
  } catch { /* provider has no usable settings */ }
  schemaCache.set(entry.id, schema);
  return schema;
}

async function describe(entry) {
  const schema = await settingsSchema(entry);
  let domains = [];
  try { domains = detectDomains(readSource(entry)); } catch { /* ignore */ }
  const { filename, ...rest } = entry;
  return { ...rest, file: path.basename(filename), settings: schema || [], domains };
}

module.exports = { listProviders, getProvider, readSource, describe, detectDomains, _configure };
