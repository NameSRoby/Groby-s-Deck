const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const createCore = require("../src/app/core/create-core-server");
test("deck HTTP validates saved actions, origins and media without desktop side effects on read", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-deck-http-"));
  let executions = 0;
  const desktopActions = {
    catalog: () => [
      {
        id: "native.test",
        label: "Test",
        symbol: "✦",
        available: true,
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    ],
    execute: async () => {
      executions++;
      return { ok: true };
    },
    integrations: async () => ({ discord: { available: false, muted: null } }),
    shutdown() {},
  };
  const core = createCore({ runtimeDir, dryRun: true, desktopActions });
  const server = await new Promise((resolve) => {
    const s = core.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(async () => {
    await core.services.lifecycle.stopAll();
    await new Promise((r) => server.close(r));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (url, method = "GET", payload, origin) =>
    fetch(base + url, {
      method,
      headers: {
        ...(payload ? { "content-type": "application/json" } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  const first = await (await request("/api/control-deck")).json();
  assert.equal(first.ok, true);
  assert.equal(executions, 0);
  const config = {
    version: 1,
    mode: "deck",
    columns: 4,
    pages: [
      {
        id: "main",
        name: "Main",
        buttons: [
          {
            id: "test",
            title: "Test",
            kind: "macro",
            steps: [{ actionId: "native.test", params: {} }],
          },
        ],
      },
    ],
  };
  assert.equal(
    (
      await request(
        "/api/control-deck",
        "PUT",
        { revision: first.value.revision, value: config },
        "https://untrusted.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/control-deck", "PUT", { revision: first.value.revision, value: config }))
      .status,
    200,
  );
  assert.equal(executions, 0, "editing never executes a button");
  assert.equal(
    (
      await request("/api/control-deck/buttons/test/execute", "POST", {
        trigger: "press",
        actionId: "native.open",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/api/control-deck/buttons/test/execute", "POST", { trigger: "press" })).status,
    200,
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(executions, 1);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const uploaded = await (
    await fetch(base + "/api/control-deck/media", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: png,
    })
  ).json();
  assert.equal(uploaded.ok, true);
  const downloaded = await fetch(base + uploaded.value.url);
  assert.equal(downloaded.headers.get("content-type"), "image/png");
  assert.match(downloaded.headers.get("cache-control"), /private.*immutable/);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
  const invalid = await fetch(base + "/api/control-deck/media", {
    method: "POST",
    headers: { "content-type": "image/svg+xml" },
    body: "<svg/>",
  });
  assert.equal(invalid.status, 400);
});

test("default source profile discovers the example mod without granting or executing it", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-deck-default-"));
  const featuresRoot = path.join(runtimeDir, "empty-features");
  fs.mkdirSync(featuresRoot);
  const desktopActions = {
    catalog: () => [],
    execute: async () => {
      throw Error("unexpected desktop mutation");
    },
    shutdown() {},
  };
  const core = createCore({
    runtimeDir,
    rootDir: path.resolve(__dirname, ".."),
    dryRun: true,
    desktopActions,
    capabilities: { features: true },
    extend: require("../src/app/optional/create-default-platform-extension")({
      rootDir: path.resolve(__dirname, ".."),
      featuresRoot,
    }),
  });
  t.after(async () => {
    await core.services.lifecycle.stopAll();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  await core.extension.startup;
  const mods = core.extension.mods.registry.list().mods;
  assert.deepEqual(
    mods.filter((m) => m.lifecycle === "active").map((m) => m.id),
    [],
  );
  assert.ok(
    core.extension.mods.inbox.list().candidates.some((row) => row.id === "groby.twitch-clips"),
  );
  assert(!mods.some((m) => m.id === "ravelink.discord-controls" && m.enabled));
});
