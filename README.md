# StreamHub

A self-hosted **Stremio addon** and **Nuvio scraper repository**, built from
your five providers (4KHdHub, CineFreak, DahmerMovies, MoviesHunt,
MoviesDrive), with a web **control centre** to turn sources on/off, tune
per-provider settings, override DNS or mirror a domain that moved, run a live
test, and get one-click install links — all deployable to Vercel for free.

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
  against your enabled providers and see per-provider timing, errors, the
  raw network trace (DNS source + IP per request), and provider console
  logs.
- **Settings** — TMDB key, per-provider timeout, sort order, streams-per-
  provider cap, export/import/reset.

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
request — they get `fetch`, `cheerio`, `TMDB_API_KEY`, `SCRAPER_SETTINGS`,
and standard globals, nothing else.

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
- The included `test/run.js` exercises config sanitizing, the DNS/mirror
  layer, the provider sandbox against your real provider files, and the
  full Stremio/Nuvio/API routes against a mocked network — run `npm test`.
