/**
 * Provider.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#desktop-companions
 */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { trackUri } = require("./catalog.cjs");
const {
  confidence,
  derivativeAllowed,
  normalizePolicy,
} = require("../../src/capabilities/feature-platform/providers/youtube-catalog-provider");
module.exports = function createSpotifyProvider(options) {
  const root = path.join(options.runtimeDir, "spotify-desktop");
  fs.mkdirSync(root, { recursive: true });
  const read = (name, fallback) => {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) return fallback;
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 1048576)
      throw Error("spotify_state_invalid");
    const contents = fs.readFileSync(file, "utf8");
    try {
      return JSON.parse(contents);
    } catch {
      throw Error("spotify_state_invalid");
    }
  };
  const write = (name, data) => {
    const file = path.join(root, name),
      temporary = file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temporary, file);
  };
  const pairing = read("pairing.json", {
    token: crypto.randomBytes(32).toString("hex"),
  });
  if (!/^[a-f0-9]{64}$/.test(pairing?.token || "")) throw Error("spotify_pairing_invalid");
  const saved = read("requests.json", []);
  if (
    !Array.isArray(saved) ||
    saved.length > 250 ||
    saved.some(
      (row) =>
        !/^[A-Za-z0-9_-]{1,100}$/.test(row?.entryId || "") ||
        !trackUri(row.uri) ||
        !["pending", "unknown", "appended", "playing", "finished", "failed", "removed"].includes(
          row.phase,
        ),
    )
  )
    throw Error("spotify_state_invalid");
  const receipts = new Map(
    saved.map((row) => [
      row.entryId,
      { ...row, phase: row.phase === "pending" ? "unknown" : row.phase },
    ]),
  );
  const persist = () => {
    for (const [id, row] of receipts) {
      if (receipts.size <= 250) break;
      if (["finished", "failed", "removed"].includes(row.phase)) receipts.delete(id);
    }
    write("requests.json", [...receipts.values()]);
  };
  let snapshot = null,
    observedAt = 0,
    serial = Promise.resolve(),
    installation = read("installation.json", null),
    launchWork = null,
    launchDeadline = 0,
    launchError = "";
  if (!fs.existsSync(path.join(root, "pairing.json"))) write("pairing.json", pairing);
  const now = options.now || Date.now;
  let verifyInstallation;
  const installed = () => {
    if (!installation?.id) return { prepared: false };
    verifyInstallation ||=
      options.verifyInstallation ||
      require("./sidecar.cjs").createVerifier(root, installation.id, {
        connection: {
          coreUrl: installation.coreUrl,
          token: pairing.token,
          catalog: installation.catalog,
        },
      });
    const result = verifyInstallation();
    return result.ok
      ? { prepared: true, id: installation.id }
      : { prepared: false, error: result.error || "spotify_setup_required" };
  };
  function launchState(connected) {
    if (connected) {
      launchDeadline = 0;
      launchError = "";
    } else if (launchDeadline && now() >= launchDeadline) {
      launchDeadline = 0;
      launchError = "spotify_connection_timeout";
    }
    return !connected && Boolean(launchWork || launchDeadline);
  }
  const ordered = (action) => {
    const operation = serial.then(action);
    serial = operation.catch(() => {});
    return operation;
  };
  const bridge = require("./host-bridge.cjs")({
    token: pairing.token,
    onSnapshot: observe,
  });
  // These command IDs are created by this provider for a single operation.
  // Request replay is governed by the durable entry receipt above.
  const invokeOnce = (kind, payload, id = crypto.randomUUID()) =>
    bridge.invoke(kind, payload, id, { oneShot: true });
  const onDevice = (row, state) =>
    state?.localDevice && (!row.deviceId || row.deviceId === state.deviceId);
  const matchesOccurrence = (row, item) => row.uid && row.uid === item?.uid && row.uri === item.uri;
  function observe(next) {
    snapshot = next;
    observedAt = Date.now();
    let changed = false;
    for (const row of receipts.values()) {
      if (
        !onDevice(row, next) ||
        !row.uid ||
        !["appended", "playing", "pending", "unknown"].includes(row.phase)
      )
        continue;
      const phase = matchesOccurrence(row, next.current)
        ? "playing"
        : next.queue.some((item) => matchesOccurrence(row, item))
          ? "appended"
          : next.complete &&
              observedAt > (row.confirmedAt || 0) &&
              (!next.current || next.current.uid) &&
              ["appended", "playing"].includes(row.phase)
            ? "finished"
            : row.phase;
      if (phase !== row.phase) {
        row.phase = phase;
        changed = true;
      }
    }
    if (changed) persist();
    options.onSnapshot?.(next);
    options.onQueueChanged?.();
  }
  function status() {
    const connection = bridge.status(),
      fresh = connection.connected && Date.now() - observedAt < 6000;
    const launching = launchState(connection.connected);
    const currentOwner = [...receipts.values()].find(
      (row) =>
        ["appended", "playing", "pending", "unknown"].includes(row.phase) &&
        onDevice(row, snapshot) &&
        matchesOccurrence(row, snapshot.current),
    );
    const reviewOnly = new Set();
    const queueUris = new Set(fresh ? snapshot.queue.map((item) => item.uri) : []);
    if (fresh && snapshot.complete)
      for (const row of receipts.values())
        if (
          row.phase === "unknown" &&
          onDevice(row, snapshot) &&
          Date.now() - (row.createdAt || 0) >= 10000 &&
          !queueUris.has(row.uri) &&
          snapshot.current?.uri !== row.uri
        )
          reviewOnly.add(row.entryId);
    const active = [...receipts.values()].filter(
      (row) =>
        !reviewOnly.has(row.entryId) && ["pending", "unknown", "appended"].includes(row.phase),
    );
    const queueOrder = fresh
      ? snapshot.queue
          .map(
            (item) =>
              active.find((row) => onDevice(row, snapshot) && matchesOccurrence(row, item))
                ?.entryId,
          )
          .filter(Boolean)
      : [];
    return {
      ok: true,
      enabled: true,
      launching,
      launchError: connection.connected ? "" : launchError,
      lastError: connection.lastError,
      lastSeenAt: connection.lastSeenAt,
      connected: connection.connected,
      ready: Boolean(fresh && snapshot?.localDevice && snapshot.complete),
      deviceId: fresh ? snapshot?.deviceId || "" : "",
      localDevice: fresh && snapshot?.localDevice === true,
      controlsAvailable: Boolean(fresh && snapshot?.localDevice),
      volumeAvailable: Boolean(
        fresh && snapshot?.localDevice && snapshot.volumeAvailable !== false,
      ),
      capacity: {
        limit: 10,
        queued: active.length,
        available: Math.max(0, 10 - active.length),
        reported: Boolean(fresh && snapshot?.complete),
      },
      current:
        fresh && snapshot.current
          ? {
              ...snapshot.current,
              trackId: snapshot.current.uri.slice(14),
              ...(currentOwner || {}),
            }
          : null,
      handoffs: [...receipts.values()]
        .filter(
          (row, index) =>
            index >= receipts.size - 50 || !["finished", "removed"].includes(row.phase),
        )
        .map((row) => ({
          ...row,
          ...(reviewOnly.has(row.entryId) ? { reviewOnly: true } : {}),
          possibleMatches:
            row.phase === "unknown" &&
            fresh &&
            snapshot.localDevice &&
            (!row.deviceId || row.deviceId === snapshot.deviceId)
              ? [...snapshot.queue, ...(snapshot.current ? [snapshot.current] : [])]
                  .filter((item) => item.uid && item.uri === row.uri)
                  .map((item) => ({ uid: item.uid }))
              : [],
        })),
      queueOrder,
      queueTimingComplete: Boolean(
        fresh && snapshot.complete && snapshot.queue.length === queueOrder.length,
      ),
      installation: installed(),
    };
  }
  async function setup(payload) {
    if (payload.action === "status")
      return {
        ok: true,
        ...status().installation,
        available: (options.discover || require("./discovery.cjs"))().length > 0,
      };
    if (payload.action === "prepare") {
      const location = (options.discover || require("./discovery.cjs"))()[0];
      if (!location) return { ok: false, error: "spotify_not_installed" };
      const connection = { coreUrl: payload.coreUrl, token: pairing.token };
      const plan = await require("./installer.cjs").plan(location.appsPath, {
        allowProtectedRead: true,
        connection,
      });
      installation = await require("./sidecar.cjs").stage(location.appsPath, root, {
        allowUnverifiedBuild: true,
        connection,
        expectedArchiveHash: plan.archiveHash,
        expectedSnapshotHash: plan.snapshotHash,
      });
      installation.coreUrl = connection.coreUrl;
      installation.catalog = plan.catalog;
      write("installation.json", {
        id: installation.id,
        coreUrl: connection.coreUrl,
        catalog: plan.catalog,
      });
      verifyInstallation = null;
      return { ok: true, prepared: true };
    }
    if (payload.action === "launch") {
      const checked = installed();
      if (!checked.prepared) return { ok: false, error: checked.error || "spotify_setup_required" };
      if (bridge.status().connected) return { ok: true, connected: true };
      if (!launchState(false)) {
        launchError = "";
        launchDeadline = now() + 45000;
        // Starting a desktop process is independent of the feature RPC lifetime.
        // Report acceptance now; the paired bridge confirms the connection.
        launchWork = Promise.resolve()
          .then(() => (options.launch || require("./launcher.cjs"))(root, installation.id))
          .then((result) => {
            if (!result.ok) {
              launchError = result.error || "spotify_launch_failed";
              launchDeadline = 0;
            }
          })
          .catch((error) => {
            launchDeadline = 0;
            launchError = /^spotify_[a-z_]+$/.test(error.message)
              ? error.message
              : "spotify_launch_failed";
          })
          .finally(() => {
            launchWork = null;
          });
      }
      return { ok: true, launching: true };
    }
    return { ok: false, error: "spotify_setup_action_invalid" };
  }
  async function resolve(payload) {
    const query = String(payload.query || "").trim();
    if (!query || query.length > 300) return { ok: false, error: "spotify_search_query_invalid" };
    const uri = trackUri(query);
    const result = await bridge.invoke(
      uri ? "lookup" : "search",
      uri ? { uri } : { query },
      crypto.randomUUID(),
    );
    if (!result.ok) return result;
    const policy = normalizePolicy(payload.policy || {});
    const candidates = result.candidates
      .filter(
        (row) =>
          (!policy.maxDurationMs || row.durationMs <= policy.maxDurationMs) &&
          derivativeAllowed(query, row.title, policy).ok,
      )
      .map((row) => ({
        ...row,
        confidence: uri ? 1 : confidence(query, [...row.artists, row.title].join(" "), 0),
      }))
      .sort((a, b) => b.confidence - a.confidence);
    const candidate = candidates[0];
    return candidate && candidate.confidence >= (policy.minimumConfidence || 0.45)
      ? { ok: true, candidate }
      : { ok: false, error: "spotify_match_not_found" };
  }
  function enqueue(payload) {
    return ordered(async () => {
      const old = receipts.get(payload.entryId);
      if (old)
        return old.phase === "appended" || old.phase === "playing" || old.phase === "finished"
          ? { ok: true, appended: true, uid: old.uid }
          : { ok: false, error: "spotify_delivery_needs_review" };
      const uri = trackUri(payload.candidate?.providerItemId);
      if (!uri || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.entryId || ""))
        return { ok: false, error: "spotify_track_invalid" };
      const state = status();
      if (!state.ready) return { ok: false, error: "spotify_local_device_unverified" };
      if (state.capacity.available < 1) return { ok: false, error: "spotify_native_queue_full" };
      if (
        receipts.size >= 250 &&
        ![...receipts.values()].some((row) => ["finished", "failed", "removed"].includes(row.phase))
      )
        return { ok: false, error: "spotify_history_full" };
      const row = {
        entryId: payload.entryId,
        createdAt: Date.now(),
        uri,
        deviceId: state.deviceId,
        uid: crypto.randomBytes(16).toString("hex"),
        commandId: crypto.randomUUID(),
        trackId: uri.slice(14),
        candidate: payload.candidate,
        requesterKey: String(payload.requesterKey || "").slice(0, 80),
        requesterLabel: String(payload.requesterLabel || "").slice(0, 100),
        requesterRole: payload.requesterRole,
        phase: "pending",
      };
      receipts.set(row.entryId, row);
      try {
        persist();
      } catch (error) {
        receipts.delete(row.entryId);
        throw error;
      }
      const result = await invokeOnce("append", { uri, uid: row.uid }, row.commandId);
      if (["appended", "playing", "finished"].includes(row.phase))
        return { ok: true, appended: true, uid: row.uid };
      if (result.safeToRetry === true) {
        receipts.delete(row.entryId);
        persist();
        return result;
      }
      row.phase = result.ok
        ? "appended"
        : result.error === "spotify_delivery_unconfirmed"
          ? "unknown"
          : "failed";
      row.lastError = result.error || "";
      if (result.ok) {
        row.uid = result.uid;
        row.confirmedAt = Date.now();
      }
      persist();
      return result.ok ? { ...result, appended: true } : result;
    });
  }
  function remove(payload) {
    return ordered(async () => {
      const matches = [...receipts.values()].filter(
        (row) =>
          ["pending", "unknown", "appended", "playing"].includes(row.phase) &&
          (payload.entryId
            ? row.entryId === payload.entryId
            : payload.trackId
              ? row.trackId === payload.trackId
              : payload.requesterKey && row.requesterKey === payload.requesterKey),
      );
      let removed = 0,
        error = "";
      for (const row of matches) {
        const state = status();
        if (["pending", "unknown"].includes(row.phase)) {
          error = "spotify_delivery_needs_review";
          continue;
        }
        if (!state.localDevice || (row.deviceId && row.deviceId !== state.deviceId))
          return { ok: false, removed, error: "spotify_local_device_unverified" };
        const current = state.current;
        if (payload.queuedOnly && (row.phase === "playing" || matchesOccurrence(row, current)))
          return { ok: false, removed, error: "request_already_playing" };
        const result =
          current?.uid === row.uid
            ? await invokeOnce("control", { action: "skip", currentUid: row.uid })
            : await invokeOnce("remove", { uri: row.uri, uid: row.uid });
        if (!result.ok) return { ...result, removed };
        row.phase = "removed";
        removed++;
        persist();
      }
      if (payload.currentUid && !matches.some((row) => row.uid === payload.currentUid)) {
        if (status().current?.uid !== payload.currentUid)
          return { ok: false, error: "spotify_current_changed" };
        const result = await invokeOnce("control", {
          action: "skip",
          currentUid: payload.currentUid,
        });
        if (!result.ok) return result;
        removed++;
      }
      return error ? { ok: false, removed, error } : { ok: true, removed };
    });
  }
  function review(payload) {
    const row = receipts.get(payload.entryId);
    if (
      !row ||
      !["unknown", "failed"].includes(row.phase) ||
      !status().ready ||
      (row.deviceId && row.deviceId !== snapshot.deviceId) ||
      Date.now() - (row.createdAt || 0) < 10000
    )
      return { ok: false, error: "spotify_review_unavailable" };
    const matches = [...snapshot.queue, ...(snapshot.current ? [snapshot.current] : [])].filter(
      (item) => item.uri === row.uri,
    );
    if (payload.decision === "adopt") {
      const selected = matches.find((item) => item.uid === payload.uid);
      if (
        !selected ||
        [...receipts.values()].some(
          (other) =>
            other !== row &&
            other.uid === selected.uid &&
            ["pending", "unknown", "appended", "playing"].includes(other.phase),
        )
      )
        return { ok: false, error: "spotify_current_changed" };
      row.uid = selected.uid;
      row.deviceId = snapshot.deviceId || "";
      row.phase = snapshot.current?.uid === selected.uid ? "playing" : "appended";
      row.lastError = "";
      row.confirmedAt = Date.now();
    } else if (payload.decision === "absent" && !matches.length) receipts.delete(row.entryId);
    else return { ok: false, error: "spotify_review_unavailable" };
    persist();
    return { ok: true };
  }
  async function handle(method, payload = {}) {
    try {
      if (method === "status") return status();
      if (method === "setup") return await setup(payload);
      if (method === "playlist")
        return bridge.invoke(
          "playlist",
          payload,
          ["create", "append"].includes(payload.action) ? payload.key : crypto.randomUUID(),
        );
      if (method === "resolve") return await resolve(payload);
      if (method === "enqueue") return await enqueue(payload);
      if (method === "remove") return await remove(payload);
      if (method === "control") return invokeOnce("control", payload);
      if (method === "review") return await ordered(() => review(payload));
      return { ok: false, error: "spotify_method_invalid" };
    } catch (error) {
      return {
        ok: false,
        error: /^spotify_[a-z_]+$/.test(error.message) ? error.message : "spotify_operation_failed",
      };
    }
  }
  return { handle, status, router: bridge.router, close: bridge.close };
};
