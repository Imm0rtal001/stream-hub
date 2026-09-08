"use strict";
/**
 * Loads the scraper modules listed in manifest.json.
 *
 * Every provider file already exports a uniform `getStreams(tmdbId, mediaType,
 * season, episode)` (this repo's Nuvio contract — see providers/*.js). We
 * reuse that exact contract for the Stremio addon instead of inventing a new
 * one, so a single set of provider files serves both platforms unmodified.
 *
 * Loading is lazy + isolated: a provider whose `require()` throws (e.g. a
 * missing optional dependency) is marked "broken" and simply excluded from
 * aggregation — it never takes the rest of the addon down with it.
 */
const path = require("path");
const config = require("./config");

const moduleCache = new Map(); // filename -> { ok, module, error }

// IMPORTANT for Vercel/serverless bundlers:
// Do not use a fully dynamic require(absPath). Serverless file tracing can omit
// those provider modules from the deployed function, which makes every provider
// appear as "not loaded" even though the files exist in the repository.
// Keep the require targets statically visible while still isolating failures.
const PROVIDER_LOADERS = {
  "providers/4khdhub.js": () => require("../providers/4khdhub.js"),
  "providers/MovieBlast.js": () => require("../providers/MovieBlast.js"),
  "providers/CineFreak.js": () => require("../providers/CineFreak.js"),
  "providers/MoviesHunt.js": () => require("../providers/MoviesHunt.js"),
  "providers/animesalt.js": () => require("../providers/animesalt.js"),
  "providers/animeworld.js": () => require("../providers/animeworld.js"),
  "providers/dahmermovies.js": () => require("../providers/dahmermovies.js"),
  "providers/hdhub4u.js": () => require("../providers/hdhub4u.js"),
  "providers/HdGharTV.js": () => require("../providers/HdGharTV.js"),
  "providers/moviesdrive.js": () => require("../providers/moviesdrive.js"),
  "providers/uhdmovies.js": () => require("../providers/uhdmovies.js"),
  "providers/vegamovies.js": () => require("../providers/vegamovies.js"),
  "providers/rogmovies.js": () => require("../providers/rogmovies.js"),
  "providers/zinkmovies.js": () => require("../providers/zinkmovies.js"),
};

function loadModule(filename) {
  if (moduleCache.has(filename)) return moduleCache.get(filename);
  let entry;
  try {
    const loader = PROVIDER_LOADERS[filename];
    if (!loader) {
      entry = { ok: false, module: null, error: `Unknown provider file: ${filename}` };
    } else {
      const mod = loader();
      if (typeof mod.getStreams !== "function") {
        entry = { ok: false, module: null, error: `${filename} does not export getStreams()` };
      } else {
        entry = { ok: true, module: mod, error: null };
      }
    }
  } catch (e) {
    entry = { ok: false, module: null, error: e && e.stack ? e.stack : String(e) };
  }
  moduleCache.set(filename, entry);
  return entry;
}

function reload(filename) {
  const abs = path.join(config.ROOT, filename);
  try {
    delete require.cache[require.resolve(abs)];
  } catch (_e) {
    /* not yet loaded, fine */
  }
  moduleCache.delete(filename);
  return loadModule(filename);
}

/** Returns the full provider list from manifest.json, annotated with live
 * load status (ok/broken) — used by both the aggregator and the admin API. */
function listProviders() {
  const manifest = config.getManifest();
  return (manifest.scrapers || []).map((scraper) => {
    const load = scraper.filename ? loadModule(scraper.filename) : { ok: false, error: "no filename" };
    return Object.assign({}, scraper, {
      loaded: load.ok,
      loadError: load.error,
    });
  });
}

/** Providers that are enabled, support the requested media type, and loaded
 * successfully. `allowlist`, when given, further restricts by provider id
 * (used for per-install /configure selections). */
function getRunnableProviders(mediaType, allowlist) {
  const manifest = config.getManifest();
  const scrapers = manifest.scrapers || [];
  return scrapers
    .filter((s) => s.enabled)
    .filter((s) => !allowlist || allowlist.has(s.id))
    .filter((s) => !Array.isArray(s.supportedTypes) || s.supportedTypes.includes(mediaType))
    .map((s) => Object.assign({ load: loadModule(s.filename) }, s))
    .filter((s) => s.load.ok);
}

module.exports = { listProviders, getRunnableProviders, reload, loadModule };
