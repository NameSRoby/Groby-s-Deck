#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const createFeaturePackageManager = require("../src/capabilities/feature-platform/packages/feature-package-manager");
const createFeatureStateStore = require("../src/capabilities/feature-platform/packages/feature-state-store");
const {
  OFFICIAL_FEATURE_SOURCES,
} = require("../src/capabilities/feature-platform/packages/official-feature-sources");

const OFFICIAL_IDS = new Set(OFFICIAL_FEATURE_SOURCES.map((row) => row.id));

function selectedFeatureIds(values) {
  const ids = [
    ...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)),
  ];
  if (!ids.length || ids.some((id) => !OFFICIAL_IDS.has(id)))
    throw new Error("invalid_feature_selection");
  return ids;
}

async function installSelectedFeatures(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, ".."));
  const installedRoot = path.join(rootDir, "features", "installed");
  const runtimeRoot = path.join(rootDir, "runtime", "features");
  const featureIds = selectedFeatureIds(options.featureIds);
  const state = createFeatureStateStore({ storePath: path.join(runtimeRoot, "state.json") });
  if (options.skip) {
    return featureIds.map((featureId) => {
      if (!fs.existsSync(path.join(installedRoot, featureId)) && !state.get(featureId).configured)
        state.setEnabled(featureId, false, "setup-skipped");
      return { ok: true, featureId, operation: "skipped" };
    });
  }
  const manager =
    options.manager ||
    createFeaturePackageManager({
      installedRoot,
      packageRoots: [path.join(rootDir, "optional-components", "feature-packages")],
      remoteSources: options.offline ? [] : OFFICIAL_FEATURE_SOURCES,
      runtimeRoot,
    });
  const catalog = await manager.listAvailable();
  const available = new Map((catalog.features || []).map((row) => [row.id, row]));
  const results = [];
  const restoreSkipped = (id) => {
    if (state.get(id).reason === "setup-skipped") state.setEnabled(id, true, "setup-selected");
  };
  for (const featureId of featureIds) {
    if (state.get(featureId).reason === "uninstalled") {
      results.push({ ok: true, featureId, operation: "kept_removed" });
      continue;
    }
    const row = available.get(featureId);
    if (!row) throw new Error(`feature_package_not_available:${featureId}`);
    if (row.installedVersion && !row.updateAvailable) {
      results.push({
        ok: true,
        featureId,
        operation: "already_current",
        version: row.installedVersion,
      });
      restoreSkipped(featureId);
      continue;
    }
    const result = row.installed
      ? await manager.update(featureId, { bundledOnly: options.offline, repairInvalid: true })
      : await manager.install(featureId);
    if (!result?.ok)
      throw new Error(
        `${String(result?.error || "feature_install_failed").slice(0, 80)}:${featureId}`,
      );
    results.push({
      ok: true,
      featureId,
      operation: result.operation || (row.installed ? "updated" : "installed"),
      version: String(result.version || row.version || ""),
    });
    restoreSkipped(featureId);
  }
  return results;
}

async function main() {
  const log = (message) => {
    try {
      const dir = path.resolve(__dirname, "../runtime/logs");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "feature-setup.log");
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.writeFileSync(file, "");
      fs.appendFileSync(file, message + "\n");
    } catch {}
  };
  try {
    const args = process.argv.slice(2);
    const results = await installSelectedFeatures({
      featureIds: args.filter((value) => !["--offline", "--skip"].includes(value)),
      offline: args.includes("--offline"),
      skip: args.includes("--skip"),
    });
    for (const row of results) {
      process.stdout.write(`[FEATURE SETUP] ${row.featureId} ${row.operation}\n`);
      log(`[FEATURE SETUP] ${row.featureId} ${row.operation}`);
    }
  } catch (error) {
    log(`[FEATURE SETUP] ${String(error?.message || "feature_install_failed").slice(0, 160)}`);
    process.stderr.write(
      `[FEATURE SETUP] ${String(error?.message || "feature_install_failed").slice(0, 160)}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { installSelectedFeatures, selectedFeatureIds };
