const BASE_URL = "https://mirror-me.example";
async function getStreams(tmdbId, mediaType, season, episode) {
  const r = await fetch(BASE_URL + "/search?id=" + tmdbId + "&t=" + mediaType + "&s=" + season + "&e=" + episode, {
    headers: { Referer: BASE_URL + "/" },
  });
  if (!r.ok) return [];
  const j = await r.json();
  console.log("fake provider got", j.url);
  return [
    { name: "\u200B\uFEFFFake • 1080p", title: "\u200BFake Movie 1080p", url: j.url, quality: "1080p", size: "1.2 GB", headers: { Referer: BASE_URL + "/" }, filename: "movie.mkv" },
    { name: "Fake 4K", title: "Fake Movie 4K", url: j.url + "?4k", quality: "2160p" },
    { name: "bad", title: "bad", url: "ftp://nope" },
  ];
}
module.exports = { getStreams, onSettings: async () => [{ type: "toggle", key: "flag", label: "Flag", defaultValue: true }] };
