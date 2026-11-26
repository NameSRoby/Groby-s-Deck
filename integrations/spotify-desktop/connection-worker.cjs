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
