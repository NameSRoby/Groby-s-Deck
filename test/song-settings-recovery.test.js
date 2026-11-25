const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const createRegistry = require("../src/capabilities/feature-platform/host/feature-host-registry");
const createSupervisor = require("../src/capabilities/feature-platform/host/feature-process-supervisor");

test(
  "slow cold-start storage restores existing settings beyond the old six-second deadline",
  { timeout: 30000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-song-cold-storage-"));
    fs.cpSync(
      path.join(__dirname, "../features/song-request"),
      path.join(root, "installed/song-request"),
      { recursive: true },
    );
    let slow = false;
    const options = {
      featuresRoot: path.join(root, "installed"),
      runtimeRoot: path.join(root, "runtime"),
      allowUnsafeRuntime: false,
      supervisorFactory: (options) =>
        createSupervisor({
          ...options,
          onBrokerRequest: async (...args) => {
            if (slow && args[0] === "ravelink.storage.v1" && args[1] === "get")
              await new Promise((resolve) => setTimeout(resolve, 1100));
            return options.onBrokerRequest(...args);
          },
        }),
    };
    let registry = createRegistry(options);
    t.after(async () => {
      await registry.shutdown();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const call = async (capability, method, payload = null) => {
      const result = await registry.request("song-request", capability, method, payload, {
        timeoutMs: 12000,
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.notEqual(result.value?.ok, false, JSON.stringify(result));
      return result.value;
    };
    assert.equal((await registry.startInstalled())[0].lifecycle, "active");
    await call("song.player.preferences.v1", "select", { player: "spotify" });
    await call("song.queue.admin.v1", "configure", { limits: { maxDurationMs: 900000 } });
    const overlay = await call("song.overlay.admin.v1", "profile", {
      action: "save",
      name: "Preserved cold-start overlay",
      config: {
        ...require("../features/song-request/dist/overlay-presets").get("ribbon"),
        accent: "#12ab34",
        followAppColors: false,
      },
      expectedRevision: 0,
    });
    await registry.shutdown();
    slow = true;
    registry = createRegistry(options);
    const startedAt = Date.now();
    const started = await registry.startInstalled();
    slow = false;
    assert.equal(started[0].lifecycle, "active", started[0].lastError);
    assert.ok(
      Date.now() - startedAt > 6000,
      "fixture exercises a complete boot beyond the former deadline",
    );
    assert.equal((await call("song.player.preferences.v1", "status")).player, "spotify");
    assert.equal((await call("song.queue.read.v1", "status")).limits.maxDurationMs, 900000);
    const restored = await call("song.overlay.read.v1", "status");
    assert.equal(restored.activeProfileId, overlay.profile.id);
    assert.equal(restored.config.accent, "#12ab34");
  },
);
for (const source of ["features/song-request", "features/installed/song-request"].filter(
  (source) =>
    source === "features/song-request" || fs.existsSync(path.join(__dirname, "..", source)),
)) {
  test(`${source}: unavailable storage never becomes a successful default player selection`, async () => {
    let available = false;
    const preferences = require(path.join(__dirname, "..", source, "dist/player-preferences"))({
      consumedCapabilities: ["groby.storage.v1"],
      callCapability: async () => {
        if (!available) throw Object.assign(Error("Unavailable"), { code: "provider_unavailable" });
        return { ok: true, found: true, value: { player: "tidal", youtubePlayback: "browser" } };
      },
    });
    const failed = await preferences("status", null);
    assert.equal(failed.ok, false);
    assert.equal(failed.code, "player_preferences_unavailable");
    available = true;
    assert.equal((await preferences("status", null)).player, "tidal");
  });
  test(`${source}: every player selection, queue settings and overlay profile survive a complete host restart`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-song-recovery-"));
    fs.cpSync(path.join(__dirname, "..", source), path.join(root, "installed", "song-request"), {
      recursive: true,
    });
    const options = {
      featuresRoot: path.join(root, "installed"),
      runtimeRoot: path.join(root, "runtime"),
      allowUnsafeRuntime: true,
    };
    let registry = createRegistry(options);
    t.after(async () => {
      await registry.shutdown();
      fs.rmSync(root, { recursive: true, force: true });
    });
    assert.equal((await registry.startInstalled())[0].lifecycle, "active");
    const call = async (capability, method, payload = null) => {
      const result = await registry.request("song-request", capability, method, payload, {
        timeoutMs: 12000,
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.notEqual(result.value?.ok, false, JSON.stringify(result));
      return result.value;
    };
    for (const player of ["youtube", "spotify", "soundcloud", "tidal"])
      assert.equal(
        (await call("song.player.preferences.v1", "select", { player, youtubePlayback: "browser" }))
          .player,
        player,
      );
    await call("song.queue.admin.v1", "configure", { limits: { maxDurationMs: 900000 } });
    const overlay = await call("song.overlay.admin.v1", "profile", {
      action: "save",
      name: "Recovered custom overlay",
      config: {
        ...require("../features/song-request/dist/overlay-presets").get("ribbon"),
        followAppColors: false,
        accent: "#12ab34",
      },
      expectedRevision: 0,
    });
    assert.equal(overlay.profile.name, "Recovered custom overlay");
    await registry.shutdown();
    registry = createRegistry(options);
    assert.equal((await registry.startInstalled())[0].lifecycle, "active");
    const preferences = await call("song.player.preferences.v1", "status");
    assert.equal(preferences.player, "tidal");
    assert.equal(preferences.youtubePlayback, "browser");
    const status = await call("song.queue.read.v1", "status");
    assert.equal(status.limits.maxDurationMs, 900000);
    const restored = await call("song.overlay.read.v1", "status");
    assert.equal(restored.activeProfileId, overlay.profile.id);
    assert.equal(restored.config.accent, "#12ab34");
    assert.equal(restored.profiles[0].name, "Recovered custom overlay");
    assert.equal(restored.revision, overlay.revision);
  });
}
for (const failure of ["invalid-json", "missing-overlay-shard"]) {
  test(`failed settings restore (${failure}) stops activation without overwriting the recoverable state`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-song-failed-restore-"));
    fs.cpSync(
      path.join(__dirname, "../features/song-request"),
      path.join(root, "installed/song-request"),
      { recursive: true },
    );
    const dataDir = path.join(root, "runtime/data/song-request");
    fs.mkdirSync(dataDir, { recursive: true });
    const snapshot = require("../features/song-request/dist/domain")
      .createSongQueue()
      .exportSnapshot();
    delete snapshot.overlayProfiles;
    snapshot.overlayProfileStorage = { generation: "0".repeat(64), count: 1 };
    const contents = failure === "invalid-json" ? "{broken" : JSON.stringify(snapshot);
    const filename = path.join(dataDir, "queue-state-v1.json");
    fs.writeFileSync(filename, contents);
    const registry = createRegistry({
      featuresRoot: path.join(root, "installed"),
      runtimeRoot: path.join(root, "runtime"),
      allowUnsafeRuntime: true,
    });
    t.after(async () => {
      await registry.shutdown();
      fs.rmSync(root, { recursive: true, force: true });
    });
    assert.equal((await registry.startInstalled())[0].lifecycle, "crashed");
    await registry.shutdown();
    assert.equal(fs.readFileSync(filename, "utf8"), contents);
  });
}
