/** One lazy data cache for every OBS/editor client; reuses existing provider owners. */
const model = require("../../../public/core/overlay-model");
const rules = require("../../../public/core/overlay-game-rules");
const { randomUUID } = require("node:crypto");
const mediaStatus = require("../control-deck/deck-media-status");
const EVENT_SCOPES = {
  "channel.follow": "moderator:read:followers",
  "channel.subscribe": "channel:read:subscriptions",
  "channel.subscription.message": "channel:read:subscriptions",
  "channel.subscription.end": "channel:read:subscriptions",
  "channel.subscription.gift": "channel:read:subscriptions",
  "channel.cheer": "bits:read",
  "channel.charity_campaign.donate": "channel:read:charity",
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
    goals = require("./overlay-goals")({
      runtimeDir,
      now,
      changed: () => {
        after = twitchAfter = 0;
        refreshSubscriptions();
      },
    }),
    activity = require("./overlay-events")(now),
    redemptions = require("./overlay-redemptions")(now),
    games = require("./overlay-games")({
      runtimeDir,
      documents: store.gameDocuments,
      now,
    }),
    gameChat = require("./overlay-game-chat")({
      runtimeDir,
      documents: store.gameDocuments,
      games,
      now,
      changed: () => refreshSubscriptions(),
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
    return {
      provider,
      connected: status.connected === true,
      scopes: status.scopes || [],
      owner: status.userId || "",
    };
  }
  function types() {
    return new Set(
      widgets()
        .filter((row) => row.visible)
        .map((row) => row.type),
    );
  }
  function events(owner = getProvider()?.status()?.userId || "") {
    const wanted = new Set(goals.events(owner));
    if (gameChat.interested(owner)) wanted.add("channel.chat.message");
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
  function presentationScope(id) {
    const visible = store.widgets(id)?.filter(model.usesLiveData);
    if (!visible?.length) return null;
    if (visible.some((w) => w.type === "custom")) return {};
    return {
      types: new Set(visible.map((w) => w.type)),
      eventTypes: new Set(
        visible.filter((w) => ["alerts", "activity"].includes(w.type)).flatMap((w) => w.events),
      ),
      recordKeys: visible
        .filter((w) => ["goal", "leaderboard", "player-card", "counter"].includes(w.type))
        .map(model.recordKey),
      documentId: id,
    };
  }
  function catalog() {
    const status = auth(),
      music = active("song-request");
    return model.definitions.map((row) => {
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
      const needsTwitch =
        ["Labels", "Records", "Alerts", "Twitch"].includes(row.group) || row.type === "chat-vote";
      const requirement =
        row.group === "Music" && !music
          ? "Enable Song Request in Updates & packages for live data."
          : needsTwitch && !status.provider
            ? "Enable Twitch Integration in Updates & packages for live data."
            : needsTwitch && !status.connected
              ? "Connect Twitch to receive live data."
              : scope && !status.scopes.includes(scope)
                ? "Grant this feature in Twitch Connection."
                : "";
      return { ...row, available: !requirement, requirement };
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
            (w) =>
              w.visible &&
              (["leaderboard", "player-card", "counter"].includes(w.type) ||
                (w.type === "goal" && w.goalSource === "counter")),
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
          const requestedAt = now();
          try {
            const value = await fn();
            if (generation === key)
              twitch[name] =
                name === "prediction"
                  ? { ...value, at: now() }
                  : ["creatorGoals", "charity"].includes(name)
                    ? { ...value, requestedAt }
                    : value;
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
        const goalTypes = new Set(
          Object.values(goals.snapshot(status.provider.status().userId)).map((g) => g.tracking),
        );
        if (
          [...goalTypes].some((type) => type.startsWith("creator-")) &&
          status.scopes.includes("channel:read:goals") &&
          status.provider.overlayCreatorGoals
        )
          jobs.push(read("creatorGoals", () => status.provider.overlayCreatorGoals()));
        if (
          goalTypes.has("charity-total") &&
          status.scopes.includes("channel:read:charity") &&
          status.provider.overlayCharity
        )
          jobs.push(read("charity", () => status.provider.overlayCharity()));
        if (
          ["title", "category", "viewers", "uptime"].some((type) => wanted.has(type)) ||
          ["viewers", "uptime"].some((type) => goalTypes.has(type))
        )
          jobs.push(read("stream", () => status.provider.dashboardStream()));
        if (
          (["followers", "latest-follower"].some((type) => wanted.has(type)) ||
            goalTypes.has("follower-total")) &&
          status.scopes.includes("moderator:read:followers")
        )
          jobs.push(read("followers", () => status.provider.dashboardFollowers()));
        if (
          (["subscribers", "sub-points"].some((type) => wanted.has(type)) ||
            ["subscriber-total", "subscription-points"].some((type) => goalTypes.has(type))) &&
          status.scopes.includes("channel:read:subscriptions")
        )
          jobs.push(read("subscribers", () => status.provider.dashboardSubscribers()));
      }
      await Promise.all(jobs);
      if (status.connected) goals.update(status.provider.status().userId, twitch);
    })().finally(() => {
      flight = null;
    });
    return flight;
  }
  return {
    store,
    goals,
    catalog,
    gameChatStatus() {
      const status = auth();
      return gameChat.status(
        status.connected && status.scopes.includes("user:read:chat")
          ? status.provider.status().userId
          : "",
      );
    },
    gameChatConfigure(input) {
      const status = auth();
      return gameChat.configure(
        input,
        status.connected && status.scopes.includes("user:read:chat")
          ? status.provider.status().userId
          : "",
      );
    },
    gameChatHandle(event, provider) {
      return gameChat.handle(event, provider);
    },
    goalControl(input) {
      const tx = goals.transaction(getProvider()?.status()?.userId);
      const message = input.operation === "reset" ? tx.reset(input.name) : tx.create(input);
      tx.commit();
      return { message, goals: goals.snapshot(getProvider()?.status()?.userId) };
    },
    events,
    receive(type, event, metadata) {
      if (auth().connected) {
        goals.receive(getProvider().status().userId, type, event, metadata);
        if (activity.receive(type, event, metadata)) chatFeed.changed();
        credits.receive(type, event);
        redemptions.receive(type, event);
        if (type === "channel.chat.message")
          games.receive(
            event,
            metadata,
            getProvider().status().userId,
            gameChat.allowsParticipation,
          );
      }
    },
    subscribeChat(client) {
      auth();
      return chatFeed.subscribe(client);
    },
    async presentation(id, knownRevision) {
      const revision = store.revision(),
        scope = presentationScope(id),
        document = knownRevision === String(revision) ? undefined : store.get(id);
      return { revision, document, data: scope ? await this.data({ fast: true, ...scope }) : null };
    },
    async data({ fast = false, types, eventTypes, recordKeys, documentId } = {}) {
      if (fast) void refresh().catch(() => {});
      else await refresh();
      const status = auth();
      const uses = (...values) => !types || values.some((type) => types.has(type));
      const activitySnapshot = activity.snapshot(eventTypes);
      const chat = uses("chat") ? chatFeed.frame() : { rows: [], version: 0 };
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
        music: uses("now-playing", "queue") ? song : undefined,
        records: structuredClone(
          recordKeys
            ? Object.fromEntries(
                recordKeys
                  .filter((key) => Object.hasOwn(records, key))
                  .map((key) => [key, records[key]]),
              )
            : records,
        ),
        goals: status.connected && uses("goal") ? goals.snapshot(status.owner) : {},
        soundboard: uses("soundboard") ? structuredClone(soundboard) : undefined,
        gameStorageError: games.error(),
        goalStorageError: goals.error(),
        games: games.snapshot(status.owner, documentId),
        redemptions:
          status.connected && uses("redemptions") ? redemptions.snapshot() : { entries: [] },
        twitch: uses(
          "title",
          "category",
          "viewers",
          "uptime",
          "followers",
          "latest-follower",
          "subscribers",
          "sub-points",
          "prediction",
          "credits",
        )
          ? structuredClone(twitch)
          : undefined,
        ...activitySnapshot,
        events: [...activitySnapshot.events, ...chat.rows].sort((a, b) => a.at - b.at),
        chatVersion: chat.version,
        at: now(),
      };
    },
    save(input) {
      const owner = getProvider()?.status()?.userId;
      const previous = store.get(input.document?.id || input.id);
      const draft = input.document;
      let goalTransaction;
      if (owner && draft?.widgets?.some((w) => w.type === "goal" && w.goalSource === "events")) {
        const transaction = (goalTransaction = goals.transaction(owner));
        for (const w of draft.widgets.filter(
          (w) => w.type === "goal" && w.goalSource === "events",
        )) {
          const prior = previous?.widgets.find((r) => r.id === w.id);
          if (
            !goals.snapshot(owner)[w.goalName] ||
            !prior ||
            ["goalName", "goalTracking", "target", "goalCurrency", "endsAt"].some(
              (k) => prior[k] !== w[k],
            )
          )
            transaction.create({
              name: w.goalName,
              tracking: w.goalTracking,
              target: w.target,
              currency: w.goalCurrency,
              endsAt: w.endsAt,
            });
        }
        model.document(draft);
      }
      const result = store.save(input);
      goalTransaction?.commit();
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
        throw Error("The overlay layout changed. Reload it before changing the game.");
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
      return input.returnBingo === true && rules.boardTypes.includes(w?.type)
        ? { ...result, ...this.bingoDeck(input) }
        : result;
    },
    bingoDeck({ documentId, widgetId, availableOnly } = {}) {
      if (availableOnly === "1")
        return {
          available: store
            .gameDocuments()
            .some((doc) => doc.widgets.some((w) => w.visible && rules.boardTypes.includes(w.type))),
        };
      const options = store.gameDocuments().flatMap((doc) =>
        doc.widgets
          .filter((w) => w.visible && rules.boardTypes.includes(w.type))
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
              ...games.board(chosen.doc, chosen.widget),
              width: chosen.widget.width,
              height: chosen.widget.height,
              image: chosen.widget.boardImage,
              imageFit: chosen.widget.boardImageFit,
              cellImageFit: chosen.widget.cellImageFit,
              markMode: chosen.widget.markMode,
              markSymbol: chosen.widget.markSymbol,
              markSymbolColor: chosen.widget.markSymbolColor,
              markColor: chosen.widget.markColor,
              markOpacity: chosen.widget.markOpacity,
              matchBack: chosen.widget.matchBack,
              matchBackColor: chosen.widget.matchBackColor,
              showLabels: chosen.widget.showCellLabels,
              showBorders: chosen.widget.showCellBorders,
              hideCompletedTiles: chosen.widget.hideCompletedTiles,
              conditions: rules.conditions(chosen.widget),
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
      goals.close();
      previews.close();
      chatFeed.close();
      chatAssets.reset("");
      games.close();
    },
  };
};
