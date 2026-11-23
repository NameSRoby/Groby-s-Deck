// [TITLE] Test Module: test/mod-platform.host-registry.test.js
// [TITLE] Purpose: verify non-executing mod discovery and explicit bounded activation

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const createModHostRegistry = require("../src/capabilities/mod-platform/host/mod-host-registry");

const HASH = "a".repeat(64);

function manifest(publisher, name) {
  const id = `${publisher}.${name}`;
  return {
    schemaVersion: 1,
    id,
    name,
    version: "1.0.0",
    publisher,
    license: "MIT",
    entry: "dist/main.js",
    engine: { ravelinkModApi: "^1.0.0", node: ">=22" },
    activationEvents: ["onEnable"],
    consumes: [],
    provides: [`${name}.service.v1`],
    permissions: {},
    resources: {
      idleCpuPercent: 0.1,
      idleRssMiB: 32,
      activeRssMiB: 64,
      timers: 1,
      minTimerMs: 1000,
      ipcFrameBytes: 32768,
      inFlightCalls: 1,
      queuedCalls: 1,
      externalInFlight: 0,
      storageBytes: 0,
      historyEntries: 10,
      shutdownGraceMs: 500,
    },
    integrity: { algorithm: "sha256", files: { "dist/main.js": HASH } },
  };
}

function installFixture(modsRoot, descriptor, source = "module.exports = {};\n") {
  const root = path.join(modsRoot, descriptor.id);
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "groby.mod.json"), `${JSON.stringify(descriptor)}\n`, "utf8");
  fs.writeFileSync(path.join(root, "dist", "main.js"), source, "utf8");
  return root;
}

function createFakeSupervisorFactory(created) {
  return (options) => {
    let lifecycle = "installed-disabled";
    const api = {
      getStatus: () => ({
        ok: true,
        modId: options.manifest.id,
        lifecycle,
        lastError: "",
      }),
      start: async () => {
        lifecycle = "active";
        return api.getStatus();
      },
      stop: async () => {
        lifecycle = "installed-disabled";
        return api.getStatus();
      },
      request: async (capability, method, payload) => ({
        ok: true,
        value: { capability, method, payload },
      }),
    };
    created.push({ options, api });
    return api;
  };
}

test("explicit mod switches survive restart without enabling new, disabled or unapproved mods", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-mod-startup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modsRoot = path.join(root, "installed"),
    file = path.join(root, "startup.json");
  for (const name of ["first", "second"]) installFixture(modsRoot, manifest("example", name));
  let approved = true;
  const open = () => {
    const preferences =
      require("../src/capabilities/mod-platform/packages/mod-startup-preferences")(file);
    const registry = createModHostRegistry({
      modsRoot,
      runtimeRoot: path.join(root, "runtime"),
      onEnabledPreference: preferences.set,
      getEnabledPreference: preferences.get,
      supervisorFactory: createFakeSupervisorFactory([]),
      activationAdmission: async () =>
        approved ? { ok: true } : { ok: false, error: "permission_approval_required" },
    });
    registry.discover();
    return registry;
  };
  let registry = open();
  assert.deepEqual(await registry.startInstalled(), []);
  await registry.enable("example.first");
  await registry.shutdown();
  registry = open();
  await registry.startInstalled();
  assert.equal(registry.list().mods.find((row) => row.id === "example.first").enabled, true);
  assert.equal(registry.list().mods.find((row) => row.id === "example.second").enabled, false);
  await registry.shutdown();
  approved = false;
  registry = open();
  const results = await registry.startInstalled();
  assert.equal(results[0].error, "permission_approval_required");
  assert.equal(registry.list().active, 0);
  await registry.shutdown();
  approved = true;
  registry = open();
  await registry.startInstalled();
  await registry.disable("example.first");
  await registry.shutdown();
  registry = open();
  assert.deepEqual(await registry.startInstalled(), []);
  await registry.shutdown();
  fs.writeFileSync(file, '{"version":1,"enabled":{"example.first":"true"}}');
  registry = open();
  assert.deepEqual(await registry.startInstalled(), []);
  await registry.shutdown();
});

