(function(){"use strict";const modules={"./catalog.cjs":function(require,module,exports){
/**
 * Catalog.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#desktop-companions
 */
// Shared metadata normalization for desktop-assisted and official Spotify lookup.
const TRACK = /^spotify:track:([A-Za-z0-9]{22})$/;
function trackUri(value) {
  const input = String(value || "").trim();
  if (TRACK.test(input)) return input;
  if (/^[A-Za-z0-9]{22}$/.test(input)) return "spotify:track:" + input;
  try {
    const url = new URL(input),
      match = /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?track\/([A-Za-z0-9]{22})\/?$/i.exec(
        url.pathname,
      );
    if (
      url.protocol === "https:" &&
      url.hostname === "open.spotify.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      match
    )
      return "spotify:track:" + match[1];
  } catch {}
  return "";
}
const clean = (value, max) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
function artworkUrl(value) {
  if (typeof value !== "string" || value.length > 300) return "";
  if (/^spotify:image:[a-f0-9]{40}$/i.test(value))
    return "https://i.scdn.co/image/" + value.slice(14);
  return /^https:\/\/i\.scdn\.co\/image\/[a-f0-9]{40}$/i.test(value) ? value : "";
}
function candidate(raw) {
  const uri = trackUri(raw?.uri || raw?.id);
  if (
    !uri ||
    typeof raw?.name !== "string" ||
    !clean(raw.name, 300) ||
    raw.is_playable === false ||
    raw.is_local === true
  )
    return null;
  const id = uri.slice("spotify:track:".length);
  return {
    provider: "spotify",
    providerItemId: id,
    uri,
    title: clean(raw.name, 300),
    artists: (Array.isArray(raw.artists) ? raw.artists : [])
      .slice(0, 8)
      .map((row) => clean(row?.name, 100))
      .filter(Boolean),
    album: clean(raw.album?.name, 200),
    artworkUrl: artworkUrl(raw.album?.images?.[0]?.url),
    durationMs: Math.max(0, Math.min(86400000, Number(raw.duration_ms) || 0)),
    explicit: raw.explicit === true,
    isrc: /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(raw.external_ids?.isrc || "")
      ? raw.external_ids.isrc
      : "",
    sourceUrl: "https://open.spotify.com/track/" + id,
  };
}
function searchPath(query) {
  const text = clean(query, 300);
  if (!text || /https?:\/\/|spotify:/i.test(text)) return "";
  return "/search?" + new URLSearchParams({ q: text, type: "track", limit: "10" });
}
function searchResult(body) {
  if (!Array.isArray(body?.tracks?.items))
    return { ok: false, error: "spotify_search_shape_unavailable" };
  const candidates = body.tracks.items.slice(0, 10).map(candidate).filter(Boolean);
  return { ok: true, candidates };
}
module.exports = { trackUri, candidate, searchPath, searchResult, artworkUrl };

},
"./playlist-reader.cjs":function(require,module,exports){
/**
 * Bounded Spotify playlist operation contract.
 * Normalize identifiers, offsets, names, track IDs, and result shapes on both sides
 * of the bridge. Playlist reads and write batches have different budgets. Preserve
 * ordered duplicates, and distinguish unsupported native calls from uncertain writes
 * whose response was lost after the desktop client may already have committed.
 */
const { trackUri, artworkUrl } = require("./catalog.cjs");
const clean = (value, limit) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit) : "";
function playlistUri(value) {
  if (typeof value !== "string" || value.length > 500) return "";
  if (/^[A-Za-z0-9]{22}$/.test(value)) return "spotify:playlist:" + value;
  if (/^spotify:playlist:[A-Za-z0-9]{22}$/.test(value)) return value;
  try {
    const url = new URL(value),
      match = /^\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
    if (
      url.protocol === "https:" &&
      url.hostname === "open.spotify.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      match
    )
      return "spotify:playlist:" + match[1];
  } catch {}
  return "";
}
function normalize(input) {
  if (!input || !["read", "list", "create", "append"].includes(input.action)) return null;
  if (input.action === "create")
    return typeof input.name === "string" && input.name.trim() && input.name.length <= 100
      ? { action: "create", name: input.name }
      : null;
  if (input.action === "append")
    return playlistUri(input.id) &&
      Array.isArray(input.ids) &&
      input.ids.length > 0 &&
      input.ids.length <= 25 &&
      input.ids.every((value) => trackUri(value))
      ? {
          action: "append",
          id: playlistUri(input.id),
          ids: input.ids.map(trackUri),
        }
      : null;
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) return null;
  const uri = playlistUri(input.id);
  return input.action === "read" && !uri
    ? null
    : { action: input.action, offset, ...(uri ? { id: uri } : {}) };
}
function track(raw) {
  const item = raw?.track || raw,
    uri = trackUri(item?.uri);
  if (!uri || item.isLocal || item.isPlayable === false || item.playability?.playable === false)
    return null;
  const artists = Array.isArray(item.artists) ? item.artists : item.artists?.items || [];
  return {
    provider: "spotify",
    providerItemId: uri.slice(14),
    title: clean(item.name || item.title, 200) || uri.slice(14),
    artists: artists
      .slice(0, 8)
      .map((artist) => clean(artist.name || artist.profile?.name || artist, 100))
      .filter(Boolean),
    album: clean(
      typeof item.album === "string" ? item.album : item.album?.name || item.albumOfTrack?.name,
      200,
    ),
    artworkUrl: artworkUrl(item.artworkUrl || item.album?.images?.[0]?.url),
    durationMs: Math.max(
      0,
      Math.min(
        86400000,
        Number(
          item.duration?.milliseconds ??
            item.duration?.totalMilliseconds ??
            item.duration_ms ??
            item.durationMs,
        ) || 0,
      ),
    ),
    sourceUrl: "https://open.spotify.com/track/" + uri.slice(14),
  };
}
function result(raw, input) {
  if (raw?.ok !== true) return null;
  if (input.action === "create")
    return playlistUri(raw.id) ? { ok: true, id: playlistUri(raw.id) } : null;
  if (input.action === "append") return { ok: true };
  if (input.action === "list") {
    if (raw.cursor && (!/^\d{1,5}$/.test(raw.cursor) || Number(raw.cursor) > 10000)) return null;
    if (
      !Array.isArray(raw.playlists) ||
      raw.playlists.length > 25 ||
      raw.playlists.some(
        (row) => !playlistUri(row?.id) || typeof row.name !== "string" || row.name.length > 200,
      )
    )
      return null;
    return {
      ok: true,
      playlists: raw.playlists.map((row) => ({
        id: playlistUri(row.id),
        name: row.name,
      })),
      cursor: String(raw.cursor || ""),
    };
  }
  if (
    !Array.isArray(raw.tracks) ||
    raw.tracks.length > 25 ||
    !Number.isInteger(raw.total) ||
    raw.total < input.offset ||
    raw.total > 1000000 ||
    raw.tracks.some(
      (row) => row !== null && (!trackUri(row?.providerItemId) || typeof row.title !== "string"),
    )
  )
    return null;
  const tracks = raw.tracks.map((row) =>
    row ? track({ ...row, uri: trackUri(row.providerItemId), name: row.title }) : null,
  );
  // Bound bytes as well as item count: long Unicode metadata must fit in the
  // companion's 64 KiB receipt without losing the remaining source positions.
  while (tracks.length > 1 && new TextEncoder().encode(JSON.stringify(tracks)).byteLength > 48000)
    tracks.pop();
  const next = input.offset + tracks.length;
  if (raw.total > next && !raw.tracks.length) return null;
  return {
    ok: true,
    name: clean(raw.name, 80),
    total: raw.total,
    revision: clean(raw.revision, 160),
    tracks,
    cursor: next < raw.total ? String(next) : "",
  };
}
async function read(service, input) {
  try {
    if (input.action === "create") {
      const root = service("RootlistAPI");
      if (typeof root?.createPlaylist !== "function")
        return {
          ok: false,
          error: "spotify_playlist_unavailable",
          safeToRetry: true,
        };
      const uri = playlistUri(await root.createPlaylist(input.name, { before: "start" }));
      if (!uri) throw Error("spotify_playlist_write_uncertain");
      return { ok: true, id: uri };
    }
    if (input.action === "append") {
      const api = service("PlaylistAPI");
      if (typeof api?.add !== "function")
        return {
          ok: false,
          error: "spotify_playlist_unavailable",
          safeToRetry: true,
        };
      await api.add(input.id, input.ids, { after: "end" });
      return { ok: true };
    }
    if (input.action === "list") {
      const root = service("RootlistAPI");
      if (typeof root?.getContents !== "function") throw Error("spotify_playlist_unavailable");
      const contents = await root.getContents(),
        rows = [],
        seen = new Set();
      let visited = 0;
      function walk(items, depth = 0) {
        if (!Array.isArray(items) || depth > 12) throw Error("spotify_playlist_shape_unavailable");
        for (const item of items) {
          if (++visited > 10000) throw Error("spotify_playlist_list_limit");
          const id = playlistUri(item?.uri);
          if (id && !seen.has(id)) {
            seen.add(id);
            rows.push({
              id,
              name: clean(item.name, 200) || "Spotify playlist",
            });
          }
          if (Array.isArray(item?.items)) walk(item.items, depth + 1);
        }
      }
      walk(contents?.items);
      return {
        ok: true,
        playlists: rows.slice(input.offset, input.offset + 25),
        cursor: rows.length > input.offset + 25 ? String(input.offset + 25) : "",
      };
    }
    const api = service("PlaylistAPI");
    if (typeof api?.getPlaylist !== "function") throw Error("spotify_playlist_unavailable");
    const reply = await api.getPlaylist(input.id, {}, { offset: input.offset, limit: 25 });
    if (
      reply?.metadata?.isLoaded !== true ||
      !Number.isInteger(reply.metadata.totalLength) ||
      !Array.isArray(reply.contents?.items) ||
      reply.contents.items.length > 25
    )
      throw Error("spotify_playlist_shape_unavailable");
    return (
      result(
        {
          ok: true,
          name: reply.metadata.name,
          total: reply.metadata.totalLength,
          revision: reply.contents.revision || reply.metadata.revision,
          tracks: reply.contents.items.map(track),
        },
        input,
      ) || { ok: false, error: "spotify_playlist_shape_unavailable" }
    );
  } catch (error) {
    return {
      ok: false,
      error: /^spotify_playlist_[a-z_]+$/.test(error.message)
        ? error.message
        : ["create", "append"].includes(input.action)
          ? "spotify_playlist_write_uncertain"
          : "spotify_playlist_read_failed",
    };
  }
}
module.exports = { normalize, result, read, playlistUri };

},
"./desktop-adapter.cjs":function(require,module,exports){
/**
 * Desktop adapter.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#desktop-companions
 */
// Prototype client adapter; no network listener, client patching or automatic installation.
const { trackUri, searchPath, searchResult, candidate } = require("./catalog.cjs");
module.exports = function createSpotifyDesktopAdapter(api, options = {}) {
  const verifyLocalDevice = options.verifyLocalDevice;
  let serial = Promise.resolve();
  const ordered = (action) => {
    const result = serial.then(action);
    serial = result.catch(() => {});
    return result;
  };
  const capabilities = Object.freeze({
    mode: "desktop",
    queueAppend: typeof api?.addToQueue === "function",
    queueRemoval: typeof api?.removeFromQueue === "function",
    search: typeof api?.CosmosAsync?.get === "function",
    liveVerified: false,
  });
  function queue() {
    let rows;
    try {
      rows = api?.Queue?.nextTracks;
    } catch {
      return { ok: false, error: "spotify_queue_shape_unavailable" };
    }
    if (!Array.isArray(rows) || rows.length > 10000)
      return { ok: false, error: "spotify_queue_shape_unavailable" };
    const entries = [];
    for (const row of rows) {
      const track = row?.contextTrack || row;
      const uri = trackUri(track?.uri),
        uid = typeof track?.uid === "string" && track.uid.length <= 200 ? track.uid : "";
      if (uri)
        entries.push({
          uri,
          uid,
          origin:
            row.provider === "queue"
              ? "manual"
              : row.provider === "context"
                ? "playlist"
                : "unknown",
        });
    }
    return { ok: true, entries };
  }
  function snapshot() {
    try {
      return api.snapshot();
    } catch {
      return {
        ok: false,
        localDevice: false,
        error: "spotify_queue_shape_unavailable",
      };
    }
  }
  async function local() {
    try {
      return typeof verifyLocalDevice === "function" && (await verifyLocalDevice()) === true;
    } catch {
      return false;
    }
  }
  return {
    capabilities,
    queue,
    snapshot,
    control(input) {
      return ordered(async () => {
        if (!(await local())) return { ok: false, error: "spotify_local_device_unverified" };
        if (!["pause", "resume", "skip", "volume"].includes(input?.action))
          return { ok: false, error: "spotify_command_invalid" };
        if (
          input.action === "skip" &&
          (!input.currentUid || snapshot()?.current?.uid !== input.currentUid)
        )
          return { ok: false, error: "spotify_current_changed" };
        try {
          if (input.action === "volume") {
            if (!Number.isInteger(input.value) || input.value < 0 || input.value > 100)
              return { ok: false, error: "spotify_volume_invalid" };
            await api.Player.setVolume(input.value / 100);
            return { ok: true, accepted: true };
          }
          await api.Player[
            input.action === "resume" ? "play" : input.action === "skip" ? "next" : "pause"
          ]();
          return { ok: true, accepted: true };
        } catch {
          return { ok: false, error: "spotify_playback_restricted" };
        }
      });
    },
    async playlist(input) {
      if (!api.readPlaylist) return { ok: false, error: "spotify_playlist_unavailable" };
      return api.readPlaylist(input);
    },
    async lookup(value) {
      const uri = trackUri(value);
      if (!uri) return { ok: false, error: "spotify_track_invalid" };
      try {
        const found = candidate(
          await api.CosmosAsync.get("https://api.spotify.com/v1/tracks/" + uri.slice(14)),
        );
        return found
          ? { ok: true, candidates: [found] }
          : { ok: false, error: "spotify_search_shape_unavailable" };
      } catch {
        try {
          return searchResult(await api.lookupCatalog(uri));
        } catch {
          return { ok: false, error: "spotify_desktop_search_rejected" };
        }
      }
    },
    async search(query) {
      const route = searchPath(query);
      if (!route) return { ok: false, error: "spotify_search_query_invalid" };
      if (!capabilities.search) return { ok: false, error: "spotify_search_unavailable" };
      try {
        return searchResult(await api.CosmosAsync.get("https://api.spotify.com/v1" + route));
      } catch {
        try {
          return searchResult(await api.searchCatalog(query));
        } catch {
          return { ok: false, error: "spotify_desktop_search_rejected" };
        }
      }
    },
    append(value, appendOptions = {}) {
      return ordered(async () => {
        const uri = trackUri(value);
        if (!uri) return { ok: false, error: "spotify_track_invalid" };
        if (!capabilities.queueAppend)
          return { ok: false, error: "spotify_queue_append_unavailable" };
        if (!(await local()))
          return { ok: false, error: "spotify_local_device_unverified", safeToRetry: true };
        const before = queue();
        if (!before.ok) return { ...before, safeToRetry: true };
        const uid =
          typeof appendOptions.uid === "string" && appendOptions.uid.length <= 200
            ? appendOptions.uid
            : "";
        const exact = (row) => row?.uid === uid && row.uri === uri;
        const observed = (entries) =>
          entries.some((row) => row.origin === "manual" && exact(row)) ||
          exact(snapshot()?.current);
        if (uid && observed(before.entries)) return { ok: true, delivery: "confirmed", uri, uid };
        const ids = new Set(before.entries.map((row) => row.uid).filter(Boolean));
        try {
          await api.addToQueue([
            {
              uri,
              ...(uid ? { uid } : {}),
            },
          ]);
        } catch (error) {
          return {
            ok: false,
            error: ["spotify_playback_restricted", "spotify_native_queue_rejected"].includes(
              error.message,
            )
              ? error.message
              : "spotify_delivery_unconfirmed",
            retrySafe: false,
          };
        }
        let after = queue(),
          added = [];
        const deadline = Date.now() + (options.confirmationMs ?? 1500);
        do {
          added = after.ok
            ? after.entries.filter(
                (row) => row.uri === uri && row.uid && !ids.has(row.uid) && row.origin === "manual",
              )
            : [];
          if (uid && observed(after.ok ? after.entries : []))
            return { ok: true, delivery: "confirmed", uri, uid };
          if ((!uid && added.length) || Date.now() >= deadline) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
          after = queue();
        } while (true);
        return !uid && added.length === 1
          ? { ok: true, delivery: "confirmed", uri, uid: added[0].uid }
          : {
              ok: false,
              error: "spotify_delivery_unconfirmed",
              retrySafe: false,
            };
      });
    },
    remove(entry) {
      return ordered(async () => {
        const uri = trackUri(entry?.uri),
          uid = typeof entry?.uid === "string" ? entry.uid : "";
        if (!uri || !uid || uid.length > 200)
          return { ok: false, error: "spotify_queue_entry_id_required" };
        if (!capabilities.queueRemoval)
          return { ok: false, error: "spotify_queue_removal_unavailable" };
        if (!(await local())) return { ok: false, error: "spotify_local_device_unverified" };
        const state = queue();
        if (!state.ok) return state;
        if (
          !state.entries.some(
            (row) => row.uri === uri && row.uid === uid && row.origin === "manual",
          )
        )
          return { ok: false, error: "spotify_queue_entry_not_found" };
        try {
          await api.removeFromQueue([{ uri, uid }]);
        } catch {
          return {
            ok: false,
            error: "spotify_removal_unconfirmed",
            retrySafe: false,
          };
        }
        const after = queue();
        return after.ok && !after.entries.some((row) => row.uid === uid)
          ? { ok: true, removed: true }
          : {
              ok: false,
              error: "spotify_removal_unconfirmed",
              retrySafe: false,
            };
      });
    },
  };
};

},
"./native-facade.cjs":function(require,module,exports){
/**
 * Minimal facade over Spotify's captured native platform.
 * Keep platform shape probing and private-client assumptions in this adapter.
 * Do not export the captured platform object to the feature worker or browser HUD.
 * Capability absence must be explicit rather than guessed from account labels;
 * desktop-client updates can change the underlying methods independently of Core.
 */
// SPDX-License-Identifier: LGPL-2.1-only
// Reduced/adapted native Player/Queue access from Spicetify; see vendor/spicetify/NOTICE.md.
const { trackUri, artworkUrl } = require("./catalog.cjs");
module.exports = function createNativeFacade(platform, options = {}) {
  function service(name) {
    const value = platform?.["get" + name];
    if (typeof value === "function") return value.call(platform);
    if (platform?.[name]) return platform[name];
    return platform?.getRegistry?.()?.resolve(Symbol.for(name));
  }
  const player = () => {
    const value = service("PlayerAPI");
    if (!value) throw Error("spotify_player_unavailable");
    return value;
  };
  const queue = () => {
    const value = player()._queue;
    if (!value) throw Error("spotify_queue_unavailable");
    return value;
  };
  const state = () => {
    const value = player()._state;
    if (!value || typeof value.isPaused !== "boolean")
      throw Error("spotify_player_state_unavailable");
    return value;
  };
  const milliseconds = (input) =>
    Number.isFinite(Number(input)) ? Math.max(0, Math.min(86400000, Number(input))) : 0;
  function progress(value = state()) {
    const position = milliseconds(value.positionAsOfTimestamp),
      duration = milliseconds(value.duration);
    const timestamp = Number(value.timestamp),
      elapsed =
        !value.isPaused && !value.isBuffering && Number.isFinite(timestamp) && timestamp > 0
          ? milliseconds(Date.now() - timestamp)
          : 0;
    return Math.min(duration || Infinity, position + elapsed);
  }
  function tracks(rows, removal) {
    if (!Array.isArray(rows) || rows.length !== 1 || !trackUri(rows[0]?.uri))
      throw Error("spotify_track_invalid");
    const row = { uri: trackUri(rows[0].uri) };
    if (typeof rows[0].uid === "string" && rows[0].uid.length <= 200) row.uid = rows[0].uid;
    if (removal) {
      if (typeof rows[0].uid !== "string" || !rows[0].uid || rows[0].uid.length > 200)
        throw Error("spotify_queue_entry_id_required");
      row.uid = rows[0].uid;
    }
    return [row];
  }
  async function catalog(operation, variables) {
    const hash = options.catalog?.[operation];
    if (!["searchTracks", "getTrack"].includes(operation) || !/^[a-f0-9]{64}$/.test(hash || ""))
      throw Error("spotify_native_lookup_unavailable");
    const loader = service("GraphQLLoader");
    if (typeof loader !== "function") throw Error("spotify_native_lookup_unavailable");
    const reply = await loader(
      { name: operation, operation: "query", sha256Hash: hash, value: null },
      variables,
    );
    const rows =
      operation === "getTrack"
        ? [reply?.data?.trackUnion]
        : (reply?.data?.searchV2?.tracksV2?.items || []).map((row) => row.item?.data || row.data);
    return {
      tracks: {
        items: rows
          .slice(0, 10)
          .filter((row) => row?.__typename === "Track")
          .map((row) => ({
            uri: row.uri,
            name: row.name,
            duration_ms: row.duration?.totalMilliseconds,
            artists: (
              row.artists?.items || [
                ...(row.firstArtist?.items || []),
                ...(row.otherArtists?.items || []),
              ]
            ).map((artist) => ({ name: artist.profile?.name || artist.name })),
            album: { name: row.albumOfTrack?.name },
            is_playable: row.playability?.playable !== false,
          })),
      },
    };
  }
  const facade = {
    readPlaylist(input) {
      return require("./playlist-reader.cjs").read(service, input);
    },
    get Queue() {
      const value = queue(),
        snapshot =
          typeof value.getInternalQueue === "function"
            ? value.getInternalQueue()
            : (value._state ?? value._queue);
      // A signed-in, idle client can have no playback context yet. Its native
      // add-to-queue command can still accept tracks without starting playback.
      if (snapshot === null) return { nextTracks: [], track: null };
      if (!snapshot || !Array.isArray(snapshot.nextTracks))
        throw Error("spotify_queue_shape_unavailable");
      return snapshot;
    },
    async addToQueue(rows) {
      const value = queue(),
        entries = tracks(rows, false);
      if (typeof value._client?.addToQueue === "function") {
        // The high-level queue API discards this native acknowledgement. Keep
        // explicit rejections distinguishable from uncertain network delivery.
        const result = await value._client.addToQueue({
          track: entries[0],
          loggingParams: {
            commandInitiatedTime: { value: BigInt(Date.now()) },
          },
        });
        if (result?.error !== undefined && result.error !== 0)
          throw Error(
            result.error === 1 ? "spotify_playback_restricted" : "spotify_native_queue_rejected",
          );
        return result;
      }
      if (typeof value.addToQueue !== "function") throw Error("spotify_queue_append_unavailable");
      return value.addToQueue(entries);
    },
    removeFromQueue(rows) {
      const value = queue();
      if (typeof value.removeFromQueue !== "function")
        throw Error("spotify_queue_removal_unavailable");
      return value.removeFromQueue(tracks(rows, true));
    },
    Player: {
      getProgress: progress,
      isPlaying: () => !state().isPaused && !state().isBuffering,
      pause: () => player().pause(),
      play: () => player().resume(),
      next: () => player().skipToNext(),
      setVolume: (value) => {
        if (typeof player().setVolume !== "function") throw Error("spotify_volume_unavailable");
        return player().setVolume(value);
      },
    },
    localDevice() {
      try {
        const device = service("ConnectDevicesAPI")?.getActiveDevice?.();
        return device?.isLocal === true && device.isActive === true && device.isDisabled !== true;
      } catch {
        return false;
      }
    },
    searchCatalog(query) {
      if (
        typeof query !== "string" ||
        !query.trim() ||
        query.length > 300 ||
        /https?:\/\/|spotify:/i.test(query)
      )
        throw Error("spotify_search_query_invalid");
      return catalog("searchTracks", {
        searchTerm: query,
        offset: 0,
        limit: 10,
        includeAudiobooks: false,
        includePreReleases: false,
        includeAlbumPreReleases: false,
        includeAuthors: false,
        includeEpisodeContentRatingsV2: false,
      });
    },
    lookupCatalog(value) {
      const uri = trackUri(value);
      if (!uri) throw Error("spotify_track_invalid");
      return catalog("getTrack", { uri, includePrerelease: false });
    },
    snapshot() {
      const snapshot = facade.Queue,
        current = snapshot.track?.contextTrack || snapshot.track;
      let value;
      try {
        value = state();
      } catch {
        value = null;
      }
      const item = value?.item || {},
        metadata = item.metadata || current?.metadata || {};
      const uri = trackUri(current?.uri || item.uri),
        uid = current?.uid || item.uid || value?.playbackId || "";
      let deviceId = "";
      try {
        const device = service("ConnectDevicesAPI")?.getActiveDevice?.();
        const value = device?.id || device?.device_id || device?.deviceId;
        if (/^[A-Za-z0-9_-]{1,120}$/.test(value || "")) deviceId = value;
      } catch {}
      const manual = snapshot.nextTracks.filter((row) => row?.provider === "queue"),
        entries = manual
          .slice(0, 40)
          .map((row) => ({
            uri: trackUri(row.contextTrack?.uri || row.uri),
            uid: row.contextTrack?.uid || row.uid || "",
            origin: "manual",
          }))
          .filter(
            (row) => row.uri && typeof row.uid === "string" && row.uid.length <= 200 && row.uid,
          );
      return {
        ok: true,
        complete: manual.length === entries.length && (!uri || Boolean(uid)),
        localDevice: facade.localDevice(),
        ...(deviceId ? { deviceId } : {}),
        queue: entries,
        current: uri
          ? {
              uri,
              uid,
              title: String(metadata.title || metadata.name || ""),
              artists: [String(metadata.artist_name || "")].filter(Boolean),
              album: String(metadata.album_title || ""),
              artworkUrl:
                [
                  metadata.image_xlarge_url,
                  metadata.image_large_url,
                  metadata.image_url,
                  metadata.image_small_url,
                  item.album?.images?.[0]?.url,
                ]
                  .map(artworkUrl)
                  .find(Boolean) || "",
              durationMs: milliseconds(value?.duration),
              positionMs: value ? progress(value) : 0,
              paused: value?.isPaused !== false,
              buffering: value?.isBuffering === true,
            }
          : null,
      };
    },
    // Adapter compatibility name only: this is a narrow native read, not Spicetify's proxy.
    CosmosAsync: {
      async get(value) {
        const url = new URL(value);
        if (
          url.origin !== "https://api.spotify.com" ||
          url.username ||
          url.password ||
          url.hash ||
          !(
            url.pathname === "/v1/search" || /^\/v1\/tracks\/[A-Za-z0-9]{22}$/.test(url.pathname)
          ) ||
          (url.pathname === "/v1/search" &&
            (url.searchParams.get("type") !== "track" ||
              url.searchParams.get("limit") !== "10" ||
              !url.searchParams.get("q")?.trim() ||
              url.searchParams.get("q").length > 300 ||
              ["q", "type", "limit"].some((key) => url.searchParams.getAll(key).length !== 1) ||
              [...url.searchParams.keys()].some((key) => !["q", "type", "limit"].includes(key)))) ||
          (url.pathname !== "/v1/search" && url.search)
        )
          throw Error("spotify_lookup_route_invalid");
        const transport = player()._cosmos;
        if (typeof transport?.get === "function") return transport.get(url.href);
        const builder = service("RequestBuilder") || platform?.getRequestBuilder?.();
        if (typeof builder?.build !== "function") throw Error("spotify_native_lookup_unavailable");
        const response = await builder
          .build()
          .withHost("https://api.spotify.com")
          .withPath(url.pathname)
          .withQueryParameters(Object.fromEntries(url.searchParams))
          .withMethod("GET")
          .send();
        return response?.body ?? response;
      },
    },
  };
  return Object.freeze(facade);
};

},
"./connection-worker.cjs":function(require,module,exports){
/**
 * Spotify renderer bridge pump and receipt deduplication.
 * Only one step runs at a time. Cache command outcomes by ID/signature and resend
 * a pending receipt after transport failure instead of executing the command again.
 * Retain reusable and uncertain write receipts. Unique host commands can be
 * discarded after the host acknowledges a confirmed outcome.
 * Action timeouts do not cancel native side effects and must remain retry-unsafe.
 */
module.exports = function createSpotifyConnection(client, options = {}) {
  const base = new URL(options.coreUrl || "http://127.0.0.1:5050");
  if (
    base.protocol !== "http:" ||
    base.hostname !== "127.0.0.1" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    !/^[a-f0-9]{64}$/.test(options.token || "")
  )
    throw Error("spotify_pairing_invalid");
  const clientId = options.clientId || globalThis.crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(clientId)) throw Error("spotify_companion_id_invalid");
  const fetchImpl = options.fetch || globalThis.fetch,
    results = new Map(),
    historyLimit = options.historyLimit ?? 2048;
  let sessionId = "",
    pendingReceipt = null,
    receiptSessionId = "",
    inFlight = null,
    heartbeatWork = null,
    heartbeatAt = 0,
    executing = false,
    waitForCommand = false,
    rejoining = false,
    closed = false,
    lastError = "";
  async function post(method, payload) {
    const sentSessionId = sessionId;
    const body = pack(payload);
    const response = await fetchImpl(new URL("/api/spotify/bridge/" + method, base), {
      method: "POST",
      headers: {
        authorization: "Bearer " + options.token,
        "content-type": "application/json",
      },
      body,
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(5000),
    });
    const chunks = [];
    let bytes = 0;
    if (!response.body) throw Error("spotify_bridge_reply_invalid");
    // Older Spotify CEF builds expose getReader without stream async iteration.
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65536) {
          void reader.cancel().catch(() => {});
          throw Error("spotify_bridge_reply_invalid");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const reply = JSON.parse(new TextDecoder().decode(joined));
    if (
      response.status === 409 &&
      reply.error === "spotify_companion_session_required" &&
      sessionId === sentSessionId
    )
      sessionId = "";
    if (!response.ok || reply.ok !== true) {
      const error = Error("spotify_bridge_rejected");
      if (
        [
          "spotify_companion_session_required",
          "spotify_result_unknown",
          "spotify_result_invalid",
        ].includes(reply.error)
      )
        error.code = reply.error;
      throw error;
    }
    return reply;
  }
  function pack(payload) {
    const text = JSON.stringify({ clientId, sessionId, ...payload });
    if (new TextEncoder().encode(text).byteLength > 65536)
      throw Error("spotify_bridge_payload_invalid");
    return text;
  }
  function nextPayload() {
    const payload = { wait: waitForCommand };
    try {
      const snapshot = client.snapshot?.();
      if (snapshot?.ok) {
        const value = { ...payload, snapshot };
        pack(value);
        return value;
      }
    } catch {
      // A native snapshot is optional. Keep the command channel connected.
    }
    return payload;
  }
  function receipt(command, result) {
    const body = { id: command.id, lease: command.lease, result };
    try {
      pack(body);
      return body;
    } catch {
      return { ...body, result: { ok: false, error: failureCode(command), retrySafe: false } };
    }
  }
  const readOnly = (command) =>
    ["search", "lookup"].includes(command.kind) ||
    (command.kind === "playlist" && ["list", "read"].includes(command.payload?.action));
  const failureCode = (command) =>
    readOnly(command) ? "spotify_companion_action_failed" : "spotify_delivery_unconfirmed";
  async function execute(command) {
    if (
      !command ||
      typeof command.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(command.id) ||
      !/^[a-f0-9]{32}$/.test(command.lease || "") ||
      !["append", "remove", "search", "lookup", "control", "playlist"].includes(command.kind)
    )
      throw Error("spotify_bridge_command_invalid");
    const signature = JSON.stringify([command.kind, command.payload]),
      previous = results.get(command.id);
    if (previous) {
      if (previous.signature !== signature) throw Error("spotify_request_id_conflict");
      if (previous.result?.safeToRetry !== true) return previous.result;
      results.delete(command.id);
    }
    for (const [id, item] of results) if (item.readOnly) results.delete(id);
    if (results.size >= historyLimit) throw Error("spotify_bridge_history_full");
    let timer;
    const limit = Math.max(50, Math.min(5000, options.actionTimeoutMs || 4000));
    const action = Promise.resolve().then(() =>
      command.kind === "playlist"
        ? client.playlist(command.payload)
        : command.kind === "search"
          ? client.search(command.payload?.query)
          : command.kind === "lookup"
            ? client.lookup(command.payload?.uri)
            : command.kind === "append"
              ? client.append(command.payload?.uri, {
                  uid: command.payload?.uid,
                })
              : command.kind === "control"
                ? client.control(command.payload)
                : client.remove(command.payload),
    );
    let result;
    try {
      result = await Promise.race([
        action,
        new Promise((resolve) => {
          timer = setTimeout(
            () =>
              resolve({
                ok: false,
                error:
                  command.kind === "search"
                    ? "spotify_desktop_search_rejected"
                    : "spotify_delivery_unconfirmed",
                retrySafe: false,
              }),
            limit,
          );
        }),
      ]);
    } catch {
      result = {
        ok: false,
        error: failureCode(command),
        retrySafe: false,
      };
    } finally {
      clearTimeout(timer);
    }
    results.set(command.id, {
      signature,
      result,
      readOnly: readOnly(command),
      oneShot: command.oneShot === true,
    });
    return result;
  }
  async function acknowledge() {
    const reply = await post("result", pendingReceipt);
    if (!reply.reviewRequired) releaseConfirmedReceipt();
    pendingReceipt = null;
  }
  function releaseConfirmedReceipt() {
    const item = results.get(pendingReceipt.id);
    if (item?.oneShot && (item.result?.ok || item.result?.safeToRetry === true))
      results.delete(pendingReceipt.id);
  }
  async function step() {
    if (closed) return;
    try {
      if (!sessionId) {
        const hello = await post("hello", {});
        sessionId = hello.sessionId;
        waitForCommand = options.longPoll === true && hello.waitForCommand === true;
        // A restarted host has a new session and cannot accept an old lease.
        // Keep cached outcomes to prevent another native write, but release the
        // obsolete acknowledgement so it cannot block all future polling.
        if (pendingReceipt && receiptSessionId !== sessionId) pendingReceipt = null;
      }
      if (!sessionId) throw Error("spotify_bridge_session_invalid");
      // Only the receipt is retried after a dropped reply, never the native command.
      if (pendingReceipt) {
        await acknowledge();
        rejoining = false;
        lastError = "";
        return;
      }
      const { command } = await post("next", nextPayload());
      rejoining = false;
      if (!command) {
        lastError = "";
        return;
      }
      const commandSessionId = sessionId;
      executing = true;
      try {
        let result;
        try {
          result = await execute(command);
        } catch {
          result = { ok: false, error: failureCode(command), retrySafe: false };
        }
        receiptSessionId = commandSessionId;
        pendingReceipt = receipt(command, result);
      } finally {
        executing = false;
      }
      await acknowledge();
      lastError = "";
    } catch (error) {
      // Completed read receipts can be evicted by the host before an ACK retry.
      // Never execute the command again just to replace an unknown receipt.
      if (["spotify_result_unknown", "spotify_result_invalid"].includes(error.code)) {
        if (error.code === "spotify_result_unknown" && pendingReceipt) releaseConfirmedReceipt();
        pendingReceipt = null;
        lastError = "";
        return;
      }
      if (error.code === "spotify_companion_session_required" && !rejoining) {
        rejoining = true;
        lastError = "";
        return;
      }
      lastError = "spotify_bridge_unavailable";
    }
  }
  return {
    step() {
      // The renderer already ticks once per second. While a native call or ACK
      // is pending, send a separate bounded heartbeat without fetching another
      // command or creating another timer. At most one heartbeat is in flight.
      if (
        inFlight &&
        (executing || pendingReceipt) &&
        !closed &&
        sessionId &&
        !heartbeatWork &&
        Date.now() - heartbeatAt >= 2000
      ) {
        heartbeatAt = Date.now();
        heartbeatWork = post("heartbeat", {})
          .catch(() => {})
          .finally(() => {
            heartbeatWork = null;
          });
      }
      if (!inFlight)
        inFlight = step().finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    status: () => ({
      paired: Boolean(sessionId),
      awaitingReceipt: Boolean(pendingReceipt),
      waitForCommand,
      executed: results.size,
      lastError,
      closed,
    }),
    close() {
      closed = true;
    },
  };
};

},
"./renderer-bootstrap.cjs":function(require,module,exports){
/**
 * Renderer bootstrap.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#desktop-companions
 */
const createFacade = require("./native-facade.cjs");
const createAdapter = require("./desktop-adapter.cjs");
const createConnection = require("./connection-worker.cjs");
module.exports = function installSpotifyRuntime(root, options = {}) {
  if (Object.hasOwn(root, "__ravelinkSpotify")) throw Error("spotify_runtime_already_installed");
  let captured = false,
    client = null,
    connection = null,
    failed = false;
  const bridge = {};
  Object.defineProperty(bridge, "capturePlatform", {
    set(platform) {
      if (captured || !platform || typeof platform !== "object") return;
      captured = true;
      try {
        const facade = createFacade(platform, {
          catalog: options.connection?.catalog,
        });
        client = createAdapter(facade, {
          verifyLocalDevice: options.verifyLocalDevice || (() => facade.localDevice()),
        });
        options.onReady?.(client, facade);
      } catch {
        failed = true;
      }
    },
  });
  if (options.connection) {
    // Pair as soon as our renderer loads. Native methods remain unavailable
    // until capture completes, allowing Setup to distinguish loading from pairing.
    const unavailable = () => ({
      ok: false,
      error: "spotify_companion_unavailable",
    });
    const proxy = Object.fromEntries(
      ["search", "lookup", "append", "remove", "control", "snapshot", "playlist"].map((method) => [
        method,
        (...args) => (client ? client[method](...args) : unavailable()),
      ]),
    );
    connection = createConnection(proxy, { ...options.connection, longPoll: true });
    if (options.autoPoll !== false) startPump(root, connection);
  }
  Object.defineProperty(bridge, "status", {
    value() {
      let readable = false;
      try {
        readable = Boolean(client?.queue().ok);
      } catch {}
      return {
        version: "0.1.0-prototype",
        captured,
        queueReadable: readable,
        failed,
        liveVerified: false,
        commandBridgeInstalled: Boolean(connection),
        connected: connection?.status().paired || false,
      };
    },
  });
  Object.defineProperty(root, "__ravelinkSpotify", {
    value: Object.freeze(bridge),
    configurable: false,
    enumerable: false,
  });
  return root.__ravelinkSpotify;
};

function startPump(root, connection) {
  let retry,
    pumping = false,
    suspended = false,
    stopped = false;
  function poll() {
    if (stopped || suspended || pumping) return;
    clearTimeout(retry);
    pumping = true;
    void connection.step().finally(() => {
      pumping = false;
      if (stopped || suspended) return;
      const status = connection.status();
      // Core completes a waiting request when it has a command. Successful
      // polls don't wait on a Spotify window's background timer.
      if (status.waitForCommand && !status.lastError) poll();
      else retry = setTimeout(poll, 1000);
    });
  }
  const heartbeat = setInterval(() => {
    if (pumping && !suspended) void connection.step();
  }, 1000);
  root.addEventListener?.("focus", poll);
  root.addEventListener?.("online", poll);
  root.document?.addEventListener?.("visibilitychange", () => {
    if (!root.document.hidden) poll();
  });
  root.addEventListener?.("pagehide", (event) => {
    suspended = true;
    clearTimeout(retry);
    if (event?.persisted) return;
    stopped = true;
    clearInterval(heartbeat);
    connection.close();
  });
  root.addEventListener?.("pageshow", () => {
    suspended = false;
    poll();
  });
  poll();
}

}},cache={};function load(id){if(cache[id])return cache[id].exports;if(!modules[id])throw Error("spotify_bundle_module_missing");const module={exports:{}};cache[id]=module;modules[id](load,module,module.exports);return module.exports;}const config=globalThis.__ravelinkSpotifyConfig;delete globalThis.__ravelinkSpotifyConfig;load("./renderer-bootstrap.cjs")(globalThis,config?{connection:config}:{});})();
