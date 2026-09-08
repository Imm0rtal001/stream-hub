"use strict";
const express = require("express");
const path = require("path");
const config = require("../src/config");
const { resolveStremioRequest } = require("../src/idResolver");
const { aggregateStreams } = require("../src/streamAggregator");
const { decodeUserConfig, buildManifest, looksLikeConfig } = require("../src/manifestBuilder");

const router = express.Router();

// The Stremio protocol requires permissive CORS on every addon response.
router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  next();
});

function getUserConfig(req) {
  const seg = req.params.config;
  return looksLikeConfig(seg) ? decodeUserConfig(seg) : {};
}

function allowlistFromUserConfig(userConfig) {
  if (!userConfig || !userConfig.providers) return null; // null = "all enabled", the default
  const ids = Object.keys(userConfig.providers).filter((id) => userConfig.providers[id]);
  return new Set(ids);
}

// Public, read-only provider list for the /configure picker. Deliberately
// excludes live status/error detail (that's owner-only, see /api/admin).
router.get("/api/providers", (req, res) => {
  const manifest = config.getManifest();
  const providers = (manifest.scrapers || []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    enabled: s.enabled,
    formats: s.formats,
    supportedTypes: s.supportedTypes,
    contentLanguage: s.contentLanguage,
    logo: s.logo,
  }));
  res.json({ providers });
});