test("a blocked activation retries with newly confirmed permissions and never reports a failed worker as active", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-mod-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  installFixture(root, manifest("example", "retry"));
  const created = [],
    preferences = [];
  let approved = true,
    stops = 0;
  const registry = createModHostRegistry({
    modsRoot: root,
    runtimeRoot: path.join(root, "runtime"),
    activationAdmission: async () => ({ ok: approved, error: "permission_approval_required" }),
    onEnabledPreference: (id, value) => preferences.push(value),
    supervisorFactory(options) {
      created.push(options);
      let status = { ok: true, lifecycle: "installed-disabled" };
      return {
        getStatus: () => status,
        async start() {
          status =
            options.allowUnsafeRuntime === true
              ? { ok: true, lifecycle: "active" }
              : {
                  ok: true,
                  lifecycle: "permission-required",
                  lastError: "runtime_isolation_unavailable",
                };
          return status;
        },
        async stop() {
          stops++;
          status = { ok: true, lifecycle: "installed-disabled" };
          return status;
        },
      };
    },
  });
  t.after(() => registry.shutdown());
  registry.discover();
  const failed = await registry.enable("example.retry");
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "runtime_isolation_unavailable");
  assert.deepEqual(preferences, []);
  approved = false;
  assert.equal(
    (await registry.enable("example.retry", { allowUnsafeRuntime: true })).error,
    "permission_approval_required",
  );
  assert.equal(created.length, 1, "review is still required before replacing the blocked worker");
  approved = true;
  assert.equal(
    (await registry.enable("example.retry", { allowUnsafeRuntime: true })).lifecycle,
    "active",
  );
  assert.equal(created.length, 2);
  assert.equal(stops, 1);
  assert.equal(created[1].allowUnsafeRuntime, true);
  assert.deepEqual(preferences, [true]);
  await registry.enable("example.retry");
  assert.equal(created.length, 2, "active workers are not replaced");
  await registry.disable("example.retry");
  assert.equal(
    (await registry.enable("example.retry")).ok,
    false,
    "a stopped worker cannot retain a previous execution's reduced-isolation choice",
  );
  assert.equal(created[2].allowUnsafeRuntime, false);
  assert.equal(
    (await registry.enable("example.retry", { allowUnsafeRuntime: true })).lifecycle,
    "active",
  );
});

test("registry treats an absent mods directory as an empty zero-work state", () => {
  const root = path.join(os.tmpdir(), `ravelink-missing-mods-${Date.now()}`);
  const registry = createModHostRegistry({ modsRoot: root });
  const snapshot = registry.discover();
  assert.equal(snapshot.total, 0);
  assert.equal(snapshot.active, 0);
  assert.equal(fs.existsSync(root), false);
});

