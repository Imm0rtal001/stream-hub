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

/** Serve a provider file with the user's mirror-domain rewrites applied to its source. */
function providerSource(cfg, file) {
  const entry = listProviders().find((p) => p.filename.endsWith(`/${file}`) || p.filename === file);
  if (!entry) return null;
  let code = readSource(entry);
  for (const [from, to] of Object.entries(cfg.dns.rewrites || {})) {
    if (from.startsWith('*.')) continue;
    code = code.split(from).join(to);
  }
  return code;
}

module.exports = { buildManifest, providerSource, getProvider };
