# StreamHub

A self-hosted **Stremio addon** and **Nuvio scraper repository**, built from
your 14 providers (4KHdHub, CineFreak, DahmerMovies, MoviesHunt, MoviesDrive,
AnimeSalt, AnimeWorld, HDHub4u, HiAnime, MovieBox, Re:ANIME, Rogmovies,
UHDMovies, VegaMovies), with a web **control centre** to turn sources
on/off, tune per-provider settings, override DNS or mirror a domain that
moved, run a live test, and get one-click install links — all deployable to
Vercel for free.

```
Providers (yours) → DNS resolver (system or DoH, your choice) → StreamHub → Stremio / Nuvio
```

## Deploy in one click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYOUR_USERNAME%2Fstreamhub&env=TMDB_API_KEY&envDescription=TMDB%20v3%20API%20key%20from%20themoviedb.org%2Fsettings%2Fapi&project-name=streamhub&repository-name=streamhub)

1. Push this folder to a GitHub repo (or fork it), then click the button
   above (swap in your repo URL if you forked).
2. When prompted, paste a **TMDB v3 API key** — get one free at
   <https://www.themoviedb.org/settings/api>. This keeps the key on the
   server instead of inside install links.
3. Deploy. Vercel gives you a URL like `https://streamhub-xyz.vercel.app`.
4. Open that URL — this is the control centre. Go to **Install** and copy
   the Stremio and/or Nuvio links.

No CLI required, but if you prefer it:

```bash
npm i -g vercel
vercel          # first deploy
vercel --prod   # subsequent deploys
vercel env add TMDB_API_KEY
```

## Run it locally

```bash
npm install
cp .env.example .env   # fill in TMDB_API_KEY at least
npm run dev             # http://localhost:3000
```

`api/index.js` is the single Vercel Function every request is rewritten to
(`vercel.json`); `lib/router.js` does the actual path routing from there.
`dev-server.js` runs the exact same router locally. `vercel.json` sets
`"framework": null` on purpose — Vercel's zero-config detection tries a
cascade of backend-framework builders (Express, Hono, NestJS, plain Node)
before it looks at your own routing, and it's triggered by filenames alone
(`app.js`/`index.js`/`server.js` at the project root or in `src/`), not by
what's actually in the file. Pinning `framework: null` opts out of that
cascade entirely so the `functions` + `rewrites` config below is what
actually runs. If a deploy ever again fails with "No entrypoint found"
(with or without "which imports ..."), check two things: that `vercel.json`
still has `"framework": null`, and that the Vercel dashboard's own Project
Settings → Framework Preset is set to **Other** — a manually-set dashboard
preset can override `vercel.json` for that project.

## How settings travel

There's no database by default — settings live **inside the install URL**
(`/c/<encoded-config>/manifest.json`), so nothing to host or migrate.
Two upgrades, both optional:

- **Set `TMDB_API_KEY` in Vercel** (Settings → Environment Variables) so it
  never has to sit inside a link you share.
- **Add a free [Upstash Redis](https://vercel.com/marketplace/upstash)
  integration** from the Vercel Marketplace. StreamHub detects
  `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` automatically and
  switches Install to "saved profiles": a short `/u/<id>` link that updates
  live when you change settings, protected by an edit key.

## Control centre

- **Install** — Stremio and Nuvio links for your current settings, plus an
  `stremio://` one-tap install button.
- **Providers** — enable/disable each source, edit its own settings (the
  ones each provider already exposes, e.g. 4KHdHub's resolution/size
  limits), and set a mirror domain if a site moves.
- **DNS** — system DNS vs DNS-over-HTTPS (Cloudflare/Google/Quad9/custom),
  IPv4-only toggle, hostname→IP overrides, domain mirroring, and a live
  resolver test.
- **Test** — run a real lookup (IMDb id, `id:season:episode`, or `tmdb:id`)
  against your enabled providers and see per-provider timing, errors, badges
  (quality/HDR/codec) with server/size/language/audio for each stream, the
  raw network trace (DNS source + IP per request), and provider console
  logs.
- **Settings** — TMDB key, per-provider timeout, sort order, streams-per-
  provider cap, export/import/reset.

## Stream formatting

The addon ships its own icon (an embedded SVG, no external image host to
depend on) instead of a generic placeholder. Each stream Stremio shows is
formatted consistently regardless of what a provider actually returned:

- A short **badge line** — resolution (2160p shows as `4K`, 1440p as `2K`),
  HDR/Dolby Vision, and video codec (H.264/H.265/AV1/VP9) — appended under
  the provider's name.
- A clean **description** with one icon-prefixed line per field that could
  actually be determined: 🖥 Server, 💾 Size, 🌐 Language, 🔊 Audio codec.
  A field that can't be found (most providers don't expose all of these)
  is left out rather than shown as empty.

