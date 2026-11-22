const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { manifestNames, featurePublisher } = require("../src/shared/fs/upgrade-identifiers.json");
const migrate = require("../src/shared/fs/migrate-package-manifests"),
  {
    verifyPackageDirectory,
  } = require("../src/capabilities/mod-platform/packages/mod-package-integrity");
test("an installed mod migrates its manifest name without changing its payload, metadata or approvals", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mod = path.join(root, "example");
  fs.cpSync(path.join(__dirname, "../mods/twitch-clips"), mod, { recursive: true });
  const contents = fs.readFileSync(path.join(mod, "groby.mod.json"));
  fs.renameSync(path.join(mod, "groby.mod.json"), path.join(mod, manifestNames.mod));
  await migrate(root, "mod", verifyPackageDirectory);
  assert.equal((await verifyPackageDirectory(mod)).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(mod, "groby.mod.json")), contents);
  assert.equal(fs.existsSync(path.join(mod, manifestNames.mod)), false);
  await migrate(root, "mod", verifyPackageDirectory);
  assert.deepEqual(fs.readFileSync(path.join(mod, "groby.mod.json")), contents);
});
test("invalid packages keep their original files and conflicting manifests are never overwritten", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-manifest-bad-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mod = path.join(root, "bad");
  fs.mkdirSync(mod);
  fs.writeFileSync(path.join(mod, manifestNames.mod), "{}");
  await migrate(root, "mod", verifyPackageDirectory);
  assert.equal(fs.existsSync(path.join(mod, manifestNames.mod)), true);
  assert.equal(fs.existsSync(path.join(mod, "groby.mod.json")), false);
  fs.writeFileSync(path.join(mod, "groby.mod.json"), "keep");
  await migrate(root, "mod", verifyPackageDirectory);
  assert.equal(fs.readFileSync(path.join(mod, "groby.mod.json"), "utf8"), "keep");
});

test("first-party feature migration preserves payloads and updates only the old publisher metadata", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-feature-name-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const feature = path.join(root, "twitch-integration");
  fs.cpSync(path.join(__dirname, "../features/twitch-integration"), feature, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(feature, "groby.feature.json"), "utf8"));
  manifest.publisher = featurePublisher;
  fs.writeFileSync(path.join(feature, manifestNames.feature), JSON.stringify(manifest));
  fs.unlinkSync(path.join(feature, "groby.feature.json"));
  const verify =
    require("../src/capabilities/feature-platform/packages/feature-package-integrity").verifyFeaturePackageDirectory;
  await migrate(root, "feature", verify);
  const checked = await verify(feature);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.manifest.publisher, "grobys-deck");
});
