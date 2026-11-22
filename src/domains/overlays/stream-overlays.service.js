/** One lazy data cache for every OBS/editor client; reuses existing provider owners. */
const model = require("../../../public/core/overlay-model");
const { randomUUID } = require("node:crypto");
const mediaStatus = require("../control-deck/deck-media-status");
const EVENT_SCOPES = {
  "channel.follow": "moderator:read:followers",
  "channel.subscribe": "channel:read:subscriptions",
  "channel.subscription.message": "channel:read:subscriptions",
  "channel.subscription.end": "channel:read:subscriptions",
  "channel.subscription.gift": "channel:read:subscriptions",
  "channel.cheer": "bits:read",
};
const CHAT_EVENTS = [
  "channel.chat.message_delete",
  "channel.chat.clear_user_messages",
  "channel.chat.clear",
];
module.exports = function streamOverlays({
  runtimeDir,
  getProvider = () => null,
  getRegistry = () => null,
  getRecords = () => ({}),
  getSoundboard = async () => ({ playing: [] }),
  now = Date.now,
  fetchChatCatalog = globalThis.fetch,
}) {
  const store = require("./overlay-store")(runtimeDir),
    activity = require("./overlay-events")(now),
    redemptions = require("./overlay-redemptions")(now),
    games = require("./overlay-games")({
      runtimeDir,
      documents: () => store.gameDocuments(),
      now,
    }),
    credits = require("./overlay-credits")(runtimeDir, now),
    previews = require("./overlay-preview-sessions")({
      now,
      changed: () => {
        after = twitchAfter = 0;
        refreshSubscriptions();
      },
    });
  let session = randomUUID(),
    key = "",
    after = 0,
    flight,
    twitchAfter = 0,
    twitch = {},
    song = null,
    records = {},
    soundboard = [],
    subscriptions = "";
  const chatAssets = require("./overlay-chat-assets")({
    now,
    fetch: fetchChatCatalog,
    changed: () => chatFeed.changed(),
  });
  const chatFeed = require("./overlay-chat-feed")({
    snapshot: () => ({ session, rows: activity.chatRows().map(chatAssets.decorate) }),
  });
  const widgets = () => [...store.widgets(), ...previews.widgets()];
  const active = (id) =>
    getRegistry()
      ?.list()
      .features.some((row) => row.id === id && row.lifecycle === "active");
  function auth() {
    const provider = getProvider(),
      status = provider?.status() || {};
    const nextKey = JSON.stringify([status.connected, status.userId, status.scopes]);
    if (nextKey !== key) {
      key = nextKey;
      session = randomUUID();
      after = twitchAfter = 0;
      twitch = {};
      activity.reset(key);
      chatAssets.reset(status.userId || "");
      chatFeed.changed();
      credits.reset(status.userId || "");
      redemptions.reset(status.userId || "");
      records = {};
    }
    return { provider, connected: status.connected === true, scopes: status.scopes || [] };
  }
  function types() {
    return new Set(
      widgets()
        .filter((row) => row.visible)
        .map((row) => row.type),
    );
  }
  function events() {
    const wanted = new Set();
    for (const row of widgets().filter((w) => w.visible)) {
      if (row.type === "credits" && row.creditsSource !== "manual") {
        if (row.creditsSource === "followers") wanted.add("channel.follow");
        if (row.creditsSource === "subscribers") {
          wanted.add("channel.subscribe");
          wanted.add("channel.subscription.message");
          wanted.add("channel.subscription.end");
        }
      }
      if (["alerts", "activity"].includes(row.type)) row.events.forEach((type) => wanted.add(type));
      if (row.type === "prediction")
        ["begin", "progress", "lock", "end"].forEach((suffix) =>
          wanted.add("channel.prediction." + suffix),
        );
      if (row.type === "redemptions")
        wanted.add("channel.channel_points_custom_reward_redemption.update");
      if (
        ["chat", "chat-vote"].includes(row.type) ||
        (row.type === "wheel" && row.entrySource === "chat")
      )
        ["channel.chat.message", ...CHAT_EVENTS].forEach((type) => wanted.add(type));
      if (row.type === "poll")
        ["begin", "progress", "end"].forEach((suffix) => wanted.add("channel.poll." + suffix));
      if (row.type === "hype-train")
        ["begin", "progress", "end"].forEach((suffix) =>
          wanted.add("channel.hype_train." + suffix),
        );
    }
    return [...wanted];
  }
  function refreshSubscriptions() {
    const wanted = events().sort().join(",");
    if (wanted === subscriptions) return;
    subscriptions = wanted;
    getProvider()?.refreshSubscriptions?.();
  }
  function catalog() {
    const status = auth(),
      music = active("song-request");
    return model.definitions
      .filter((row) =>
        row.group === "Music"
          ? music
          : row.group === "Records" || row.type === "chat-vote"
            ? !!status.provider
            : ["Static", "Custom", "Tools", "Games"].includes(row.group) || !!status.provider,
      )
      .map((row) => {
        const scope = {
          followers: "moderator:read:followers",
          "latest-follower": "moderator:read:followers",
          subscribers: "channel:read:subscriptions",
          "sub-points": "channel:read:subscriptions",
          chat: "user:read:chat",
          poll: "channel:read:polls",
          prediction: "channel:read:predictions",
          redemptions: "channel:manage:redemptions",
          "chat-vote": "user:read:chat",
          "hype-train": "channel:read:hype_train",
        }[row.type];
        return {
          ...row,
          available:
            row.group === "Records"
              ? status.connected
              : !scope || (status.connected && status.scopes.includes(scope)),
          requirement:
            scope && !status.scopes.includes(scope)
              ? "Grant this feature in Twitch Connection."
              : !status.connected &&
                  !["Static", "Custom", "Tools", "Music", "Games"].includes(row.group)
                ? "Connect Twitch to receive live data."
                : "",
        };
      });
  }
  async function refresh() {
    const status = auth();
    if (flight) return flight;
    if (now() < after) return;
    after = now() + 2000;
    chatAssets.refresh(status, widgets());
    flight = (async () => {
      const generation = key,
        wanted = types(),
        jobs = [];
      if (status.connected) {
        try {
          const requested = widgets().filter(
            (w) => w.visible && ["leaderboard", "player-card", "counter"].includes(w.type),
          );
          records = requested.length ? getRecords(requested) : {};
        } catch {
          records = {};
        }
        if (wanted.has("redemptions") && status.scopes.includes("channel:manage:redemptions"))
          jobs.push(redemptions.refresh(status.provider).catch(() => {}));
      } else records = {};
      if (wanted.has("soundboard"))
        jobs.push(
          (async () => {
            try {
              soundboard = await getSoundboard();
            } catch {
              soundboard = [];
            }
          })(),
        );
      if (active("song-request") && ["now-playing", "queue"].some((type) => wanted.has(type))) {
        jobs.push(
          (async () => {
            const limit = Math.max(
                1,
                ...widgets()
                  .filter((w) => w.visible && w.type === "queue")
                  .map((w) => w.maxItems),
              ),
              registry = getRegistry(),
              [queue, playback] = await Promise.all([
                registry.request(
                  "song-request",
                  "song.queue.read.v1",
                  "status",
                  { limit: Math.min(20, limit + 1), playlistLimit: 1, moderationLimit: 1 },
                  { timeoutMs: 2000 },
                ),
                registry.request("song-request", "song.playback.read.v1", "status", null, {
                  timeoutMs: 2000,
                }),
              ]);
            song =
              queue.ok && playback.ok
                ? mediaStatus({ queue: queue.value, playback: playback.value }, { limit })
                : null;
          })().catch(() => {
            song = null;
          }),
        );
      } else song = null;
      if (status.connected && wanted.has("credits"))
        jobs.push(
          (async () => {
            const value = await credits.data(status, widgets());
            if (generation === key) twitch.credits = value;
          })(),
        );
      if (status.connected && now() >= twitchAfter) {
        twitchAfter = now() + 30000;
        const read = async (name, fn) => {
          try {
            const value = await fn();
            if (generation === key)
              twitch[name] = name === "prediction" ? { ...value, at: now() } : value;
          } catch {
            if (generation === key) twitch[name] = { ok: false };
          }
        };
        if (
          wanted.has("prediction") &&
          status.scopes.includes("channel:read:predictions") &&
          status.provider.overlayPrediction
        )
          jobs.push(read("prediction", () => status.provider.overlayPrediction()));
        if (["title", "category", "viewers", "uptime"].some((type) => wanted.has(type)))
          jobs.push(read("stream", () => status.provider.dashboardStream()));
        if (
          ["followers", "latest-follower"].some((type) => wanted.has(type)) &&
          status.scopes.includes("moderator:read:followers")
        )
          jobs.push(read("followers", () => status.provider.dashboardFollowers()));
        if (
          ["subscribers", "sub-points"].some((type) => wanted.has(type)) &&
          status.scopes.includes("channel:read:subscriptions")
        )
          jobs.push(read("subscribers", () => status.provider.dashboardSubscribers()));
      }
      await Promise.all(jobs);
    })().finally(() => {
      flight = null;
    });
    return flight;
  }
  return {
    store,
    catalog,
    events,
    receive(type, event, metadata) {
      if (auth().connected) {
        if (activity.receive(type, event, metadata)) chatFeed.changed();
        credits.receive(type, event);
        redemptions.receive(type, event);
        if (type === "channel.chat.message")
          games.receive(event, metadata, getProvider().status().userId);
      }
    },
    subscribeChat(client) {
      auth();
      return chatFeed.subscribe(client);
    },
    async data({ fast = false } = {}) {
      if (fast) void refresh().catch(() => {});
      else await refresh();
      const status = auth();
      const activitySnapshot = activity.snapshot();
      const chat = chatFeed.frame();
      return {
        connected: status.connected,
        ...(fast
          ? {
              previewAccess: {
                chat: status.scopes.includes("user:read:chat"),
                subscribers: status.scopes.includes("channel:read:subscriptions"),
                followers: status.scopes.includes("moderator:read:followers"),
              },
            }
          : {}),
        session,
        music: song,
        records: structuredClone(records),
        soundboard: structuredClone(soundboard),
        gameStorageError: games.error(),
        games: games.snapshot(getProvider()?.status()?.userId || ""),
        redemptions: status.connected ? redemptions.snapshot() : { entries: [] },
        twitch: structuredClone(twitch),
        ...activitySnapshot,
        events: [...activitySnapshot.events, ...chat.rows].sort((a, b) => a.at - b.at),
        chatVersion: chat.version,
        at: now(),
      };
    },
    save(input) {
      const result = store.save(input);
      games.reconcile();
      after = twitchAfter = 0;
      refreshSubscriptions();
      return result;
    },
    remove(input) {
      const result = store.remove(input);
      games.reconcile();
      refreshSubscriptions();
      return result;
    },
    gameControl(input = {}) {
      if (input.revision !== undefined && input.revision !== store.revision())
        throw Error("The overlay layout changed. Review the updated Bingo board and try again.");
      const w = store
        .gameDocuments()
        .find((doc) => doc.id === input.documentId)
        ?.widgets.find((w) => w.id === input.widgetId);
      if (
        (w?.type === "chat-vote" && input.operation === "start") ||
        (w?.entrySource === "chat" && input.operation === "collect")
      ) {
        const status = auth();
        if (!status.connected || !status.scopes.includes("user:read:chat"))
          throw Error(
            "Connect Twitch and grant Read chat commands before opening entries or voting.",
          );
      }
      const result = games.control(
        input.documentId,
        input.widgetId,
        input.operation,
        input,
        getProvider()?.status()?.userId || "",
      );
      return input.returnBingo === true && w?.type === "bingo"
        ? { ...result, ...this.bingoDeck(input) }
        : result;
    },
    bingoDeck({ documentId, widgetId } = {}) {
      const options = store.gameDocuments().flatMap((doc) =>
        doc.widgets
          .filter((w) => w.visible && w.type === "bingo")
          .map((w) => ({
            doc,
            widget: w,
            documentId: doc.id,
            widgetId: w.id,
            label: doc.name + " / " + w.name,
          })),
      );
      const chosen =
        options.find((entry) => entry.documentId === documentId && entry.widgetId === widgetId) ||
        options[0];
      return {
        revision: store.revision(),
        boards: options.map(({ documentId, widgetId, label }) => ({ documentId, widgetId, label })),
        board: chosen
          ? {
              ...games.bingo(chosen.doc, chosen.widget),
              documentId: chosen.documentId,
              widgetId: chosen.widgetId,
            }
          : null,
        error: games.error(),
      };
    },
    actionCatalog: () => require("./overlay-game-actions").catalog(store.gameDocuments()),
    execute(id, input, signal) {
      if (signal?.aborted) throw Error("Action cancelled.");
      return require("./overlay-game-actions").execute(id, input, store.gameDocuments(), (value) =>
        this.gameControl(value),
      );
    },
    eventPermissions: EVENT_SCOPES,
    preview(input = {}) {
      const draft = model.document({ widgets: input.widgets });
      previews.set(input.clientId, draft.widgets);
      return this.data({ fast: input.fast === true });
    },
    endPreview(id) {
      previews.remove(id);
    },
    close() {
      previews.close();
      chatFeed.close();
      chatAssets.reset("");
      games.close();
    },
  };
};
