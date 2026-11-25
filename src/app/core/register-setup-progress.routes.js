/** Progress reports only readiness booleans; account and fixture details stay with their owners. */
const { requireLocalOperator } = require("../runtime/local-operator.middleware");
module.exports = (app, { runtimeDir, core, getRegistry, getTwitch, getDeck, getOverlays }) => {
  const service = require("../../domains/system/setup-progress")({
    runtimeDir,
    readFacts: async () => {
      const registry = getRegistry(),
        active = (id) =>
          registry?.list().features.some((row) => row.id === id && row.lifecycle === "active");
      let music = false;
      if (active("song-request")) {
        try {
          const result = await registry.request(
            "song-request",
            "song.player.preferences.v1",
            "status",
            null,
            { timeoutMs: 2000 },
          );
          music = result.ok && result.value?.configured === true;
          if (music && ["spotify", "tidal"].includes(result.value.player)) {
            const cap =
              result.value.player === "spotify"
                ? "song.spotify.player.v1"
                : "song.tidal.experimental.v1";
            const status = await registry.request("song-request", cap, "status", null, {
              timeoutMs: 2000,
            });
            music =
              status.ok &&
              (status.value?.ready === true ||
                status.value?.connected === true ||
                status.value?.connection?.connected === true);
          }
        } catch {
          /* Unverified reads remain pending. */
        }
      }
      const ready = core.fixtureRegistry
        .getConnectivitySnapshot()
        .rows.some((row) => row.configured && row.enabled !== false);
      return {
        lights: ready,
        twitch: active("twitch-integration") && getTwitch()?.status().connected === true,
        music,
        deck: getDeck().config.pages.some((page) => page.buttons.length > 0),
        overlays: getOverlays()
          ?.store.snapshot()
          .documents.some((doc) => doc.widgets.length > 0),
      };
    },
  });
  app.get("/api/presentation/setup", requireLocalOperator, async (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(await service.snapshot());
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/presentation/setup", requireLocalOperator, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(await service.update(req.body));
    } catch (error) {
      const code = ["setup_progress_invalid", "setup_progress_conflict"].includes(error.message)
        ? error.message
        : "setup_progress_unavailable";
      res
        .status(
          code === "setup_progress_invalid" ? 400 : code === "setup_progress_conflict" ? 409 : 503,
        )
        .json({ ok: false, error: code });
    }
  });
};
