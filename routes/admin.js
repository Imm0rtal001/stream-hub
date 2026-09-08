"use strict";
const express = require("express");
const config = require("../src/config");
const registry = require("../src/providerRegistry");
const status = require("../src/status");
const { aggregateStreams } = require("../src/streamAggregator");
const { requireAdminToken } = require("../src/adminAuth");

const router = express.Router();
router.use(express.json());

// Well-known TMDB ids used purely to smoke-test a provider from the Control Centre.
const SAMPLE = {
  movie: { tmdbId: 27205, mediaType: "movie", season: null, episode: null, label: "Inception (2010)" },
  tv: { tmdbId: 1396, mediaType: "tv", season: 1, episode: 1, label: "Breaking Bad S01E01" },
};

router.get("/ping", requireAdminToken, (req, res) => res.json({ ok: true }));

router.get("/providers", requireAdminToken, (req, res) => {
  const providers = registry.listProviders().map((p) => Object.assign({}, p, { status: status.get(p.id) }));
  res.json({ providers });
});

router.post("/providers/:id/toggle", requireAdminToken, (req, res) => {
  try {
    const scraper = config.setProviderEnabled(req.params.id, !!req.body.enabled);
    res.json({ ok: true, scraper });
  } catch (e) {
    const status = e.message.startsWith("Unknown provider id") ? 404 : 503;
    res.status(status).json({ error: e.message });
  }
});

router.post("/providers/:id/reload", requireAdminToken, (req, res) => {
  const manifest = config.getManifest();
  const scraper = (manifest.scrapers || []).find((s) => s.id === req.params.id);
  if (!scraper) return res.status(404).json({ error: "Unknown provider id" });
  const result = registry.reload(scraper.filename);
  res.json({ ok: result.ok, error: result.error });
});

router.post("/providers/:id/test", requireAdminToken, async (req, res) => {
  const manifest = config.getManifest();
  const scraper = (manifest.scrapers || []).find((s) => s.id === req.params.id);
  if (!scraper) return res.status(404).json({ error: "Unknown provider id" });

  const supportsMovie = !scraper.supportedTypes || scraper.supportedTypes.includes("movie");
  const sample = supportsMovie ? SAMPLE.movie : SAMPLE.tv;
  const settings = Object.assign({}, config.getSettings(), { maxPerProvider: 20, maxTotal: 20 });

  const startedAt = Date.now();
  try {
    const streams = await aggregateStreams(
      sample.mediaType,
      sample.tmdbId,
      sample.season,
      sample.episode,
      new Set([scraper.id]),
      settings
    );
    res.json({
      ok: true,
      sample: sample.label,
      ms: Date.now() - startedAt,
      streamCount: streams.length,
      sampleStreams: streams.slice(0, 5),
    });
  } catch (e) {
    res.json({ ok: false, sample: sample.label, ms: Date.now() - startedAt, error: e.message });
  }
});

router.get("/settings", requireAdminToken, (req, res) => {
  res.json({ settings: config.getSettings() });
});

router.post("/settings", requireAdminToken, (req, res) => {
  const allowed = ["timeoutMs", "minSizeGB", "maxPerProvider", "maxTotal", "sortBy", "concurrency"];
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }
  try {
    const settings = config.saveSettings(patch);
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

module.exports = router;
