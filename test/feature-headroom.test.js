const test = require("node:test"),
  assert = require("node:assert/strict");
test("first-party headroom tolerates realistic peaks but still stops sustained runaway memory", async () => {
  let clock = 0,
    memory = 340,
    cpu = 0;
  const violations = [],
    monitor = require("../src/capabilities/supervised-runtime/host/resource-monitor")({
      now: () => clock,
      sample: async () => new Map([[42, { memoryBytes: memory * 1024 * 1024, cpuTimeMs: cpu }]]),
      onViolation: async (id, value) => violations.push(value),
    });
  monitor.register("song-request", 42, { resources: { activeRssMiB: 384, idleCpuPercent: 0.75 } });
  for (let i = 0; i < 10; i++) {
    clock += 60000;
    cpu += 400;
    await monitor.sampleOnce();
  }
  assert.equal(violations.length, 0);
  assert.equal(monitor.getStatus().workloads[0].rssBreaches, 0);
  memory = 500;
  for (let i = 0; i < 3; i++) {
    clock += 60000;
    await monitor.sampleOnce();
  }
  assert.equal(violations[0].code, "active_rss_limit");
  monitor.shutdown();
});
test("larger first-party CPU and memory declarations do not expand third-party mod ceilings", () => {
  const feature =
      require("../src/capabilities/feature-platform/contracts/feature-manifest-v1").validateFeatureManifestV1,
    manifest = require("../features/song-request/groby.feature.json");
  assert.equal(feature(manifest).ok, true);
  const limits =
    require("../src/capabilities/supervised-runtime/resource-limits-v1").RESOURCE_LIMITS;
  assert.equal(limits.activeRssMiB[1], 192);
  assert.equal(limits.idleCpuPercent[1], 0.25);
});
