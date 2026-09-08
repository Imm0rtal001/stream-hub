"use strict";
/**
 * Provider files return loosely-shaped objects (always `.url`, usually some
 * mix of `.name`/`.title`/`.size`/`.quality`/`.language`). This turns that
 * into the object shape Stremio expects in a stream response:
 *   { name, title, url, behaviorHints }
 */

const QUALITY_RE = /\b(2160p|4k|1440p|1080p|720p|480p|360p)\b/i;
const SIZE_RE = /([\d.]+)\s*(GB|MB)\b/i;

function extractQuality(text) {
  const m = QUALITY_RE.exec(String(text || ""));
  if (!m) return null;
  return /4k/i.test(m[1]) ? "2160p" : m[1];
}

function sizeToGB(text) {
  const m = SIZE_RE.exec(String(text || ""));
  if (!m) return null;
  const value = parseFloat(m[1]);
  return /MB/i.test(m[2]) ? value / 1024 : value;
}

function safeFilename(text) {
  return String(text || "stream")
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 180);
}

/** @returns {{stream: object, sizeGB: number|null, quality: string|null}|null} */
function normalize(raw, provider) {
  if (!raw || !raw.url) return null;

  const providerLabel = provider.name || provider.id;
  const infoBlob = [raw.name, raw.title, raw.size, raw.quality, raw.language].filter(Boolean).join(" ");
  const quality = extractQuality(infoBlob) || raw.quality || null;
  const sizeGB = sizeToGB(infoBlob);

  const nameLine = `${providerLabel}${quality ? ` ${quality}` : ""}`;
  const titleLines = [raw.name || raw.title || providerLabel];
  if (raw.size && !titleLines.includes(raw.size)) titleLines.push(String(raw.size));
  if (raw.language && !infoBlob.includes(raw.language)) titleLines.push(String(raw.language));

  const behaviorHints = {
    bingeGroup: `knox-${provider.id}-${quality || "sd"}`,
    filename: safeFilename(raw.name || raw.title || providerLabel),
  };
  if (raw.headers && typeof raw.headers === "object") {
    behaviorHints.proxyHeaders = { request: raw.headers };
  }

  return {
    sizeGB,
    quality,
    stream: {
      name: nameLine,
      title: titleLines.join("\n"),
      url: raw.url,
      behaviorHints,
    },
  };
}

module.exports = { normalize, extractQuality, sizeToGB };
