// Mimics rogmovies.js/vegamovies.js's contract: no top-level `quality` or
// `headers` field — quality baked into name/title text, and proxy headers
// already embedded under behaviorHints, native-Stremio-shaped.
async function getStreams(tmdbId, mediaType, season, episode) {
  return [{
    name: "FakeNative • 2160p • HubCloud",
    title: "FakeNative • 2160p • HubCloud",
    size: "3.1 GB",
    url: "https://mirror-me.example/native.mkv",
    _resWeight: 4,
    behaviorHints: { notWebReady: true, proxyHeaders: { request: { Referer: "https://mirror-me.example/" } } },
  }, {
    name: "FakeNative • 720p",
    title: "FakeNative • 720p",
    url: "https://mirror-me.example/native720.mkv",
    _resWeight: 2,
    behaviorHints: { notWebReady: true, proxyHeaders: { request: { Referer: "https://mirror-me.example/" } } },
  }];
}
module.exports = { getStreams };
