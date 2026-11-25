const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  installSelectedFeatures,
  selectedFeatureIds,
} = require("../scripts/install-official-features");

test("installer feature selection accepts only unique official package IDs", () => {
  assert.deepEqual(selectedFeatureIds(["song-request", "song-request", "twitch-integration"]), [
    "song-request",
    "twitch-integration",
  ]);
  assert.throws(() => selectedFeatureIds(["clip-studio"]), /invalid_feature_selection/);
  assert.throws(() => selectedFeatureIds([]), /invalid_feature_selection/);
  assert.throws(() => selectedFeatureIds(["../local-package"]), /invalid_feature_selection/);
});

test("installer downloads missing selections, updates older ones, and keeps current packages", async () => {
  const calls = [];
  const manager = {
    listAvailable: async () => ({
      ok: true,
      features: [
        {
          id: "song-request",
          version: "0.14.0",
          installed: false,
          installedVersion: "",
          updateAvailable: false,
        },
        {
          id: "twitch-integration",
          version: "0.13.10",
          installed: true,
          installedVersion: "0.13.9",
          updateAvailable: true,
        },
      ],
    }),
    install: async (id) => {
      calls.push(["install", id]);
      return { ok: true, featureId: id, version: "0.14.0" };
    },
    update: async (id) => {
      calls.push(["update", id]);
      return { ok: true, featureId: id, version: "0.13.10" };
    },
  };
  const results = await installSelectedFeatures({
    featureIds: ["song-request", "twitch-integration"],
    manager,
  });
  assert.deepEqual(calls, [
    ["install", "song-request"],
    ["update", "twitch-integration"],
  ]);
  manager.listAvailable = async () => ({
    ok: true,
    features: [
      {
        id: "twitch-integration",
        version: "0.13.10",
        installed: true,
        installedVersion: "0.13.10",
        updateAvailable: false,
      },
    ],
  });
  const current = await installSelectedFeatures({ featureIds: ["twitch-integration"], manager });
  assert.equal(current[0].operation, "already_current");
  assert.deepEqual(
    results.map((row) => row.operation),
    ["installed", "updated"],
  );
});

test("installer fails clearly instead of accepting an unavailable official selection", async () => {
  const manager = { listAvailable: async () => ({ ok: true, features: [] }) };
  await assert.rejects(
    installSelectedFeatures({ featureIds: ["song-request"], manager }),
    /feature_package_not_available:song-request/,
  );
});

test("a clean installation installs both bundled features offline and preserves existing versions", async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-offline-setup-"));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const { stageOfflineFeatures } = require("../scripts/stage-offline-features");
  await stageOfflineFeatures(
    path.resolve(__dirname, ".."),
    path.join(rootDir, "optional-components", "feature-packages"),
  );
  const install = () =>
    installSelectedFeatures({
      rootDir,
      featureIds: ["song-request", "twitch-integration"],
      offline: true,
    });
  const first = await install();
  assert(first.every((r) => r.operation === "installed"));
  assert((await install()).every((r) => r.operation === "already_current"));
  const installed = path.join(rootDir, "features", "installed");
  const page = path.join(installed, "twitch-integration", "ui", "automations.html");
  fs.writeFileSync(page, "incomplete download");
  assert.equal(
    (await install()).find((row) => row.featureId === "twitch-integration").operation,
    "repaired",
  );
  assert.match(fs.readFileSync(page, "utf8"), /Public presets/);
  const preserved = fs.readdirSync(installed).find((name) => name.endsWith(".previous"));
  assert.equal(
    fs.readFileSync(path.join(installed, preserved, "ui", "automations.html"), "utf8"),
    "incomplete download",
  );
  assert(
    !fs.existsSync(path.join(rootDir, "runtime", "system")),
    "no account/host settings are copied",
  );
  fs.rmSync(path.join(rootDir, "optional-components"), { recursive: true });
  await assert.rejects(install(), /feature_package_not_available/);
});

test("first launch provisions bundled defaults and respects installer skips and removals", async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "groby-bundled-defaults-"));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const { stageOfflineFeatures } = require("../scripts/stage-offline-features");
  const createRegistry = require("../src/capabilities/feature-platform/host/feature-host-registry");
  const bundled = path.join(rootDir, "optional-components", "feature-packages");
  const installed = path.join(rootDir, "features", "installed");
  const ids = ["song-request", "twitch-integration"];
  await stageOfflineFeatures(path.resolve(__dirname, ".."), bundled);
  await installSelectedFeatures({ rootDir, featureIds: ["song-request"], skip: true });
  const create = () =>
    createRegistry({
      featuresRoot: installed,
      packageRoots: [bundled],
      runtimeRoot: path.join(rootDir, "runtime", "features"),
      supervisorFactory: () => {
        const status = { lifecycle: "installed-disabled" };
        return {
          getStatus: () => status,
          start: async () => status,
          stop: async () => status,
        };
      },
    });
  const registry = create();
  await registry.startInstalled(ids);
  assert.deepEqual(
    registry.list().features.map(({ id }) => id),
    ["twitch-integration"],
  );
  assert.equal((await registry.uninstall("twitch-integration")).ok, true);
  await registry.shutdown();
  const repair = await installSelectedFeatures({
    rootDir,
    featureIds: ["twitch-integration"],
    offline: true,
  });
  assert.equal(repair[0].operation, "kept_removed");
  assert.equal(fs.existsSync(path.join(installed, "twitch-integration")), false);
  const restarted = create();
  await restarted.startInstalled(ids);
  assert.deepEqual(restarted.list().features, []);
  await restarted.shutdown();
});
