# Knox Streams — 3.7.1

One codebase, two front doors:

- **Nuvio / Fire TV** — drop this repo in as before. `providers/*.js` still each
  export a plain `getStreams(tmdbId, mediaType, season, episode)`, and
  `manifest.json` is still the registry Nuvio reads to know what exists and
  what's enabled. Nothing about that contract changed.
- **Stremio** — a small Express app (`app.js`) wraps the same provider files
  behind the [Stremio addon protocol](https://www.stremio.com/addon-sdk), so
  you can install this as a normal Stremio addon and it aggregates every
  enabled scraper into one stream list per title.

Both front doors share one **web-based control centre** for turning
providers on/off, tuning timeouts/filters, and testing a provider live.

## Fixed in 3.7.1 — Nuvio was broken

3.7.0 replaced `crypto-js` in `MovieBlast.js` with a shim backed by **Node's
built-in `crypto` module**. That was a mistake: Nuvio's provider sandbox is a
browser-like JS runtime (it already relies on `fetch`/`atob`/`btoa` elsewhere
in this repo) — it is **not** Node.js, so `require("crypto")` doesn't exist
there. That broke `MovieBlast.js` in Nuvio (and, depending on how Nuvio's
loader handles a single provider's load failure, may have looked like "the
whole addon isn't working").

Fixed by replacing it with a **pure-JS HMAC-SHA256** (a small hand-rolled
SHA-256 + HMAC, no platform module of any kind) — verified byte-for-byte
against Node's own `crypto.createHmac` across ASCII, empty-string, unicode,
and >64-byte-key inputs. See `lib/micro-crypto.js`.

While fixing this I also hardened `lib/micro-cheerio.js` (the dependency-free
HTML engine from 3.7.0) to avoid ES6 `class` syntax and generator functions
(`function*`/`yield`), using plain constructor functions + prototypes and
array-based traversal instead. Classes and generators are supported by every
modern engine, but "modern" is exactly the assumption that caused the crypto
bug above — Nuvio's actual sandbox capabilities aren't publicly documented,
so the safer bar is the smallest common denominator of JS engines, not "what
Node supports."

**If you're still seeing a provider fail only in Nuvio (not in the Stremio
addon), that's the most likely category of bug** — something assuming a
Node/browser global that Nuvio's sandbox doesn't provide. Check the Control
Centre's per-provider "Test" button first (it exercises the exact same
`getStreams()` call Nuvio makes) — if it passes there but fails in Nuvio,
the difference is almost certainly a sandbox capability gap like this one.

## What's new since 3.6.x

- **Zero scraping dependencies.** No provider needs `npm install` for
  anything — HTML parsing and HMAC signing are hand-rolled (see `lib/`)
  instead of pulling in `cheerio`, `cheerio-without-node-native`, or
  `crypto-js`. `npm install` is only needed for the Stremio server itself
  (`express` + `cors`).
- **Stremio addon.** `/manifest.json` and `/stream/:type/:id.json`, plus a
  configurable-addon flow: `/configure` lets you pick providers and generates
  a per-install manifest URL (`/<config>/manifest.json`) to install in
  Stremio — no account or server-side state involved, the URL *is* the config.
- **Control centre** at `/admin` (token-protected): toggle any provider on/off
  (this edits `manifest.json` directly, so it changes the default for Nuvio
  *and* Stremio installs at once), test a provider against a sample title, see
  load/last-run status, and tune global settings (timeout, min size filter,
  sort order, per-provider/result caps).

## Repo layout

```
providers/*.js         Scraper modules — Nuvio's contract, unchanged.
manifest.json          Registry Nuvio reads remotely; also the single
                        source of truth for which providers are enabled
                        (the control centre writes here too).
lib/micro-cheerio.js    Canonical, unit-tested copies of the dependency-free
lib/micro-crypto.js     HTML engine and HMAC shim. Each provider that needs
                        one carries its own inlined copy (see "Why inlined?"
                        below) — edit here, then re-inline if you change them.
src/                    Addon logic: id resolution, aggregation, normalization,
                        provider registry, settings.
routes/                 Express routers: the Stremio addon protocol, and the
                        admin API.
public/                 /configure and /admin front-ends (plain HTML/CSS/JS,
                        no build step).
app.js                  The Express app itself (routes + static files),
                        shared by every deployment target below.
server.js               Entry point for a persistent Node host (Render,
                        Railway, Fly.io, a VPS, `npm start` locally).
api/index.js            Entry point for Vercel (serverless).
vercel.json             Vercel routing config (see Deploying, below).
```

## Deploying to Vercel

```bash
npm install -g vercel   # if you don't already have the CLI
cd knox-main
vercel login            # opens a browser to authenticate — this repo can't do this step for you
vercel                  # deploys a preview; follow the prompts (link/create a project)
vercel --prod           # promote to your production URL once you're happy with it
```