// Public diagnostic endpoint. This route intentionally works even without
// query parameters so opening /api/diagnostics never returns "Cannot GET".
// It reports addon/request/provider health without exposing API keys or full URLs.
router.get(["/api/diagnostics", "/:config/api/diagnostics"], async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const type = req.query.type === "series" ? "series" : (req.query.type === "movie" ? "movie" : null);
  const id = String(req.query.id || "").trim();
  const manifest = config.getManifest();
  const registry = require("../src/providerRegistry");

  const base = {
    ok: true,
    addon: { name: manifest.name || "Knox Streams", version: manifest.version || "unknown" },
    endpoint: "/api/diagnostics",
    request: { type, id: id || null },
    checks: {
      endpoint: { ok: true },
      manifest: { ok: true, streamResource: Array.isArray(manifest.resources) ? manifest.resources.includes("stream") : null },
      providersLoaded: { ok: true, count: 0 }
    },
    providers: [],
    summary: { elapsedMs: 0, totalRaw: 0, totalNormalized: 0, usableStreams: 0 }
  };

  const started = Date.now();

  // /api/diagnostics with no ID is a health check and must always be useful.
  if (!type || !id) {
    const all = registry.listProviders();
    base.checks.providersLoaded.count = all.filter(p => p.loaded).length;
    base.checks.providersLoaded.total = all.length;
    base.providers = all.map(p => ({
      id: p.id,
      name: p.name,
      enabled: !!p.enabled,
      loaded: !!p.loaded,
      loadError: p.loadError || null
    }));
    base.summary.elapsedMs = Date.now() - started;
    base.summary.message = "Pass ?type=movie&id=tt1234567 (or series&id=tt1234567:1:1) for a stream diagnostic.";
    return res.json(base);
  }

  try {
    const { parseStremioId } = require("../src/idResolver");
    const parsed = parseStremioId(id);
    base.checks.id = parsed
      ? { ok: true, parsed }
      : { ok: false, error: "Expected IMDb id like tt1234567 or tt1234567:1:2" };
    if (!parsed) {
      base.ok = false;
      base.summary.elapsedMs = Date.now() - started;
      return res.json(base);
    }

    const resolved = await resolveStremioRequest(type, id);
    base.checks.tmdb = resolved
      ? { ok: true, tmdbId: resolved.tmdbId, mediaType: resolved.mediaType, season: resolved.season, episode: resolved.episode }
      : { ok: false, error: "IMDb id could not be resolved by TMDB" };
    if (!resolved) {
      base.ok = false;
      base.summary.elapsedMs = Date.now() - started;
      return res.json(base);
    }

    const userConfig = getUserConfig(req);
    const settings = Object.assign({}, config.getSettings(), userConfig.settings || {});
    const allowlist = allowlistFromUserConfig(userConfig);
    const providers = registry.getRunnableProviders(resolved.mediaType, allowlist);
    base.checks.providersLoaded.count = providers.length;
    base.checks.providersLoaded.total = (manifest.scrapers || []).length;

    const { normalize } = require("../src/normalizeStream");
    for (const provider of providers) {
      const startedProvider = Date.now();
      const item = { id: provider.id, name: provider.name, loaded: true, raw: 0, normalized: 0, ok: false, elapsedMs: 0 };
      try {
        const raw = await Promise.race([
          Promise.resolve(provider.load.module.getStreams(resolved.tmdbId, resolved.mediaType, resolved.season, resolved.episode)),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${settings.timeoutMs}ms`)), settings.timeoutMs))
        ]);
        const list = Array.isArray(raw) ? raw : [];
        item.raw = list.length;
        item.normalized = list.filter(x => normalize(x, provider)).length;
        item.ok = true;
      } catch (e) {
        item.error = e && e.message ? e.message : String(e);
      }
      item.elapsedMs = Date.now() - startedProvider;
      base.providers.push(item);
      base.summary.totalRaw += item.raw;
      base.summary.totalNormalized += item.normalized;
    }

    base.summary.usableStreams = base.summary.totalNormalized;
    base.ok = base.summary.usableStreams > 0;
  } catch (e) {
    base.ok = false;
    base.checks.internal = { ok: false, error: e && e.message ? e.message : String(e) };
  }

  base.summary.elapsedMs = Date.now() - started;
  return res.json(base);
});

router.get(["/manifest.json", "/:config/manifest.json"], (req, res) => {
  const userConfig = getUserConfig(req);
  const manifest = buildManifest(userConfig);

  // Nuvio opens the URL advertised by behaviorHints.configurationURL when the
  // user selects the addon's settings. For a configured install the config
  // token itself is the stable configuration URL.
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "https";
  const host = req.get("host");
  const configSegment = looksLikeConfig(req.params.config) ? req.params.config : null;
  const configurationPath = configSegment ? `/${configSegment}` : "/configure";
  manifest.behaviorHints = Object.assign({}, manifest.behaviorHints, {
    configurable: true,
    configurationRequired: false,
    configurationURL: host ? `${proto}://${host}${configurationPath}` : configurationPath,
  });

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(manifest);
});

// Nuvio's addon settings screen may navigate directly to the configuration
// URL (the encoded config token) rather than appending /configure. The old
// build had no route for that shape, which caused: "Cannot GET /<token>".
// Only accept tokens that decode to an object, so normal routes such as
// /admin are never swallowed by this handler.
router.get(["/:config", "/:config/configure"], (req, res, next) => {
  if (!looksLikeConfig(req.params.config)) return next();
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.sendFile(path.join(__dirname, "..", "public", "configure.html"));
});

router.get(["/stream/:type/:id.json", "/:config/stream/:type/:id.json"], async (req, res) => {
  const { type, id } = req.params;
  if (type !== "movie" && type !== "series") return res.json({ streams: [] });

  try {
    const userConfig = getUserConfig(req);
    const resolved = await resolveStremioRequest(type, id);
    if (!resolved) return res.json({ streams: [] });

    const settings = Object.assign({}, config.getSettings(), userConfig.settings || {});
    const allowlist = allowlistFromUserConfig(userConfig);

    const streams = await aggregateStreams(
      resolved.mediaType,
      resolved.tmdbId,
      resolved.season,
      resolved.episode,
      allowlist,
      settings
    );
    res.json({ streams });
  } catch (e) {
    // Never surface a 500 to Stremio — an empty result is the graceful failure mode.
    // eslint-disable-next-line no-console
    console.error("[addon] stream handler error:", e);
    res.json({ streams: [] });
  }
});

module.exports = router;
