"use strict";
/**
 * Stremio requests streams by IMDb id ("tt1375666" for a movie, or
 * "tt0903747:1:1" for series season/episode). Every provider in this repo
 * expects a TMDB id instead, so we resolve tt-id -> tmdb-id once via TMDB's
 * /find endpoint and cache the result (IMDb ids never change what they map
 * to, so a long TTL is safe).
 */
const config = require("./config");

const TMDB_ENDPOINT = "https://api.themoviedb.org/3";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const cache = new Map(); // imdbId -> { value, expiresAt }

function parseStremioId(id) {
  // "tt1234567" -> movie | "tt1234567:1:2" -> series season 1 episode 2
  const [imdbId, season, episode] = String(id || "").split(":");
  if (!/^tt\d+$/.test(imdbId || "")) return null;
  return {
    imdbId,
    season: season != null ? Number(season) : null,
    episode: episode != null ? Number(episode) : null,
  };
}

async function resolveImdbToTmdb(imdbId) {
  const cached = cache.get(imdbId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = `${TMDB_ENDPOINT}/find/${encodeURIComponent(imdbId)}?api_key=${config.getTmdbKey()}&external_source=imdb_id`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`TMDB find HTTP ${res.status}`);
  const data = await res.json();

  let value = null;
  if (Array.isArray(data.movie_results) && data.movie_results.length) {
    value = { tmdbId: data.movie_results[0].id, mediaType: "movie", title: data.movie_results[0].title };
  } else if (Array.isArray(data.tv_results) && data.tv_results.length) {
    value = { tmdbId: data.tv_results[0].id, mediaType: "tv", title: data.tv_results[0].name };
  }

  cache.set(imdbId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Given a Stremio `type` ("movie"/"series") and `id`, returns
 * { tmdbId, mediaType, season, episode } or null if it can't be resolved. */
async function resolveStremioRequest(type, id) {
  const parsed = parseStremioId(id);
  if (!parsed) return null;
  const found = await resolveImdbToTmdb(parsed.imdbId);
  if (!found) return null;
  // Trust the request `type` over TMDB's guess when they disagree, since
  // that's what the provider files switch on.
  const mediaType = type === "series" ? "tv" : "movie";
  return {
    tmdbId: found.tmdbId,
    mediaType,
    season: parsed.season,
    episode: parsed.episode,
  };
}

module.exports = { parseStremioId, resolveImdbToTmdb, resolveStremioRequest };
