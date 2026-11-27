/**
 * Playback provider.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#desktop-companions
 */
const fs = require("node:fs"),
  path = require("node:path");
function playbackProvider(options) {
  const root = path.join(options.runtimeDir, "spotify-desktop");
  fs.mkdirSync(root, { recursive: true });
  const settingsPath = path.join(root, "premium-device.json"),
    routesPath = path.join(root, "request-transports.json");
  const read = (file, fallback, maximum) => {
    if (!fs.existsSync(file)) return fallback;
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > maximum)
      throw Error("spotify_state_invalid");
    const contents = fs.readFileSync(file, "utf8");
    try {
      return JSON.parse(contents);
    } catch {
      throw Error("spotify_state_invalid");
    }
  };
  let settings = read(settingsPath, { deviceId: "" }, 4096),
    bindings = read(routesPath, {}, 65536),
    closed = false,
    serial = Promise.resolve();
  if (
    !settings ||
    Array.isArray(settings) ||
    typeof settings.deviceId !== "string" ||
    !/^[A-Za-z0-9_-]{0,120}$/.test(settings.deviceId) ||
    !bindings ||
    Array.isArray(bindings) ||
    typeof bindings !== "object" ||
    Object.keys(bindings).length > 250 ||
    Object.entries(bindings).some(
      ([id, value]) =>
        !/^[A-Za-z0-9_-]{1,100}$/.test(id) || !["desktop", "official"].includes(value),
    )
  )
    throw Error("spotify_state_invalid");
  bindings = Object.assign(Object.create(null), bindings);
  const write = (file, value) => {
    const temporary = file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporary, file);
  };
  const ordered = (action) => {
    const result = serial.then(action);
    serial = result.catch(() => {});
    return result;
  };
  const auth = (options.createAuth || require("./oauth.cjs"))({
    vaultPath: path.join(root, "official-account.vault.json"),
    fetch: options.fetch,
    protect: options.protect,
    unprotect: options.unprotect,
  });
  let premium;
  const desktop = (options.createDesktop || require("./provider.cjs"))({
    ...options,
    onSnapshot: (value) => {
      if (
        !auth.status().connected ||
        !settings.deviceId ||
        (value.localDevice && value.complete && value.deviceId === settings.deviceId)
      )
        options.onSnapshot?.(value);
    },
    onQueueChanged: () => options.onQueueChanged?.(),
  });
  const nativePreferred = (state = desktop.status()) =>
    state.ready &&
    (!auth.status().connected || !settings.deviceId || state.deviceId === settings.deviceId);
  const api =
    options.api ||
    require("./official-adapter.cjs")({
      fetch: options.fetch,
      getAccessToken: auth.authorize,
    });
  premium = (options.createPremium || require("./premium-provider.cjs"))({
    root,
    api,
    auth,
    getDevice: () => settings.deviceId,
    onSnapshot: (value) => {
      if (settings.deviceId && !nativePreferred()) options.onSnapshot?.(value);
    },
    onQueueChanged: () => options.onQueueChanged?.(),
  });
  const active = (row) => ["pending", "unknown", "appended", "playing"].includes(row.phase);
  const rows = () => [
    ...(desktop.status().handoffs || []).map((row) => ({
      ...row,
      transport: "desktop",
      nativeRemoval: true,
    })),
    ...(premium.status().handoffs || []).map((row) => ({
      ...row,
      transport: "official",
      nativeRemoval: false,
    })),
  ];
  const officialActive = () => (premium.status().handoffs || []).some(active);
  const routeFor = (id) => bindings[id] || rows().find((row) => row.entryId === id)?.transport;
  async function status() {
    if (
      auth.status().connected &&
      (!premium.status().historyLoaded || (settings.deviceId && !nativePreferred()))
    )
      await premium.refresh();
    const native = desktop.status(),
      official = premium.status(),
      useNative = nativePreferred(native);
    const selected =
      useNative || !auth.status().connected || !settings.deviceId ? native : official;
    const all = [...new Map(rows().map((row) => [row.entryId, row])).values()],
      count = all.filter((row) => ["pending", "unknown", "appended"].includes(row.phase)).length;
    const matching = Boolean(
      native.deviceId && native.deviceId === settings.deviceId && official.ready,
    );
    let current = selected.current;
    if (
      useNative &&
      matching &&
      current &&
      !current.entryId &&
      official.current?.uri === current.uri &&
      official.current.requesterKey
    )
      current = {
        ...official.current,
        ...current,
        requesterKey: official.current.requesterKey,
        requesterLabel: official.current.requesterLabel,
        requesterRole: official.current.requesterRole,
        candidate: official.current.candidate,
        entryId: official.current.entryId,
      };
    return {
      ...selected,
      current,
      desktop: {
        connected: native.connected,
        ready: native.ready,
        localDevice: native.localDevice,
        launching: native.launching,
        launchError: native.launchError,
        lastError: native.lastError,
      },
      mode:
        useNative && auth.status().connected
          ? "hybrid"
          : selected === official
            ? "official"
            : "desktop",
      account: auth.status(),
      selectedDevice: settings.deviceId,
      sameDevice: matching,
      queueRemoval: useNative,
      volumeAvailable: Boolean(
        (useNative && native.volumeAvailable) ||
        (official.volumeAvailable && (selected === official || matching)),
      ),
      handoffs: all.filter(
        (row, index) => index >= all.length - 50 || !["finished", "removed"].includes(row.phase),
      ),
      capacity: {
        limit: 10,
        queued: count,
        available: Math.max(0, 10 - count),
        reported: selected.capacity?.reported === true,
      },
      installation: native.installation,
      controlsAvailable: selected.controlsAvailable,
      officialControls: Boolean(official.controlsAvailable && (selected === official || matching)),
    };
  }
  async function setup(input) {
    if (["configure", "disconnect"].includes(input.action)) {
      if (auth.status().connected) await premium.refresh();
      if (officialActive()) return { ok: false, error: "spotify_mode_has_requests" };
      const result = auth[input.action](input);
      if (result.ok) {
        settings.deviceId = "";
        write(settingsPath, settings);
        premium.reset();
      }
      return result;
    }
    if (input.action === "begin")
      return officialActive()
        ? { ok: false, error: "spotify_mode_has_requests" }
        : auth.begin(input);
    if (input.action === "devices") return premium.handle("devices");
    if (input.action === "select-device") {
      await status();
      if (input.deviceId !== settings.deviceId && rows().some(active))
        return { ok: false, error: "spotify_mode_has_requests" };
      const result = await premium.handle("devices");
      if (!result.ok) return result;
      if (!result.devices.some((row) => row.id === input.deviceId))
        return { ok: false, error: "spotify_device_selection_required" };
      settings.deviceId = input.deviceId;
      write(settingsPath, settings);
      await premium.refresh(true);
      return { ok: true };
    }
    return desktop.handle("setup", input);
  }
  async function enqueue(payload) {
    if (typeof payload?.entryId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.entryId))
      return { ok: false, error: "spotify_track_invalid" };
    const state = await status(),
      existing = routeFor(payload.entryId);
    if (!existing && (state.capacity.available < 1 || !state.ready))
      return {
        ok: false,
        error:
          state.capacity.available < 1
            ? "spotify_native_queue_full"
            : state.lastError || "spotify_device_selection_required",
      };
    const route = existing || (state.mode === "official" ? "official" : "desktop");
    if (!existing) {
      const live = new Set(
        rows()
          .filter(active)
          .map((row) => row.entryId),
      );
      for (const id of Object.keys(bindings))
        if (Object.keys(bindings).length >= 250 && !live.has(id)) delete bindings[id];
      if (Object.keys(bindings).length >= 250) return { ok: false, error: "spotify_history_full" };
      bindings[payload.entryId] = route;
      write(routesPath, bindings);
    }
    // Once dispatched, an entry stays bound to that transport, including an
    // uncertain result or restart. Never fail over a possibly completed write.
    return (route === "desktop" ? desktop : premium).handle("enqueue", payload);
  }
  async function control(payload) {
    const state = await status();
    if (payload.action === "skip" && payload.currentUid !== state.current?.uid)
      return { ok: false, error: "spotify_current_changed" };
    if (payload.action === "skip" && state.mode !== "official" && state.current?.entryId) {
      if (routeFor(state.current.entryId) === "desktop") return desktop.handle("control", payload);
    }
    const official = premium.status();
    if (
      state.mode === "official" ||
      (state.officialControls && (payload.action !== "volume" || official.volumeAvailable))
    ) {
      if (!state.officialControls)
        return { ok: false, error: state.lastError || "spotify_device_selection_required" };
      if (payload.action === "volume" && !official.volumeAvailable)
        return { ok: false, error: "spotify_volume_unavailable" };
      const current = official.current;
      if (payload.action === "skip" && current?.uri !== state.current?.uri)
        return { ok: false, error: "spotify_current_changed" };
      return premium.handle("control", {
        ...payload,
        ...(payload.action === "skip" ? { currentUid: current.uid } : {}),
      });
    }
    return desktop.handle("control", payload);
  }
  async function remove(payload) {
    const state = await status(),
      matches = rows().filter(
        (row) =>
          active(row) &&
          (payload.entryId
            ? row.entryId === payload.entryId
            : payload.trackId
              ? row.trackId === payload.trackId
              : payload.requesterKey && row.requesterKey === payload.requesterKey),
      );
    if (payload.currentUid && payload.currentUid !== state.current?.uid)
      return { ok: false, error: "spotify_current_changed" };
    let removed = 0,
      error = "";
    for (const route of ["desktop", "official"]) {
      const selected = matches.filter((row) => row.transport === route);
      if (!selected.length) continue;
      const result = await (route === "desktop" ? desktop : premium).handle("remove", {
        ...payload,
        currentUid: undefined,
      });
      removed += result.removed || 0;
      if (!result.ok) error = result.error;
    }
    if (payload.currentUid && !matches.some((row) => row.phase === "playing")) {
      const result = await control({
        action: "skip",
        currentUid: payload.currentUid,
      });
      if (result.ok) removed++;
      else error = result.error;
    }
    return error ? { ok: false, error, removed } : { ok: true, removed };
  }
  const timer = setInterval(() => {
    if (!closed && auth.status().connected) void premium.refresh().catch(() => {});
  }, 5000);
  timer.unref?.();
  async function handle(method, payload = {}) {
    try {
      if (method === "favorite") {
        if (!auth.status().favoritesEnabled)
          return { ok: false, error: "spotify_favorites_sign_in_required" };
        const revision = auth.status().revision;
        return await ordered(() =>
          auth.status().revision === revision
            ? api.favorite(payload.trackId, payload.save)
            : { ok: false, error: "spotify_account_changed" },
        );
      }
      if (method === "status") return await status();
      if (method === "setup") return await ordered(() => setup(payload || {}));
      if (method === "enqueue") return await ordered(() => enqueue(payload));
      if (method === "remove") return await ordered(() => remove(payload));
      if (method === "control") return await ordered(() => control(payload));
      if (method === "resolve" && auth.status().connected) {
        const result = await premium.handle(method, payload);
        if (result.ok || !desktop.status().connected) return result;
      }
      if (method === "review")
        return await ordered(() =>
          (routeFor(payload.entryId) === "official" ? premium : desktop).handle(method, payload),
        );
      return await desktop.handle(method, payload || {});
    } catch (error) {
      return {
        ok: false,
        error: /^spotify_[a-z_]+$/.test(error.message) ? error.message : "spotify_operation_failed",
      };
    }
  }
  return {
    handle,
    router: desktop.router,
    status: () => desktop.status(),
    callback(input, redirectUri) {
      return ordered(async () => {
        if (auth.status().connected) await premium.refresh();
        if (officialActive()) return { ok: false, error: "spotify_mode_has_requests" };
        const result = await auth.callback(input, redirectUri);
        if (result.ok) {
          premium.reset();
          await premium.refresh(true);
        }
        return result;
      });
    },
    close() {
      closed = true;
      clearInterval(timer);
      auth.close();
      desktop.close();
    },
  };
}
module.exports = function createPlaybackProvider(options) {
  try {
    return playbackProvider(options);
  } catch (cause) {
    const error = cause.message;
    if (!["spotify_state_invalid", "spotify_pairing_invalid"].includes(error)) throw cause;
    const result = { ok: false, error };
    const status = () => ({
      ok: true,
      enabled: true,
      connected: false,
      ready: false,
      lastError: error,
      installation: { prepared: false, error },
      capacity: { limit: 10, queued: 0, available: 0, reported: false },
      handoffs: [],
    });
    return {
      status,
      handle: async (method) => (method === "status" ? status() : result),
      router: () => (_req, res) => res.status(503).json(result),
      callback: async () => result,
      close() {},
    };
  }
};
