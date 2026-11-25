/** The only music metadata allowed into public chat. Never stringify provider
 * objects or fall back to queries, playlist/source labels or account identities. */
function text(value, maximum) {
  if (typeof value !== "string") return "";
  const clean = value
    .normalize("NFKC")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Refuse metadata that looks like credentials, a local path, an email address
  // or a URL. Ordinary playback remains usable when public metadata is withheld.
  if (
    /https?:\/\/|file:\/\/|[a-z]:[\\/]|\\\\|\b(?:bearer|oauth)\s*[:= ]|(?:access|refresh)[_-]?token\s*[:=]|[^\s@]+@[^\s@]+\.[^\s@]+/i.test(
      clean,
    )
  )
    return "";
  return clean.slice(0, maximum);
}
function publicSong(row) {
  const candidate = row?.candidate || row || {};
  return {
    provider: ["youtube", "tidal", "spotify", "soundcloud"].includes(candidate.provider)
      ? candidate.provider
      : "",
    title: text(candidate.title, 180),
    artists: Array.isArray(candidate.artists)
      ? candidate.artists
          .slice(0, 10)
          .map((artist) => text(artist, 80))
          .filter(Boolean)
      : [],
  };
}
function songLabel(row, length = 180) {
  const song = publicSong(row);
  if (!song.title) return "";
  const artists = song.artists.join(", ");
  const budget = Math.min(60, Math.floor(length / 3));
  return (
    song.title.slice(0, artists ? length - budget - 3 : length) +
    (artists ? " - " + artists.slice(0, budget) : "")
  );
}
module.exports = { publicSong, songLabel };