This works even for providers that don't have separate quality/language/
audio fields at all — `lib/streamMeta.js` also parses these out of
whatever text a provider *did* return (title, name, or a size string that
turns out to hold more than just the size, as Rogmovies and VegaMovies do)
using known tokens (language names, `DDP5.1`/`Atmos`/`AAC`/etc., `x265`/
`HEVC`/etc.), so results stay readable even from a provider that only
gives you a release filename.

## Adding a provider

Drop a new Nuvio-style file into `providers/`:

```js
// providers/example.js
async function getStreams(tmdbId, mediaType, season, episode) {
  // fetch/cheerio are provided by the sandbox — don't `require` fetch.
  return [{ name: "Example 1080p", title: "Example", url: "https://.../file.mkv", quality: "1080p" }];
}
module.exports = { getStreams };
// optional: module.exports.onSettings = async () => [{ type: "toggle", key: "x", label: "X", defaultValue: true }];
```

It's picked up automatically (also add a manifest.json entry for a nicer
name/logo/description). Providers run in an isolated `vm` context per
request — they get `fetch`, `cheerio`, `crypto-js`, `TMDB_API_KEY`,
`SCRAPER_SETTINGS`, and standard globals, nothing else.

Two stream-object shapes are both accepted from `getStreams()`, freely
mixed across providers:

- **Simple**: `{ url, quality, title/name, size, headers, filename }` —
  StreamHub builds the final Stremio `behaviorHints` (including
  `proxyHeaders`) for you. Most providers, including all five original
  ones, use this.
- **Native**: a stream that already sets its own
  `behaviorHints.proxyHeaders.request` and bakes quality into the
  name/title text instead of a separate `quality` field (Rogmovies and
  VegaMovies do this). StreamHub detects and preserves this automatically —
  `lib/util.js`'s `streamHeaders()`/`streamQuality()` fall back to reading
  `behaviorHints` and parsing a resolution token (`1080p`, `2160p`, …) out
  of the title when a plain `quality`/`headers` field isn't there, so
  sorting-by-quality and header-forwarding both still work.

If a provider needs `crypto-js` (MovieBox does, for its API request
signing) it's listed in `package.json` and used if `npm install` succeeded;
if it didn't, `lib/cryptojs-lite.js` — a small dependency-free stand-in
covering MD5/HmacMD5/Base64/Utf8/Hex — is used instead, verified against
the standard MD5 and HMAC-MD5 test vectors in `test/run.js`.

## DNS &amp; mirror domains, in plain terms

- **System DNS** — whatever Vercel's region resolves. Fine most of the time.
- **DNS over HTTPS** — StreamHub queries Cloudflare/Google/Quad9 (or your
  own DoH JSON endpoint) instead, useful if a resolver blocks or hijacks a
  source's domain. Falls back to system DNS if the DoH query fails.
- **Host overrides** — pin `some.host` (or `*.host`) to a literal IP.
- **Mirror domains** — a source's domain changed (e.g. moviesdrive.rest →
  moviesdrive.christmas)? Set it once on the DNS tab or right under that
  provider's card; every request (and, for Nuvio, the served provider file
  itself) is rewritten automatically.
- Private/reserved IPs (127.0.0.1, 10.x, 192.168.x, link-local, etc.) are
  always refused, whichever resolver produced them — this keeps the
  function from being used to probe your own network or Vercel's.
- **Nuvio** runs the scraper files on your own device, so DNS tricks here
  only affect what StreamHub serves (mirrors); for the device itself, set
  Android's Private DNS to a DoH hostname if you need one.

## Notes

- Providers scrape third-party sites; you are responsible for complying
  with your local laws and each site's terms. No content is hosted by this
  project.
- **MovieBox** needs `crypto-js` at the moment its file loads (not lazily),
  which crashed the provider before `lib/cryptojs-lite.js` was added as a
  fallback — this is fixed, and covered by
  `test/run.js`'s crypto-js tests.
- **DahmerMovies** guesses its source site's folder name from the TMDB
  title (e.g. `Movie Title (2024)`); it now tries a few punctuation
  variants in turn instead of just one, which recovers titles with
  apostrophes/ampersands/dashes that don't match the folder name exactly.
  Separately, some files on that site currently redirect through what
  looks like a locked-download gate (a Cloudflare Worker page titled
  "Download Locked") rather than serving the video directly — if that's
  what you're hitting, it's a change on the source site's end, and
  working around an access gate like that isn't something this project
  will do. Disable the provider in the control centre if it's consistently
  giving you unplayable links.
- The included `test/run.js` exercises config sanitizing, the DNS/mirror
  layer, the provider sandbox against your real provider files, and the
  full Stremio/Nuvio/API routes against a mocked network — run `npm test`.
