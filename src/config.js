"use strict";
/**
 * Config layer.
 *
 * Two separate files are involved on purpose:
 *
 *  - manifest.json (repo root)  -> the SAME file Nuvio/Fire TV reads remotely
 *    to know which scraper providers exist and whether each is enabled.
 *    The Control Centre's per-provider on/off switch edits THIS file, so
 *    toggling a provider off affects Nuvio and the Stremio addon's default
 *    state identically. We never change its schema — only the "enabled"
 *    (and optional "hasSettings"/description) fields already defined by it.
 *
 *  - config/settings.json (created on first write) -> Stremio-addon-only
 *    runtime tuning (timeouts, min size filter, sort order, etc). Nuvio
 *    never reads this file.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const SETTINGS_PATH = path.join(ROOT, "config", "settings.json");
const SETTINGS_DEFAULT_PATH = path.join(ROOT, "config", "settings.default.json");

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

function writeJsonAtomic(p, data) {
  try {
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, p);
  } catch (e) {
    const err = new Error(
      "Couldn't write to disk — this deployment's filesystem is likely read-only " +
        "(this is normal on Vercel serverless). Provider toggles and settings can't " +
        "persist there; use the per-install /configure link instead (it encodes your " +
        "choices in the URL, no server write needed), or deploy this addon to a host " +
        "with a persistent disk (Render, Railway, Fly.io, a VPS) if you need /admin's " +
        "live toggle to stick."
    );
    err.cause = e;
    throw err;
  }
}

/** Always re-read from disk so admin edits are picked up without a restart. */
function getManifest() {
  return readJson(MANIFEST_PATH, { name: "Knox Providers", version: "0.0.0", scrapers: [] });
}

function saveManifest(manifest) {
  writeJsonAtomic(MANIFEST_PATH, manifest);
}

function setProviderEnabled(providerId, enabled) {
  const manifest = getManifest();
  const scraper = (manifest.scrapers || []).find((s) => s.id === providerId);
  if (!scraper) throw new Error(`Unknown provider id: ${providerId}`);
  scraper.enabled = !!enabled;
  saveManifest(manifest);
  return scraper;
}

function getSettings() {
  const defaults = readJson(SETTINGS_DEFAULT_PATH, {});
  const overrides = fs.existsSync(SETTINGS_PATH) ? readJson(SETTINGS_PATH, {}) : {};
  return Object.assign({}, defaults, overrides);
}

function saveSettings(partial) {
  const current = getSettings();
  const merged = Object.assign({}, current, partial);
  if (!fs.existsSync(path.dirname(SETTINGS_PATH))) fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  writeJsonAtomic(SETTINGS_PATH, merged);
  return merged;
}

function getAdminToken() {
  return process.env.ADMIN_TOKEN || "changeme";
}

function getTmdbKey() {
  // Falls back to the key already embedded (and publicly used) in the provider
  // files themselves — this keeps things working out of the box, but a real
  // deployment should set TMDB_API_KEY.
  return process.env.TMDB_API_KEY || "307b7b8ef035c6aa336900aef4e203bd";
}

module.exports = {
  ROOT,
  MANIFEST_PATH,
  SETTINGS_PATH,
  getManifest,
  saveManifest,
  setProviderEnabled,
  getSettings,
  saveSettings,
  getAdminToken,
  getTmdbKey,
};
