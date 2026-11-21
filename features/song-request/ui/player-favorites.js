/** Explicit library writes use the exact observed track, never a title search. */
/* exported installPlayerFavorites */
function installPlayerFavorites({ selected }) {
  const host = document.createElement("div");
  host.className = "playerFavorites";
  const save = document.createElement("button"),
    remove = document.createElement("button"),
    notice = document.createElement("span");
  for (const [button, label, icon] of [
    [save, "Favorite current song", "\u2661+"],
    [remove, "Remove favorite", "\u2661\u2212"],
  ]) {
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.textContent = icon;
  }
  notice.className = "favoriteNotice";
  notice.setAttribute("role", "status");
  host.append(save, remove, notice);
  document.querySelector(".nowFacts").append(host);
  const report = (message, failed = false) => {
    notice.textContent = message;
    notice.classList.toggle("failed", failed);
  };
  async function write(value) {
    if (save.disabled) return;
    save.disabled = remove.disabled = true;
    report("");
    try {
      const player = selected(),
        capability = { tidal: "song.tidal.experimental.v1", spotify: "song.spotify.player.v1" }[
          player
        ];
      if (!capability) throw Error("Choose TIDAL or Spotify first.");
      const state = await call(capability, "status", null),
        current = state.current;
      const trackId = current?.trackId || current?.uri?.replace(/^spotify:track:/, "");
      if (
        !state.ok ||
        !trackId ||
        selected() !== player ||
        (player === "tidal" && !state.connected)
      )
        throw Error("Start a song in this player first.");
      const result = await call(capability, "favorite", { trackId, save: value });
      if (!result.ok)
        throw Error(
          {
            spotify_favorites_sign_in_required:
              "Sign in again with Spotify in Setup to grant library access.",
            tidal_favorites_sign_in_required:
              "Sign in with TIDAL in Setup to grant collection access.",
            tidal_catalog_access_denied:
              "TIDAL denied My Tracks access. Check your connection in Setup.",
            tidal_favorite_track_not_found: "TIDAL could not find this track in its catalog.",
            tidal_favorite_unconfirmed: "TIDAL did not confirm that it added this track.",
          }[result.error] ||
            result.error ||
            "Library change could not be confirmed.",
        );
      report(
        player === "tidal"
          ? value
            ? "Added to TIDAL My Tracks."
            : "Removed from TIDAL My Tracks."
          : value
            ? "Song added to favorites."
            : "Song removed from favorites.",
      );
    } catch (error) {
      report(error.message, true);
    } finally {
      save.disabled = remove.disabled = false;
    }
  }
  save.onclick = () => write(true);
  remove.onclick = () => write(false);
  const sync = () => {
    report("");
    host.hidden = !["tidal", "spotify"].includes(selected());
  };
  $("songPlayerProvider").addEventListener("change", sync);
  sync();
  return { sync };
}