test("registry discovers manifests without evaluating mod entry code", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-mod-registry-"));
  const marker = path.join(root, "executed.txt");
  installFixture(
    root,
    manifest("alpha", "echo"),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad');\nmodule.exports = {};\n`,
  );
  const registry = createModHostRegistry({ modsRoot: root });
  const snapshot = registry.discover();
  assert.equal(snapshot.total, 1);
  assert.equal(snapshot.mods[0].lifecycle, "installed-disabled");
  assert.equal(fs.existsSync(marker), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("registry reports malformed and duplicate manifests deterministically", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-mod-registry-errors-"));
  installFixture(root, manifest("alpha", "echo"));
  const duplicateRoot = path.join(root, "duplicate-folder");
  fs.mkdirSync(duplicateRoot, { recursive: true });
  fs.writeFileSync(
    path.join(duplicateRoot, "groby.mod.json"),
    JSON.stringify(manifest("alpha", "echo")),
    "utf8",
  );
  const invalidRoot = path.join(root, "invalid-folder");
  fs.mkdirSync(invalidRoot, { recursive: true });
  fs.writeFileSync(path.join(invalidRoot, "groby.mod.json"), "{broken", "utf8");
  const snapshot = createModHostRegistry({ modsRoot: root }).discover();
  assert.equal(snapshot.total, 1);
  assert.equal(
    snapshot.discoveryErrors.some((error) => error.code === "duplicate_mod_id"),
    true,
  );
  assert.equal(
    snapshot.discoveryErrors.some((error) => error.code === "manifest_invalid_json"),
    true,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("registry requires explicit enable and enforces the global process limit", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-mod-registry-limit-"));
  installFixture(root, manifest("alpha", "one"));
  installFixture(root, manifest("beta", "two"));
  const created = [];
  const registry = createModHostRegistry({
    modsRoot: root,
    maxActiveMods: 1,
    activationAdmission: async (row) => ({ ok: true, manifest: row.manifest }),
    supervisorFactory: createFakeSupervisorFactory(created),
  });
  let snapshot = registry.discover();
  assert.equal(snapshot.active, 0);
  assert.equal(created.length, 0);
  assert.equal((await registry.enable("alpha.one")).lifecycle, "active");
  const rejected = await registry.enable("beta.two");
  assert.equal(rejected.error, "active_mod_limit");
  assert.equal(created.length, 1);
  await registry.disable("alpha.one");
  assert.equal((await registry.enable("beta.two")).lifecycle, "active");
  snapshot = await registry.shutdown();
  assert.equal(snapshot.active, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("registry routes calls only to an explicitly activated supervisor", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-mod-registry-request-"));
  installFixture(root, manifest("alpha", "echo"));
  const created = [];
  const registry = createModHostRegistry({
    modsRoot: root,
    activationAdmission: async (row) => ({ ok: true, manifest: row.manifest }),
    supervisorFactory: createFakeSupervisorFactory(created),
  });
  registry.discover();
  let result = await registry.request("alpha.echo", "echo.service.v1", "echo", {
    before: true,
  });
  assert.equal(result.error.code, "mod_unavailable");
  await registry.enable("alpha.echo");
  result = await registry.request("alpha.echo", "echo.service.v1", "echo", {
    after: true,
  });
  assert.deepEqual(result.value.payload, { after: true });
  await registry.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

test("registry negotiates required capabilities and exposes brokered core calls", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-mod-registry-broker-"));
  const descriptor = manifest("alpha", "consumer");
  descriptor.consumes = ["chat.send.v1"];
  installFixture(root, descriptor);
  const registry = createModHostRegistry({
    modsRoot: root,
    activationAdmission: async (row) => ({ ok: true, manifest: row.manifest }),
    supervisorFactory: createFakeSupervisorFactory([]),
  });
  registry.discover();
  assert.equal((await registry.enable("alpha.consumer")).error, "dependencies_unavailable");
  registry.registerCapabilityContract({
    capability: "chat.send.v1",
    methods: {
      send: {
        validateRequest: (value) => Boolean(value && typeof value.text === "string"),
        validateResponse: (value) => value?.sent === true,
      },
    },
  });
  registry.registerHostCapability({
    providerId: "ravelink.chat",
    capability: "chat.send.v1",
    invoke: async () => ({ sent: true }),
  });
  assert.equal((await registry.enable("alpha.consumer")).lifecycle, "active");
  assert.equal(
    (
      await registry.requestCapability("chat.send.v1", "send", {
        text: "hello",
      })
    ).value.sent,
    true,
  );
  await registry.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

test("runtime consent survives restart only for reviewed content; revocation still blocks startup", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-consent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modsRoot = path.join(root, "mods"),
    preferenceFile = path.join(root, "startup.json");
  installFixture(modsRoot, manifest("example", "remember"));
  let approved = true;
  const open = () => {
    const pref = require("../src/capabilities/mod-platform/packages/mod-startup-preferences")(
      preferenceFile,
    );
    const registry = createModHostRegistry({
      modsRoot,
      runtimeRoot: path.join(root, "runtime"),
      onEnabledPreference: pref.set,
      getEnabledPreference: pref.get,
      hasRuntimeConsent: pref.hasConsent,
      activationAdmission: async () => ({ ok: approved, error: "permission_approval_required" }),
      supervisorFactory(options) {
        let state = { lifecycle: "installed-disabled" };
        return {
          getStatus: () => state,
          start: async () =>
            (state = options.allowUnsafeRuntime
              ? { ok: true, lifecycle: "active" }
              : {
                  ok: false,
                  lifecycle: "permission-required",
                  lastError: "runtime_isolation_unavailable",
                }),
          stop: async () => (state = { lifecycle: "installed-disabled" }),
        };
      },
    });
    registry.discover();
    return registry;
  };
  let r = open();
  assert.equal(
    (await r.enable("example.remember", { allowUnsafeRuntime: true })).lifecycle,
    "active",
  );
  await r.shutdown();
  r = open();
  assert.equal((await r.startInstalled())[0].lifecycle, "active");
  assert.equal(r.list().mods[0].runtimeApproved, true);
  await r.disable("example.remember");
  assert.equal((await r.enable("example.remember")).lifecycle, "active");
  await r.shutdown();
  approved = false;
  r = open();
  assert.equal((await r.startInstalled())[0].error, "permission_approval_required");
  await r.shutdown();
  approved = true;
  const changed = manifest("example", "remember");
  changed.integrity.files["dist/main.js"] = "b".repeat(64);
  installFixture(modsRoot, changed, "module.exports={changed:true};");
  r = open();
  assert.equal(
    (await r.startInstalled())[0].error,
    "runtime_isolation_unavailable",
    "changed content needs review again",
  );
  assert.equal(r.list().mods[0].runtimeApproved, false);
  await r.shutdown();
  const pref = require("../src/capabilities/mod-platform/packages/mod-startup-preferences")(
    preferenceFile,
  );
  assert.equal(
    pref.hasConsent("example.remember", "a".repeat(64)),
    false,
    "changed content does not inherit consent",
  );
});
