"use strict";
const registry = require("./providerRegistry");
const status = require("./status");
const { normalize } = require("./normalizeStream");

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const QUALITY_ORDER = ["2160p", "1440p", "1080p", "720p", "480p", "360p"];
function qualityRank(q) {
  const i = QUALITY_ORDER.indexOf(q);
  return i === -1 ? QUALITY_ORDER.length : i;
}

/**
 * @param {"movie"|"tv"} mediaType
 * @param {number|string} tmdbId
 * @param {number|null} season
 * @param {number|null} episode
 * @param {Set<string>|null} allowlist  provider ids to run; null = all enabled
 * @param {object} settings            see config/settings.default.json
 */
async function aggregateStreams(mediaType, tmdbId, season, episode, allowlist, settings) {
  const providers = registry.getRunnableProviders(mediaType, allowlist);

  const runs = await Promise.allSettled(
    providers.map(async (provider) => {
      const startedAt = Date.now();
      try {
        const raw = await withTimeout(
          Promise.resolve(provider.load.module.getStreams(tmdbId, mediaType, season, episode)),
          settings.timeoutMs,
          provider.id
        );
        const list = Array.isArray(raw) ? raw : [];
        status.record(provider.id, { ok: true, ms: Date.now() - startedAt, streamCount: list.length, error: null });
        return { provider, list };
      } catch (e) {
        status.record(provider.id, {
          ok: false,
          ms: Date.now() - startedAt,
          streamCount: 0,
          error: e && e.message ? e.message : String(e),
        });
        return { provider, list: [] };
      }
    })
  );

  let normalized = [];
  for (const result of runs) {
    if (result.status !== "fulfilled") continue;
    const { provider, list } = result.value;
    const capped = list.slice(0, settings.maxPerProvider);
    for (const raw of capped) {
      const n = normalize(raw, provider);
      if (n) normalized.push(n);
    }
  }

  if (settings.minSizeGB > 0) {
    normalized = normalized.filter((n) => n.sizeGB == null || n.sizeGB >= settings.minSizeGB);
  }

  // De-dupe by final URL across providers.
  const seen = new Set();
  normalized = normalized.filter((n) => {
    if (seen.has(n.stream.url)) return false;
    seen.add(n.stream.url);
    return true;
  });

  normalized.sort((a, b) => {
    if (settings.sortBy === "size") return (b.sizeGB || 0) - (a.sizeGB || 0);
    return qualityRank(a.quality) - qualityRank(b.quality);
  });

  return normalized.slice(0, settings.maxTotal).map((n) => n.stream);
}

module.exports = { aggregateStreams };
