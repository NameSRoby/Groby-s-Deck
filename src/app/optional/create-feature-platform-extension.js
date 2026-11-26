/**
 * Create feature platform extension.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#startup-and-shutdown
 */
const path = require("node:path");
const { readJsonFile, writeJsonFile } = require("../../shared/fs/json-file-store");
const createFeatureHostRegistry = require("../../capabilities/feature-platform/host/feature-host-registry");
const registerFeaturePlatformRoutes = require("../../capabilities/feature-platform/http/register-feature-platform.routes");
const createWindowsMediaObserver = require("../../capabilities/feature-platform/providers/windows-media-observer");
const createTwitchChatCommandRouter = require("../../capabilities/feature-platform/providers/twitch-chat-command-router");
const {
  TWITCH_PUBLIC_CLIENT_ID,
} = require("../../capabilities/feature-platform/providers/twitch-public-client");
const {
  OFFICIAL_FEATURE_SOURCES,
} = require("../../capabilities/feature-platform/packages/official-feature-sources");

function createFeaturePlatformExtension(options = {}) {
  return function attachFeaturePlatform(context) {
    const rootDir = path.resolve(options.rootDir || context.rootDir);
    let registry;
    let twitchOAuth;
    let twitchFlowActions;
    let youtubeCatalog;
    const youtubeBrowserProvider = require("../../../integrations/youtube-browser/provider.cjs")({
      runtimeDir: context.runtimeDir,
      ...options.youtubeBrowser,
      resolve: (payload) =>
        resolveSongInput("youtube", payload, (input) =>
          youtubeProvider().resolve({ ...input, playbackMode: "browser" }),
        ),
      onQueueChanged: () => {
        registry?.request("song-request", "song.youtube.browser.v1", "flush", {}).catch(() => {});
      },
      onSnapshot: (payload) => {
        registry
          ?.request("song-request", "song.playback.observe.v1", "observe", payload, {
            timeoutMs: 1500,
          })
          .catch(() => {});
      },
    });
    const intakePause = require("../../domains/twitch/intake-pause-policy")(
      path.join(context.runtimeDir, "system", "twitch-intake-pause.json"),
    );
    const chatCommands = createTwitchChatCommandRouter({
      builtinPolicy: (purpose) => automations.builtinPolicy(purpose),
      builtinCommand: (payload) => context.widgetController.handleChatAction(payload),
      reply: (payload) => twitchProvider().sendChat(payload),
      querySongRequest: (payload) =>
        registry.request("song-request", "song.chat.commands.v1", "query", payload, {
          timeoutMs: 15000,
        }),
      submitSongRequest: (payload) =>
        registry.request("song-request", "song.queue.submit.v1", "submit", payload, {
          timeoutMs: 30000,
        }),
      selfManageSongRequest: (payload) =>
        registry.request("song-request", "song.queue.submit.v1", "self", payload, {
          timeoutMs: 20000,
        }),
      moderateSongRequest: (payload) =>
        registry.request("song-request", "song.queue.admin.v1", "moderate", payload, {
          timeoutMs: 20000,
        }),
    });
    function twitchProvider() {
      if (!twitchOAuth) {
        const createTwitchOAuthProvider = require("../../capabilities/feature-platform/providers/twitch-oauth-provider");
        twitchOAuth = createTwitchOAuthProvider({
          vaultPath: path.join(context.runtimeDir, "features", "twitch-integration.vault.json"),
          defaultClientId: TWITCH_PUBLIC_CLIENT_ID,
          onIntakeModeChange: (mode) => context.twitchIntakeGate?.setMode?.(mode),
          getAutomationEvents: (userId) => [
            ...new Set([
              ...automations.events(userId),
              ...(context.streamOverlays?.events(userId) || []),
              ...(automations.events(userId).includes("channel.raid")
                ? ["channel.shoutout.create", "stream.offline"]
                : []),
            ]),
          ],
          onEvent: (...args) => {
            twitchFlowActions?.shoutouts.receive(...args);
            context.streamOverlays?.receive(...args);
            return automations.event(...args);
          },
          onRedemption: async (event, managed) => {
            context.streamOverlays?.receive(
              "channel.channel_points_custom_reward_redemption.add",
              event,
            );
            const result = await automations.redemption(event, managed);
            return result.handled ? result : legacyRedemption(event, managed);
          },
          onChatModeration: (...args) => context.streamOverlays?.receive(...args),
          onChatPresentation: (event, metadata) =>
            context.streamOverlays?.receive("channel.chat.message", event, metadata),
          onChat: async (event, monitorConfig) => {
            if (intakePause.paused(twitchProvider().status().userId, "all"))
              return { handled: true, accepted: false, code: "twitch_intake_paused" };
            const game = await context.streamOverlays?.gameChatHandle?.(event, twitchProvider());
            if (game?.handled) return game;
            const automation = await automations.chat(event);
            if (automation.handled) return automation;
            const handled = await chatCommands.handle(event, monitorConfig);
            const requester = chatCommands.profileFor(event?.chatter_user_id);
            twitchProvider().observeRequesterRole(requester.userId, requester.role);
            return handled?.handled ? handled : twitchClips.handleChat(event);
          },
        });
      }
      return twitchOAuth;
    }
    const twitchClips = require("../../domains/twitch/twitch-clips.service")({
      getProvider: twitchProvider,
      storePath: path.join(context.runtimeDir, "system", "twitch-clips.json"),
    });
    const legacyRedemption =
      require("../../capabilities/feature-platform/providers/twitch-redemption-router")({
        twitchProvider,
        chatCommands,
        widgetController: context.widgetController,
      });
    const automations = require("../../domains/twitch/twitch-automations.service")({
      getGoals: () => context.streamOverlays?.goals,
      file: path.join(context.runtimeDir, "system", "twitch-automations.json"),
      getProvider: twitchProvider,
      deck: {
        catalog: () => context.controlDeck.catalog(),
        runAutomation: (...args) => context.controlDeck.runAutomation(...args),
        cancel: (id) => context.controlDeck.cancel(id),
      },
      legacy: legacyRedemption,
      builtinAvailable: (purpose) =>
        !["song_request", "add_to_playlist"].includes(purpose) ||
        Boolean(
          registry
            ?.list()
            .features.some((row) => row.id === "song-request" && row.lifecycle === "active"),
        ),
      getShoutouts: () => twitchFlowActions?.shoutouts,
      intakePaused: (purpose) => intakePause.paused(twitchProvider().status().userId, purpose),
    });
    twitchFlowActions = require("../../domains/twitch/twitch-flow-actions")({
      getProvider: twitchProvider,
      getAutomations: () => automations,
      isActive: () =>
        !!registry
          ?.list()
          .features.some((row) => row.id === "twitch-integration" && row.lifecycle === "active"),
    });
    function youtubeProvider() {
      if (!youtubeCatalog) {
        const {
          createYoutubeCatalogProvider,
        } = require("../../capabilities/feature-platform/providers/youtube-catalog-provider");
        youtubeCatalog = createYoutubeCatalogProvider({
          vaultPath: path.join(context.runtimeDir, "features", "youtube-catalog.vault.json"),
          egressGovernor: context.egressGovernor,
          defaultMode: "keyless",
        });
      }
      return youtubeCatalog;
    }
    const mediaObserver = createWindowsMediaObserver({
      observerPath: path.join(rootDir, "scripts", "windows-media-observer.ps1"),
      onSnapshot: (payload) => {
        tidalBridge?.observe(payload);
        return registry.request("song-request", "song.playback.observe.v1", "observe", payload, {
          timeoutMs: 1000,
        });
      },
    });
    const featureRuntimeRoot = options.runtimeRoot || path.join(context.runtimeDir, "features");
    const playlistExports =
      require("../../capabilities/feature-platform/providers/playlist-export-provider")({
        root: path.join(context.runtimeDir, "exports", "playlists"),
      });
    let tidalCatalog, soundcloudCatalog;
    const getSoundCloudCatalog = () =>
      soundcloudCatalog ||
      (soundcloudCatalog =
        require("../../capabilities/feature-platform/providers/soundcloud-catalog-provider")({
          fetchImpl: options.soundcloudCatalogFetch,
          egressGovernor: context.egressGovernor,
        }));
    const getTidalCatalog = () =>
      tidalCatalog ||
      (tidalCatalog =
        require("../../capabilities/feature-platform/providers/tidal-catalog-provider")({
          vaultPath: path.join(context.runtimeDir, "tidal-catalog-vault.json"),
          fetchImpl: options.tidalCatalogFetch,
          egressGovernor: context.egressGovernor,
        }));
    require("../../capabilities/feature-platform/http/register-tidal-oauth.routes")(
      context.app,
      getTidalCatalog,
    );
    const spotifyProvider = require("../../../integrations/spotify-desktop/playback-provider.cjs")({
      runtimeDir: context.runtimeDir,
      fetch: options.spotifyOfficialFetch,
      protect: options.spotifyProtect,
      unprotect: options.spotifyUnprotect,
      onQueueChanged: () => {
        registry?.request("song-request", "song.spotify.player.v1", "flush", {}).catch(() => {});
      },
      onSnapshot: (snapshot) => {
        const current = snapshot.current;
        registry
          ?.request(
            "song-request",
            "song.playback.observe.v1",
            "observe",
            current
              ? {
                  provider: "spotify",
                  sourceId: "ravelink-companion",
                  available: true,
                  title: current.title || "Spotify",
                  artists: current.artists,
                  album: current.album,
                  artworkUrl: current.artworkUrl,
                  durationMs: Math.round(current.durationMs),
                  positionMs: Math.round(current.positionMs),
                  status: current.paused ? "paused" : current.buffering ? "paused" : "playing",
                  observedAt: Date.now(),
                }
              : {
                  provider: "spotify",
                  sourceId: "ravelink-companion",
                  available: false,
                },
            { timeoutMs: 1000 },
          )
          .catch(() => {});
      },
    });
    context.app.use("/api/spotify/bridge", spotifyProvider.router());
    require("../../capabilities/feature-platform/http/register-spotify-oauth.routes")(
      context.app,
      () => spotifyProvider,
    );
    const songLinks = require("../../capabilities/feature-platform/providers/song-link-input")({
      fetchImpl: options.songLinkFetch,
      tidalMetadata: async (id) =>
        tidalBridge?.status().connected ? tidalBridge.resolve({ query: id }) : null,
    });
    async function resolveSongInput(target, payload, resolve) {
      const normalized = await songLinks.normalize(payload?.query, target);
      if (!normalized.ok)
        return {
          ok: false,
          error: normalized.reason,
          reason: normalized.reason,
        };
      return resolve({
        ...payload,
        query: normalized.query,
        ...(normalized.translated
          ? { videoId: "" }
          : target === "youtube" && normalized.id
            ? { videoId: normalized.id }
            : {}),
      });
    }
    const intake = require("../../domains/twitch/request-intake-settings")({
      file: path.join(context.runtimeDir, "system/request-intake.json"),
      provider: twitchProvider,
      registry: () => registry,
    });
    registry = createFeatureHostRegistry({
      // Older installations retain packages when updating Core. This former
      // facade is now supplied by Lights and must never start a duplicate worker.
      supersededFeatureIds: ["music-to-light"],
      featuresRoot: options.featuresRoot || path.join(rootDir, "features", "installed"),
      packageRoots: options.packageRoots || [
        path.join(rootDir, "feature-packages"),
        path.join(rootDir, "features"),
        path.join(rootDir, "optional-components", "feature-packages"),
      ],
      remoteSources:
        options.remoteSources || (options.packageRoots ? [] : OFFICIAL_FEATURE_SOURCES),
      minimumVersions: options.packageRoots
        ? {}
        : Object.fromEntries(
            OFFICIAL_FEATURE_SOURCES.map((source) => [source.id, source.minimumVersion]),
          ),
      fetchImpl: options.featureFetch,
      runtimeRoot: featureRuntimeRoot,
      providers: {
        ...Object.fromEntries(
          ["status", "setup", "resolve", "enqueue", "remove", "control", "review"].map((method) => [
            "youtube.browser.host.v1/" + method,
            (payload, caller) =>
              caller.featureId === "song-request"
                ? youtubeBrowserProvider.handle(method, payload || {})
                : { ok: false, error: "youtube_browser_denied" },
          ]),
        ),
        ...Object.fromEntries(
          [
            "status",
            "setup",
            "resolve",
            "enqueue",
            "remove",
            "control",
            "review",
            "playlist",
            "favorite",
          ].map((method) => [
            "spotify.desktop.host.v1/" + method,
            (payload, caller) =>
              caller.featureId === "song-request"
                ? method === "resolve"
                  ? resolveSongInput("spotify", payload, (input) =>
                      spotifyProvider.handle(method, input),
                    )
                  : spotifyProvider.handle(method, payload || {})
                : { ok: false, error: "spotify_access_denied" },
          ]),
        ),
        "playlist.exports.host.v1/action": (payload, caller) =>
          caller.featureId === "song-request"
            ? playlistExports.action(payload)
            : { ok: false, code: "export_denied" },
        "soundcloud.catalog.host.v1/resolve": (payload, caller) =>
          caller.featureId === "song-request"
            ? resolveSongInput("soundcloud", payload, (input) =>
                getSoundCloudCatalog().resolve(input),
              )
            : { ok: false, reason: "soundcloud_catalog_denied" },
        "media.windows.now-playing.v1/control": (payload) => mediaObserver.control(payload),
        "tidal.playlists.host.v1/action": (payload, caller) =>
          caller.featureId === "song-request"
            ? getTidalCatalog().playlists(payload)
            : { ok: false, error: "tidal_playlist_denied" },
        "tidal.desktop.experimental.v1/status": () =>
          tidalBridge ? tidalBridge.status() : { ok: true, enabled: false },
        "tidal.desktop.experimental.v1/favorite": (payload, caller) =>
          caller.featureId === "song-request"
            ? getTidalCatalog().favorite(payload)
            : { ok: false, error: "tidal_access_denied" },
        "tidal.desktop.experimental.v1/volume": (payload, caller) =>
          caller.featureId === "song-request" && tidalBridge
            ? tidalBridge.volume(payload)
            : { ok: false, error: "tidal_experiment_disabled" },
        "tidal.desktop.experimental.v1/enable": (_payload, caller) =>
          caller.featureId === "song-request"
            ? enableTidalExperiment()
            : { ok: false, error: "tidal_experiment_denied" },
        "tidal.desktop.experimental.v1/manage-companion": (payload, caller) =>
          manageTidalCompanion(payload, caller),
        "tidal.desktop.experimental.v1/catalog": (payload, caller) => {
          if (
            caller.featureId !== "song-request" ||
            ![
              "status",
              "configure",
              "reset-client",
              "begin",
              "test",
              "disconnect",
              "clear",
            ].includes(payload?.action)
          )
            return { ok: false, error: "tidal_catalog_action_denied" };
          return getTidalCatalog()[payload.action](payload);
        },
        "tidal.desktop.experimental.v1/resolve": (payload, caller) =>
          caller.featureId === "song-request" && tidalBridge
            ? resolveSongInput("tidal", payload, (input) => tidalBridge.resolve(input))
            : { ok: false, error: "tidal_experiment_disabled" },
        "tidal.desktop.experimental.v1/enqueue": (payload, caller) =>
          caller.featureId === "song-request" && tidalBridge
            ? tidalBridge.enqueue(payload)
            : { ok: false, error: "tidal_experiment_disabled" },
        "tidal.desktop.experimental.v1/review": (payload, caller) =>
          caller.featureId === "song-request" && tidalBridge
            ? tidalBridge.review(payload)
            : { ok: false, error: "tidal_experiment_disabled" },
        "tidal.desktop.experimental.v1/remove": (payload, caller) =>
          caller.featureId === "song-request" && tidalBridge
            ? tidalBridge.remove(payload)
            : { ok: false, error: "tidal_experiment_disabled" },
        "twitch.host.v1/status": () => twitchProvider().ensureStatus(),
        "twitch.host.v1/configure": (payload) => twitchProvider().configure(payload),
        "twitch.host.v1/configure-monitor": (payload) => twitchProvider().configureMonitor(payload),
        "twitch.commands.host.v1/status": () => {
          const state = twitchProvider().status();
          return {
            ok: true,
            connected: state.connected,
            commandPermissions: state.monitorConfig.commandPermissions,
            ...intake.status(),
          };
        },
        "twitch.commands.host.v1/configure": async (payload) => {
          if (payload.songRequestChatEnabled !== undefined)
            await intake.configure({ songRequestChatEnabled: payload.songRequestChatEnabled });
          const state = await twitchProvider().configureMonitor({
            ...(payload.commandPermissions
              ? { commandPermissions: payload.commandPermissions }
              : {}),
          });
          return {
            ok: true,
            connected: state.connected,
            commandPermissions: state.monitorConfig.commandPermissions,
          };
        },
        "twitch.host.v1/clear-client-id": () => twitchProvider().clearClientId(),
        "twitch.host.v1/begin": (payload) => twitchProvider().begin(payload),
        "twitch.host.v1/poll": () => twitchProvider().poll(),
        "twitch.host.v1/disconnect": () => twitchProvider().disconnect(),
        "twitch.host.v1/inspect-reward": (payload) => twitchProvider().inspectReward(payload),
        "twitch.host.v1/list-rewards": (payload) => twitchProvider().listRewards(payload),
        "twitch.host.v1/create-reward": (payload) => twitchProvider().createReward(payload),
        "twitch.host.v1/automation-community-preview": (payload) =>
          automations.communityPreview(payload),
        "twitch.host.v1/automation-community-import": (payload) =>
          automations.communityImport(payload),
        "twitch.host.v1/automation-community-tracking": (payload) =>
          automations.communityTracking(payload),
        "twitch.host.v1/automation-community-quotes": (payload) =>
          automations.communityQuotes(payload),
        "twitch.host.v1/automation-status": () => automations.status(),
        "twitch.host.v1/automation-catalog": () => automations.catalog(),
        "twitch.host.v1/automation-save": (payload) => automations.save(payload),
        "twitch.host.v1/automation-remove": (payload) => automations.remove(payload),
        "twitch.host.v1/automation-reward": (payload) => automations.reward(payload),
        "twitch.host.v1/automation-cancel": (payload) => automations.cancel(payload),
        "twitch.host.v1/automation-control": (payload) => automations.control(payload),
        "twitch.host.v1/automation-preview": (payload) => automations.preview(payload),
        "twitch.rewards.manage.v1/set-paused": (payload) =>
          require("../../capabilities/feature-platform/providers/twitch-song-reward-pause")(
            twitchProvider(),
            payload,
          ),
        "twitch.host.v1/settle": (payload) => twitchProvider().settle(payload),
        "twitch.host.v1/review-transactions": () => twitchProvider().reviewTransactions(),
        "twitch.host.v1/reconcile-transaction": (payload) =>
          twitchProvider().reconcileTransaction(payload),
        "twitch.host.v1/send-chat": (payload) => twitchProvider().sendChat(payload),
        "youtube.catalog.host.v1/status": () => youtubeProvider().status(),
        "twitch.rewards.manage.v1/song-outcome": (payload, caller) =>
          caller.featureId === "song-request"
            ? twitchProvider().songOutcome(payload)
            : { ok: false, error: "twitch_song_outcome_denied" },
        "youtube.catalog.host.v1/configure": (payload) => youtubeProvider().configure(payload),
        "youtube.catalog.host.v1/clear": () => youtubeProvider().clear(),
        "youtube.catalog.host.v1/resolve": (payload) =>
          resolveSongInput("youtube", payload, (input) => youtubeProvider().resolve(input)),
        "youtube.catalog.host.v1/import-playlist-start": (payload) =>
          youtubeProvider().importPlaylistStart(payload),
        "youtube.catalog.host.v1/import-playlist-status": (payload) =>
          youtubeProvider().importPlaylistStatus(payload),
        "youtube.catalog.host.v1/import-playlist-page": (payload) =>
          youtubeProvider().importPlaylistPage(payload),
        "youtube.catalog.host.v1/import-playlist-cancel": (payload) =>
          youtubeProvider().importPlaylistCancel(payload),
        ...(options.providers || {}),
      },
      allowUnsafeRuntime: options.allowUnsafeRuntime === true,
    });
    registerFeaturePlatformRoutes(context.app, { registry });
    const { requireLocalOperator } = require("../runtime/local-operator.middleware");
    context.app.get("/api/request-intake", requireLocalOperator, async (_req, res, next) => {
      try {
        res.json(await intake.configure({}));
      } catch (error) {
        next(error);
      }
    });
    context.app.put("/api/request-intake", requireLocalOperator, async (req, res, next) => {
      try {
        res.json(await intake.configure(req.body || {}));
      } catch (error) {
        next(error);
      }
    });
    registry.subscribeLifecycle(() => {
      void intake.configure({}).catch(() => {});
    });

    const tidalChoicePath = path.join(context.runtimeDir, "tidal-desktop-enabled.json"),
      tidalChoice = readJsonFile(tidalChoicePath, null),
      tidalEnabled =
        options.experimentalTidal === true ||
        process.env.RAVELINK_EXPERIMENTAL_TIDAL === "1" ||
        (tidalChoice?.version === 1 && tidalChoice.enabled === true);
    let tidalBridge;
    const manageTidalCompanion =
      require("../../capabilities/feature-platform/providers/tidal-companion-manager")({
        rootDir,
        runtimeDir: context.runtimeDir,
        getBridge: () => tidalBridge,
        installer: options.tidalCompanionInstaller,
      });
    function enableTidalExperiment() {
      if (!tidalBridge) {
        writeJsonFile(tidalChoicePath, { version: 1, enabled: true }, { mode: 0o600 });
        tidalBridge =
          require("../../capabilities/feature-platform/providers/experimental-tidal-bridge")({
            runtimeDir: context.runtimeDir,
            search: (query) => getTidalCatalog().search(query),
            onQueueChanged: () => {
              registry
                .request("song-request", "song.tidal.experimental.v1", "flush", {
                  nativeQueueChanged: true,
                })
                .catch(() => {});
            },
          });
        require("../../capabilities/feature-platform/http/register-experimental-tidal.routes")(
          context.app,
          { bridge: tidalBridge, registry },
        );
      }
      return tidalBridge.status();
    }
    if (tidalEnabled) enableTidalExperiment();
    let songWasActive = false;
    const unsubscribeLifecycle = registry.subscribeLifecycle((snapshot) => {
      const songLifecycle = snapshot?.features?.find((row) => row.id === "song-request")?.lifecycle;
      if (!["active", "enabling"].includes(songLifecycle)) mediaObserver.stop().catch(() => {});
      if (songLifecycle === "active" && !songWasActive) mediaObserver.replay();
      songWasActive = songLifecycle === "active";
      const twitchActive = snapshot?.features?.some(
        (row) => row.id === "twitch-integration" && row.lifecycle === "active",
      );
      automations.setActive(twitchActive);
      if (!twitchActive) twitchFlowActions.shoutouts.clear();
      if (!twitchActive) twitchOAuth?.suspendMonitor?.();
      else if (twitchOAuth) twitchOAuth.ensureStatus().catch(() => {});
    });
    const dashboardRewards =
      require("../../capabilities/feature-platform/http/register-dashboard-rewards.routes")(
        context.app,
        {
          registry,
          getProvider: twitchProvider,
          intakePause,
          getBuiltinRows: () => automations.status().rows,
        },
      );
    const defaultFeatureIds = options.installBundledDefaults
      ? OFFICIAL_FEATURE_SOURCES.map(({ id }) => id)
      : [];
    const startup = registry.startInstalled(defaultFeatureIds).catch((error) => ({
      ok: false,
      error: String(error?.message || error).slice(0, 160),
    }));
    void startup
      .then(() => {
        if (
          registry
            .list()
            .features.some((row) => row.id === "twitch-integration" && row.lifecycle === "active")
        )
          return twitchProvider().ensureStatus();
        return null;
      })
      .catch(() => {});
    return Object.freeze({
      owner: "feature-platform",
      twitchDashboard: () =>
        registry
          .list()
          .features.some((row) => row.id === "twitch-integration" && row.lifecycle === "active")
          ? twitchProvider()
          : null,
      overlayRecords: (widgets) => automations.overlayRecords(widgets),
      twitchClips,
      twitchFlowActions,
      dashboardRewards,
      registry,
      startup,
      mediaObserver,
      async shutdown() {
        twitchFlowActions.shutdown();
        automations.shutdown();
        unsubscribeLifecycle?.();
        spotifyProvider.close();
        await youtubeBrowserProvider.close();
        tidalBridge?.shutdown();
        tidalCatalog?.shutdown();
        await mediaObserver.stop();
        await twitchClips.shutdown();
        await twitchOAuth?.shutdown?.();
        return registry.shutdown();
      },
    });
  };
}

module.exports = createFeaturePlatformExtension;
