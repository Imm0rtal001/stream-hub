"use strict";
/**
 * Stremio's convention (used by most community addons — Torrentio etc.) for
 * a "configurable" addon is to base64-encode a small JSON blob and prepend
 * it as the first path segment: /<b64config>/manifest.json,
 * /<b64config>/stream/movie/tt123.json. There's no server-side per-user
 * state — the URL itself IS the config, which is exactly what the
 * /configure page (public/configure.html) generates for the user to install.
 */
const config = require("./config");

function encodeUserConfig(obj) {
  return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64url");
}

function decodeUserConfig(str) {
  if (!str) return {};
  try {
    return JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
  } catch (_e) {
    return {};
  }
}

/** A path segment is treated as an encoded config only if it decodes to an
 * object — this lets /manifest.json (no config segment) keep working. */
function looksLikeConfig(segment) {
  if (!segment || segment === "manifest.json") return false;
  const decoded = decodeUserConfig(segment);
  return decoded && typeof decoded === "object";
}

function buildManifest(userConfig) {
  const manifest = config.getManifest();
  const scrapers = manifest.scrapers || [];
  const enabledIds = new Set(
    userConfig && userConfig.providers
      ? Object.keys(userConfig.providers).filter((id) => userConfig.providers[id])
      : scrapers.filter((s) => s.enabled).map((s) => s.id)
  );
  const activeNames = scrapers.filter((s) => enabledIds.has(s.id) && s.enabled).map((s) => s.name);

  return {
    id: "org.knox.multiscraper",
    version: manifest.version || "1.0.0",
    name: "Knox Streams",
    description:
      activeNames.length > 0
        ? `Aggregated streaming links from ${activeNames.length} provider${activeNames.length === 1 ? "" : "s"}: ${activeNames.join(", ")}. Reconfigure at /configure.`
        : "Aggregated streaming links from multiple providers. Configure at /configure.",
    logo: "https://i.postimg.cc/mryRTf0R/hdhub4u.png",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
  };
}

module.exports = { encodeUserConfig, decodeUserConfig, looksLikeConfig, buildManifest };
