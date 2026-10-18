'use strict';
const pkg = require('../package.json');
const { listProviders, getProvider, readSource } = require('./registry');
const { isEnabled } = require('./runner');

function buildManifest(cfg) {
  return {
    name: 'StreamHub Providers',
    version: pkg.version,
    description: 'Nuvio local scrapers served by StreamHub',
    scrapers: listProviders().map((p) => ({ ...p, enabled: isEnabled(p, cfg) })),
  };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace whole hostnames only: rewriting "x.com" must not touch "mx.com",
 * "x.community" or "x.com.evil.net".
 */
function rewriteHosts(code, rewrites) {
  for (const [from, to] of Object.entries(rewrites || {})) {
    if (from.startsWith('*.')) continue;
    const re = new RegExp(`(?<![\\w.-])${escapeRe(from)}(?![\\w-]|\\.[\\w-])`, 'g');
    code = code.replace(re, () => to);
  }
  return code;
}

/** Serve a provider file with the user's mirror-domain rewrites applied to its source. */
function providerSource(cfg, file) {
  const entry = listProviders().find((p) => p.filename.endsWith(`/${file}`) || p.filename === file);
  if (!entry) return null;
  return rewriteHosts(readSource(entry), cfg.dns.rewrites);
}

module.exports = { buildManifest, providerSource, rewriteHosts, getProvider };
