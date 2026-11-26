const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function main() {
  const root = path.resolve(process.argv[2]);
  const modules = path.join(root, "src/capabilities/feature-platform/packages");
  const { OFFICIAL_FEATURE_SOURCES } = require(path.join(modules, "official-feature-sources"));
  const createFeaturePackageManager = require(path.join(modules, "feature-package-manager"));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "groby-online-"));
  try {
    const installedRoot = path.join(empty, "installed");
    const manager = createFeaturePackageManager({
      installedRoot,
      packageRoots: [],
      remoteSources: OFFICIAL_FEATURE_SOURCES,
      runtimeRoot: path.join(empty, "runtime"),
    });
    const available = await manager.listAvailable();
    assert.deepEqual(available.features.map((row) => row.id).sort(), [
      "song-request",
      "twitch-integration",
    ]);
    for (const source of OFFICIAL_FEATURE_SOURCES) {
      const row = available.features.find((item) => item.id === source.id);
      assert.equal(row.source, "github");
      assert.equal(row.downloadRequired, true);
      const installed = await manager.install(source.id);
      assert.equal(installed.ok, true, JSON.stringify(installed));
      const manifest = JSON.parse(
        fs.readFileSync(path.join(installedRoot, source.id, "groby.feature.json"), "utf8"),
      );
      assert.equal(manifest.version, source.minimumVersion);
      console.log("Online Packages catalog verified", source.id, manifest.version, Object.keys(manifest.integrity.files).length, "files");
    }
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
