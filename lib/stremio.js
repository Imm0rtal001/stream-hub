'use strict';
const pkg = require('../package.json');
const { createFetch } = require('./net');
const { imdbToTmdb } = require('./tmdb');
const { runProviders } = require('./runner');
const { listProviders } = require('./registry');
const { isEnabled } = require('./runner');

const INVISIBLE = /[\u200B-\u200D\uFEFF]/g;
const clean = (s) => String(s == null ? '' : s).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

function buildManifest(cfg) {
  const active = listProviders().filter((p) => isEnabled(p, cfg)).map((p) => clean(p.name).replace(/\.$/, ''));
  return {
    id: 'community.streamhub',
    version: pkg.version,
    name: 'StreamHub',
    description: `Stream sources from ${active.length} provider${active.length === 1 ? '' : 's'}${active.length ? `: ${active.join(', ')}` : ''}. Configure DNS, providers and quality in the control centre.`,
    logo: 'https://raw.githubusercontent.com/Stremio/stremio-brand/main/logos/stremio-logo-small.png',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}

/** "tt0944947:1:2" | "tmdb:1399:1:2" -> parsed pieces */
function parseId(type, raw) {
  const parts = decodeURIComponent(raw).split(':');
  if (parts[0] === 'tmdb') {
    return { source: 'tmdb', tmdbId: parts[1], season: parts[2] ? +parts[2] : null, episode: parts[3] ? +parts[3] : null };
  }
  return { source: 'imdb', imdbId: parts[0], season: parts[1] ? +parts[1] : null, episode: parts[2] ? +parts[2] : null };
}

function toStremioStream(s, opts = {}) {
  const p = s._provider;
  const provName = clean(p.name).replace(/\.$/, '');
  const quality = clean(s.quality);
  const title = clean(s.title) || clean(s.name);
  const extra = [];
  if (s.size) extra.push(`💾 ${clean(s.size)}`);
  const desc = [title, extra.join('  ')].filter(Boolean).join('\n');

  const hints = { notWebReady: true, bingeGroup: `streamhub-${p.id}-${quality || 'any'}` };
  const h = s.headers && typeof s.headers === 'object' ? s.headers : null;
  if (h && Object.keys(h).length) hints.proxyHeaders = { request: h };
  if (s.filename) hints.filename = clean(s.filename);

  return { name: quality ? `${provName}\n${quality}` : provName, description: desc, url: s.url, behaviorHints: hints };
}

/** Work out which TMDB title a Stremio id refers to. Throws Error with a readable message. */
async function resolveTarget(cfg, type, rawId) {
  const t = type === 'series' ? 'series' : 'movie';
  const id = parseId(t, rawId);
  let mediaType = t === 'series' ? 'tv' : 'movie';
  if (mediaType === 'tv' && (id.season == null || id.episode == null)) throw new Error('Series ids need season and episode (tt123:1:2)');

  let tmdbId = id.tmdbId;
  if (id.source === 'imdb') {
    if (!/^tt\d+$/.test(id.imdbId || '')) throw new Error('Invalid IMDb id');
    const r = await imdbToTmdb(createFetch(cfg), cfg.tmdbKey, id.imdbId, t);
    if (!r) throw new Error('Title not found on TMDB');
    tmdbId = r.id;
    mediaType = r.type;
  }
  if (!/^\d+$/.test(String(tmdbId || ''))) throw new Error('Invalid TMDB id');
  return {
    mediaType, tmdbId: String(tmdbId),
    season: mediaType === 'tv' ? id.season : null,
    episode: mediaType === 'tv' ? id.episode : null,
  };
}

async function handleStream(cfg, type, rawId, baseUrl) {
  if (!cfg.tmdbKey) {
    return { streams: [{
      name: 'StreamHub', description: 'TMDB API key missing.\nOpen Configure to add one.',
      externalUrl: `${baseUrl}/configure`,
    }] };
  }
  let target;
  try { target = await resolveTarget(cfg, type, rawId); } catch { return { streams: [] }; }
  const { streams } = await runProviders({ cfg, ...target });
  return { streams: streams.map(toStremioStream) };
}

module.exports = { buildManifest, handleStream, resolveTarget, parseId, toStremioStream, clean };
