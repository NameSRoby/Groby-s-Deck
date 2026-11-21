const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
test("intake automatically prefers installed active Twitch, preserves widget override and forces fallback without Twitch", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-intake-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let active = true,
    config = { intakeMode: "streamelements", songRequestChatEnabled: false };
  const provider = {
    status: () => ({ connected: true, monitorConfig: config }),
    configureMonitor: async (next) => {
      config = { ...config, ...next };
    },
  };
  const service = require("../src/domains/twitch/request-intake-settings")({
    file: path.join(root, "intake.json"),
    provider: () => provider,
    registry: () => ({
      list: () => ({
        features: [
          { id: "twitch-integration", lifecycle: active ? "active" : "installed-disabled" },
        ],
      }),
    }),
  });
  assert.equal((await service.configure({})).effectiveSource, "native");
  assert.equal(config.intakeMode, "native");
  await service.configure({ source: "streamelements" });
  assert.equal(config.intakeMode, "streamelements");
  await service.configure({ source: "auto", songRequestChatEnabled: true });
  assert.equal(config.songRequestChatEnabled, true);
  active = false;
  await service.configure({});
  assert.equal(config.intakeMode, "streamelements");
  assert.equal(config.songRequestChatEnabled, false);
  await assert.rejects(service.configure({ source: "bad" }), /Invalid/);
});
test("chat commands can require live streams or explicitly remain available offline", async (t) => {
  const fixture = require("./support/twitch-automation-fixture.cjs"),
    f = fixture(t);
  let live = false;
  f.provider.dashboardStream = async () => ({ ok: true, live });
  const row = fixture.flow("b".repeat(24), {
    type: "command",
    command: "!example",
    onlyLive: true,
  });
  await f.automations.save({ revision: 0, automation: row });
  const event = {
    broadcaster_user_id: "123",
    chatter_user_id: "viewer",
    chatter_user_login: "viewer",
    badges: [],
    message_id: "offline",
    message: { text: "!example" },
  };
  assert.equal((await f.automations.chat(event)).code, "twitch_automation_live_required");
  assert.equal(f.calls.length, 0);
  live = true;
  const liveService = require("../src/domains/twitch/twitch-automations.service")(f.options);
  t.after(() => liveService.shutdown());
  assert.equal((await liveService.chat({ ...event, message_id: "live" })).accepted, true);
  await fixture.until(() => liveService.status().running.length === 0);
  row.trigger.onlyLive = false;
  await f.automations.save({ revision: 1, automation: row });
  live = false;
  const reopened = require("../src/domains/twitch/twitch-automations.service")(f.options);
  t.after(() => reopened.shutdown());
  assert.equal((await reopened.chat({ ...event, message_id: "allowed-offline" })).accepted, true);
  await fixture.until(() => reopened.status().running.length === 0);
});
