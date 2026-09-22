'use strict';
const API = 'https://api.themoviedb.org/3';

async function tmdbJson(fetchFn, path, key) {
  const isV4 = key.length > 40; // v4 read-access tokens are long JWTs
  const url = `${API}${path}${isV4 ? '' : `${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`}`;
  const res = await fetchFn(url, { headers: { accept: 'application/json', ...(isV4 ? { Authorization: `Bearer ${key}` } : {}) } });
  if (res.status === 401) throw new Error('TMDB rejected the API key');
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.json();
}

/** IMDb id (tt…) -> TMDB id for the given Stremio type. */
async function imdbToTmdb(fetchFn, key, imdbId, stremioType) {
  const j = await tmdbJson(fetchFn, `/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`, key);
  const movie = (j.movie_results || [])[0];
  const tv = (j.tv_results || [])[0];
  if (stremioType === 'movie') return movie ? { id: movie.id, type: 'movie' } : tv ? { id: tv.id, type: 'tv' } : null;
  return tv ? { id: tv.id, type: 'tv' } : movie ? { id: movie.id, type: 'movie' } : null;
}

module.exports = { imdbToTmdb };
