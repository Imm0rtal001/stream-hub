'use strict';
// Providers describe a stream very differently — some put everything in a
// clean `quality` field, others bury language/audio/codec/server info
// inside `title`/`name`/`size` text (Rogmovies and VegaMovies even pack
// language + size + source + audio + codec into `size` as two lines). This
// pulls a consistent, best-effort set of badges/labels out of whatever a
// provider actually gave us, so the display is clean either way.
const { streamQuality, streamHeaders } = require('./util');

const LANGUAGES = [
  'Dual Audio', 'Multi Audio', 'Dual', 'Multi',
  'English', 'Hindi', 'Tamil', 'Telugu', 'Bengali', 'Punjabi', 'Urdu',
  'Malayalam', 'Kannada', 'Marathi', 'Gujarati', 'Japanese', 'Korean',
  'Chinese', 'Spanish', 'French', 'German', 'Russian', 'Arabic',
];
const AUDIO_CODECS = [
  'TrueHD 7.1', 'TrueHD', 'DDP7.1', 'DDP5.1', 'DD+ 5.1', 'DD5.1', 'DD2.0',
  'EAC3', 'AC3', 'DTS-HD', 'DTS', 'AAC', 'FLAC', 'Opus', 'Atmos',
];
const VIDEO_CODECS = [
  ['HEVC|x265|H\\.?265', 'H.265'],
  ['AVC|x264|H\\.?264', 'H.264'],
  ['AV1', 'AV1'],
  ['VP9', 'VP9'],
];
const HDR_TAGS = [['HDR10\\+', 'HDR10+'], ['HDR10', 'HDR10'], ['Dolby ?Vision|DoVi|\\bDV\\b', 'Dolby Vision'], ['\\bHDR\\b', 'HDR']];
const SERVERS = [
  ['hubcloud', 'HubCloud'], ['vcloud', 'vCloud'], ['pixeldrain', 'Pixeldrain'],
  ['gdflix', 'GDFlix'], ['gdtot', 'GDToT'], ['dropgalaxy', 'DropGalaxy'],
  ['filepress', 'FilePress'], ['streamtape', 'StreamTape'], ['doodstream', 'DoodStream'],
  ['flixcloud', 'FlixCloud'], ['abhilinks', 'AbhiLinks'], ['\\.r2\\.dev', 'Cloudflare R2'],
];
const SIZE_RE = /\b(\d+(?:\.\d+)?\s?(?:GB|MB|TB))\b/i;

const matchAll = (list, text) => {
  const found = [];
  for (const name of list) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const m = re.exec(text);
    if (m) found.push({ name, at: m.index, end: m.index + m[0].length });
  }
  const kept = found.filter((f) => !found.some((o) => o !== f && o.at <= f.at && o.end >= f.end && o.end - o.at > f.end - f.at));
  const seen = new Set();
  return kept.sort((a, b) => a.at - b.at).filter((f) => !seen.has(f.name) && seen.add(f.name)).map((f) => f.name);
};
const matchOne = (pairs, text) => {
  for (const [re, label] of pairs) if (new RegExp(re, 'i').test(text)) return label;
  return '';
};

/**
 * Best-effort metadata for one stream, combining its own field(s) with
 * whatever can be parsed out of its text. Every field is a string, empty
 * when nothing could be determined — callers omit the corresponding
 * line/badge rather than showing a placeholder.
 */
function parseStreamMeta(s) {
  const haystack = [s.title, s.name, s.size].filter(Boolean).join('  ');
  const quality = streamQuality(s);
  const sizeMatch = SIZE_RE.exec(haystack);
  const size = sizeMatch ? sizeMatch[1].replace(/\s+/, ' ').toUpperCase().replace(/^(\d+(?:\.\d+)?)([A-Z]+)$/, '$1 $2') : '';
  const language = matchAll(LANGUAGES, haystack).join(' • ');
  const audioCodec = matchAll(AUDIO_CODECS, haystack).join(' • ');
  const videoCodec = matchOne(VIDEO_CODECS, haystack);
  const hdr = matchOne(HDR_TAGS, haystack);
  const server = matchOne(SERVERS, `${haystack}  ${s.url || ''}`);

  const qualityBadge = /2160p|4k/i.test(quality) ? '4K' : /1440p/i.test(quality) ? '2K' : quality;
  const badges = [qualityBadge, hdr, videoCodec].filter(Boolean);

  return { quality, size, language, audioCodec, videoCodec, hdr, server, badges };
}

module.exports = { parseStreamMeta };
