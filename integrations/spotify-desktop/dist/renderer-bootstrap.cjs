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
