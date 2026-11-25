const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
test("the supervised Twitch worker carries a large shared action catalog and enforces automation contracts", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-twitch-ipc-"));
  fs.cpSync(
    path.join(__dirname, "../features/twitch-integration"),
    path.join(root, "installed/twitch-integration"),
    { recursive: true },
  );
  const actions = Array.from({ length: 500 }, (_, index) => ({
    id: "fixture.action." + index,
    label: "Synthetic studio control " + index,
    description: "Available synthetic control for large-catalog transport.",
    group: "Fixture",
    available: true,
    parameters: { type: "object", additionalProperties: false, properties: {} },
    defaults: {},
  }));
  let oversized = false;
  const registry = require("../src/capabilities/feature-platform/host/feature-host-registry")({
    featuresRoot: path.join(root, "installed"),
    runtimeRoot: path.join(root, "runtime"),
    allowUnsafeRuntime: true,
    providers: {
      "twitch.host.v1/automation-catalog": () => ({
        ok: true,
        actions: oversized ? [...actions, ...actions, ...actions, ...actions, ...actions] : actions,
      }),
      "twitch.host.v1/automation-preview": async (input) => ({
        ok: true,
        text: await require("../src/domains/twitch/command-template").render(input.template, {
          context: { sender: "hero", argv: ["rival"] },
          counter: require("../src/domains/twitch/command-counters")(
            path.join(root, "preview-counters.json"),
          )("owner", true, true),
          random: () => 0.99,
        }),
      }),
      "twitch.host.v1/automation-control": (input) => ({ ok: true, operation: input.operation }),
      "twitch.host.v1/automation-community-tracking": ({ mode }) => ({ ok: true, mode }),
      "twitch.host.v1/automation-community-quotes": ({ enabled }) => ({ ok: true, enabled }),
    },
  });
  t.after(async () => {
    await registry.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const started = await registry.startInstalled();
  assert.equal(started[0].lifecycle, "active", JSON.stringify(started));
  assert.ok(Buffer.byteLength(JSON.stringify(actions)) > 65536);
  const catalog = await registry.request(
    "twitch-integration",
    "twitch.automations.v1",
    "catalog",
    {},
  );
  assert.equal(catalog.ok, true, JSON.stringify(catalog.error));
  assert.equal(catalog.value.actions.length, 500);
  const variablePreview = await registry.request(
    "twitch-integration",
    "twitch.automations.v1",
    "preview",
    {
      template: "${set roll random.1-20}${sender} rolled ${roll}!",
      arguments: "",
    },
  );
  assert.equal(variablePreview.value.text.trim(), "hero rolled 20!");
  const arena = require("../src/domains/twitch/command-arena-variables").message;
  assert.ok(arena.length > 4096, "exercise a real complex command beyond the old preview cap");
  const arenaPreview = await registry.request(
    "twitch-integration",
    "twitch.automations.v1",
    "preview",
    { template: arena, arguments: "rival" },
  );
  assert.equal(arenaPreview.ok, true, JSON.stringify(arenaPreview.error));
  assert.match(arenaPreview.value.text, /NEED:.*ROLLED:.*RESULT:/);
  assert.equal(fs.existsSync(path.join(root, "preview-counters.json")), false);

  let peak = 0;
  for (let batch = 0; batch < 3; batch++) {
    for (let i = 0; i < 8; i++) {
      const result = await registry.request(
        "twitch-integration",
        "twitch.automations.v1",
        "catalog",
        {},
      );
      assert.equal(result.ok, true);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (process.platform === "win32") {
      const sampled =
        await require("../src/capabilities/supervised-runtime/host/resource-monitor").sampleWindowsProcesses(
          [started[0].pid],
        );
      peak = Math.max(peak, (sampled.get(started[0].pid)?.memoryBytes || 0) / 1024 / 1024);
    }
  }
  if (process.platform === "win32") {
    assert.ok(peak > 0);
    assert.ok(
      peak < 256,
      "worker stays below its memory budget under repeated large catalog requests",
    );
    t.diagnostic(
      "Synthetic Twitch catalog load: observed peak RSS " + peak.toFixed(1) + " MiB of 256 MiB",
    );
  }
  oversized = true;
  const tooLarge = await registry.request(
    "twitch-integration",
    "twitch.automations.v1",
    "catalog",
    {},
  );
  assert.equal(tooLarge.ok, false);
  assert.notEqual(tooLarge.error.code, "request_timeout");
  assert.equal(registry.list().features[0].lifecycle, "active");
  const invalid = await registry.request("twitch-integration", "twitch.automations.v1", "control", {
    id: "a".repeat(24),
    operation: "erase-everything",
  });
  assert.equal(invalid.error.code, "request_schema_invalid");
  const valid = await registry.request("twitch-integration", "twitch.automations.v1", "control", {
    id: "a".repeat(24),
    operation: "pause",
  });
  assert.equal(valid.value.operation, "pause");
  for (const [method, payload] of [
    ["community-tracking", { mode: "off" }],
    ["community-quotes", { operation: "settings", enabled: false }],
  ]) {
    const result = await registry.request(
      "twitch-integration",
      "twitch.automations.v1",
      method,
      payload,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(
      result.value[method === "community-tracking" ? "mode" : "enabled"],
      payload.mode ?? payload.enabled,
    );
  }
});