Or without the CLI: push this repo to GitHub and import it on
[vercel.com/new](https://vercel.com/new) — Vercel auto-detects the Node
project, and `vercel.json`'s rewrite rule sends every request to
`api/index.js`, which serves the whole Express app (`/manifest.json`,
`/stream/...`, `/configure`, `/admin`) from that one serverless function.

Either way, **set the `ADMIN_TOKEN` environment variable** in the Vercel
project settings (Settings → Environment Variables) before using `/admin` —
it defaults to `changeme` otherwise.

### The one real tradeoff: Vercel's filesystem is read-only

Vercel serverless functions run on an ephemeral, read-only filesystem (except
`/tmp`, which doesn't persist between invocations). That's fine for
everything that only *reads* files — which is most of this addon — but it
means two Control Centre features can't persist their writes there:

- **Toggling a provider on/off from `/admin`** (writes `manifest.json`)
- **Saving global settings from `/admin`** (writes `config/settings.json`)

Both now fail with a clear error message instead of crashing, explaining the
same thing this section does. Two ways to work around it:

1. **Use `/configure` instead of `/admin`'s toggle for per-install provider
   choices.** It encodes your provider selection and settings directly in
   the install URL (`/<config>/manifest.json`) — no server write involved,
   so it works identically on Vercel or anywhere else.
2. **Set your defaults in `manifest.json` before deploying** (which
   providers are `enabled: true`) and in `config/settings.default.json`, if
   you want the *default*, un-configured install to reflect specific choices.
3. If you specifically need `/admin`'s live global toggle to persist across
   requests, deploy to a host with a real persistent disk instead — Render,
   Railway, Fly.io, or a plain VPS all work with the exact same code via
   `server.js` (`npm start`).

The Control Centre's provider **Test** button and status view work fine on
Vercel either way — those don't need to persist anything.

## Running locally / on a persistent host

```bash
npm install        # only express + cors
cp .env.example .env
# edit .env: set ADMIN_TOKEN before deploying anywhere public
npm start
```

- Configure page: `http://localhost:7000/configure`
- Control centre: `http://localhost:7000/admin`

## Using with Nuvio / Fire TV

Nothing changes here — point Nuvio at this repo the same way you already do.
`manifest.json` and every file under `providers/` still work exactly as a
standalone Nuvio provider pack, independent of the Stremio server. Toggling a
provider from `/admin` edits the same `manifest.json` (when running
somewhere with a writable filesystem — see the Vercel caveat above), so it
affects Nuvio too.

## Why no cheerio, and why inlined?

Two reasons this was worth doing rather than just `npm install`-ing it:

1. **Nuvio's sandbox.** Nuvio dynamically loads these files in a constrained
   JS runtime that isn't guaranteed to resolve npm packages the way Node
   does, or to support every modern JS feature (see the 3.7.1 fix above for
   a concrete example of this assumption breaking). A dependency-free,
   maximally-plain-JS provider is portable by construction.
2. **The addon shouldn't need `npm install cheerio` just to boot.** cheerio
   pulls in a real HTML parser (parse5) and a CSS engine — heavy for what
   these scrapers actually do (a few dozen simple selectors: tag/class/id,
   `[attr]`/`[attr*=...]`, descendant and child combinators, comma groups).

`lib/micro-cheerio.js` implements exactly that subset — nothing more — as a
small HTML tokenizer + selector matcher with a cheerio-shaped API (`load()`,
`$()`, `.text()`, `.attr()`, `.each()`, `.find()`, `.filter()`, `.map()`,
`.next()`, `.parent()`, `.html()`, `$.html()`). `lib/micro-crypto.js`
similarly implements just the one `HmacSHA256(...).toString(...)` call
`MovieBlast.js` needs. Both are unit-tested against realistic inputs.

**Each provider file that needs one carries its own inlined copy** rather
than `require()`-ing the shared `lib/` file — again for Nuvio portability,
since a relative cross-file `require()` is a bigger assumption about the
sandbox than a self-contained file. The `lib/` copies are the canonical,
readable, independently-testable source; keep them in sync if you change the
engine (re-run the inlining rather than hand-editing both places).

## Fixes carried over from 3.6.x

- Preserved every scraper as enabled; no scraper was disabled.
- Fixed MkvBase-style TMDB numeric-id resolution (numeric TMDB IDs are
  resolved to a title before searching, where applicable).
- Provider failures are isolated — one provider erroring or timing out never
  prevents the others from returning results, in both the original Nuvio
  runtime and the new Stremio aggregator.

## Important

This package only fixes the plugin/runtime integration and dependency
footprint. Third-party source sites can still change, block requests,
require authentication, or return no usable source at any time.
