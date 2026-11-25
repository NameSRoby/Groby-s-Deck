/** Fresh installs, selected request mode and pause admission use independent state. */
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const fixture = require("./support/twitch-automation-fixture.cjs");
const createRouter = require("../src/capabilities/feature-platform/providers/twitch-chat-command-router");
const createPause = require("../src/domains/twitch/intake-pause-policy");
const purposes = ["lights", "teach", "song_request", "add_to_playlist"];

test("setup tracks actual readiness, per-feature skips and completion across restarts", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-setup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let facts = { lights: false, twitch: false, music: false, deck: true, overlays: false };
  const options = { runtimeDir: root, readFacts: async () => facts };
  const create = require("../src/domains/system/setup-progress");
  let setup = create(options),
    state = await setup.snapshot();
  assert.equal(state.features.find((f) => f.id === "lights").done, false);
  assert(!state.completed);
  await setup.update({ action: "skip", feature: "music", revision: state.revision });
  setup = create(options);
  state = await setup.snapshot();
  assert(state.skipped.includes("music"));
  facts = { ...facts, lights: true, twitch: true, overlays: true };
  state = await setup.snapshot();
  assert(state.completed);
  facts = {};
  setup = create(options);
  state = await setup.snapshot();
  assert(state.completed);
  await assert.rejects(
    setup.update({ action: "skip", feature: "music", revision: -1 }),
    /conflict/,
  );
  state = await setup.update({ action: "show", revision: state.revision });
  assert(!state.completed);
  state = await setup.update({ action: "dismiss", revision: state.revision });
  assert((await create(options).snapshot()).dismissed);
  const file = path.join(root, "system/setup-progress.json");
  fs.writeFileSync(file, '{"bad":"account-canary"}');
  setup = create(options);
  assert.equal((await setup.snapshot()).ok, false);
  await assert.rejects(setup.update({ action: "show", revision: 0 }), /unavailable/);
  assert.equal(fs.readFileSync(file, "utf8"), '{"bad":"account-canary"}');
});

test("setup API verifies pairing and companion connection and never returns account or device data", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-setup-http-"));
  const app = require("express")();
  app.use(require("express").json());
  let paired = false,
    configured = false,
    connected = false;
  const registry = {
    list: () => ({
      features: ["song-request", "twitch-integration"].map((id) => ({ id, lifecycle: "active" })),
    }),
    request: async (_id, cap) => ({
      ok: true,
      value:
        cap === "song.player.preferences.v1" ? { player: "spotify", configured } : { connected },
    }),
  };
  require("../src/app/core/register-setup-progress.routes")(app, {
    runtimeDir: root,
    core: {
      fixtureRegistry: {
        getConnectivitySnapshot: () => ({ rows: [{ configured: paired, ip: "device-canary" }] }),
      },
    },
    getRegistry: () => registry,
    getTwitch: () => ({ status: () => ({ connected: true, accessToken: "account-canary" }) }),
    getDeck: () => ({ config: { pages: [] } }),
    getOverlays: () => ({ store: { snapshot: () => ({ documents: [] }) } }),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port + "/api/presentation/setup";
  let state = await fetch(base).then((r) => r.json());
  assert(!JSON.stringify(state).includes("canary"));
  assert(!state.features.find((f) => f.id === "lights").done);
  configured = true;
  state = await fetch(base).then((r) => r.json());
  assert(!state.features.find((f) => f.id === "music").done);
  connected = paired = true;
  state = await fetch(base).then((r) => r.json());
  assert(state.features.find((f) => f.id === "music").done);
  assert(state.features.find((f) => f.id === "lights").done);
  const send = (body, origin) =>
    fetch(base, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await send({ action: "dismiss", revision: state.revision }, "https://foreign.invalid")).status,
    403,
  );
  assert.equal(
    (await send({ action: "skip", feature: "arbitrary", revision: state.revision })).status,
    400,
  );
  assert.equal((await send({ action: "dismiss", revision: state.revision })).status, 200);
});

test("public command recipes validate as inactive editable drafts without publishing messages", async (t) => {
  const f = fixture(t),
    presets = require("../src/domains/twitch/command-presets");
  assert(presets.length >= 25);
  for (const [index, preset] of presets.entries())
    await f.automations.save({
      revision: f.automations.status().revision,
      automation: {
        id: (index + 1).toString(16).padStart(24, "0"),
        name: preset.name,
        enabled: false,
        handler: "flow",
        trigger: { type: "command", command: preset.command },
        steps: [
          { actionId: "twitch.action.chat", params: { message: preset.message }, delayMs: 0 },
        ],
        role: preset.role || "viewer",
        cooldownSeconds: preset.cooldownSeconds || 0,
        userCooldownSeconds: preset.userCooldownSeconds || 0,
      },
    });
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
});

test("public feature controls exist without login or rewards; selected chat wins over a disabled paid rule", async (t) => {
  let paused = false;
  const f = fixture(t, { builtinAvailable: () => true, intakePaused: () => paused });
  f.managedRewards.length = 0;
  assert.deepEqual(
    f.automations
      .status()
      .rows.map((r) => r.handler)
      .sort(),
    [...purposes].sort(),
  );
  const original = f.provider.status;
  f.provider.status = () => ({ ...original(), connected: false });
  assert.equal(f.automations.status().connected, false);
  assert.equal(f.automations.status().rows.length, 4);
  assert.equal(f.automations.builtinPolicy("song_request").chatEnabled, false);
  let selectedChat = false;
  f.provider.status = () => ({
    ...original(),
    monitorConfig: { songRequestChatEnabled: selectedChat },
  });
  assert(purposes.every((p) => f.automations.builtinPolicy(p).chatEnabled));
  const row = f.automations.status().rows.find((r) => r.handler === "song_request");
  const { legacy, ...draft } = row;
  await f.automations.save({ revision: 0, automation: { ...draft, enabled: false } });
  assert.equal(f.automations.builtinPolicy("song_request").chatEnabled, false);
  selectedChat = true;
  assert.equal(f.automations.builtinPolicy("song_request").chatEnabled, true);
  paused = true;
  assert.equal(f.automations.builtinPolicy("song_request").chatEnabled, false);
  await assert.rejects(
    f.automations.remove({ revision: 1, id: row.id }),
    /builtin_preset_required/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
});

test("all fallback command aliases use authenticated requesters and respect pause admission", async () => {
  const sent = [],
    custom = [];
  let paused = false,
    clock = 10000;
  const router = createRouter({
    now: () => clock,
    builtinPolicy: () => ({ chatEnabled: !paused, role: "viewer" }),
    submitSongRequest: async (p) => {
      sent.push(p);
      return { ok: true };
    },
    builtinCommand: async (p) => {
      custom.push(p);
      return { ok: true };
    },
  });
  let seq = 0;
  const event = (text) => ({
    message_id: "public-" + ++seq,
    chatter_user_id: "456",
    chatter_user_name: "Viewer",
    broadcaster_user_id: "123",
    badges: [],
    message: { text },
  });
  for (const text of [
    "!sr artist title",
    "!songrequest artist title",
    "!color blue",
    "!teachcolor ocean #123abc",
    "!addtoplaylist artist song",
  ]) {
    clock += 2000;
    await router.handle(event(text), {});
  }
  assert.equal(sent.length, 2);
  assert.equal(custom.length, 3);
  assert(custom.every((p) => p.requesterId === "456"));
  paused = true;
  for (const text of [
    "!sr more",
    "!color red",
    "!teachcolor red #ff0000",
    "!addtoplaylist other",
  ]) {
    clock += 2000;
    await router.handle(event(text), {});
  }
  assert.equal(sent.length, 2);
  assert.equal(custom.length, 3);
});

test("pause admission persists per account with zero rewards and malformed data stays closed", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-pause-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "intake.json"),
    pause = createPause(file);
  assert(!fs.existsSync(file));
  pause.set("123", "all", true);
  assert(purposes.every((p) => createPause(file).paused("123", p)));
  assert(!pause.paused("456", "all"));
  pause.set("123", "all", false);
  pause.set("123", "song_request", true);
  assert(pause.paused("123", "song_request"));
  assert(!pause.paused("123", "lights"));
  fs.writeFileSync(file, "broken");
  const invalid = createPause(file);
  assert(invalid.paused("123", "song_request"));
  assert.throws(() => invalid.set("123", "all", false), /unavailable/);
  assert.equal(fs.readFileSync(file, "utf8"), "broken");
});

test("reward controls pause chat without rewards, and mode changes cannot clear a global pause", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-admission-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pause = createPause(path.join(root, "pause.json")),
    writes = [],
    rows = [],
    managed = [];
  let queuePaused = false,
    rewardScope = false;
  const provider = {
    status: () => ({ connected: true, userId: "123", managedRewards: managed }),
    listRewards: async () =>
      rewardScope ? { ok: true, rewards: rows } : { ok: false, error: "twitch_scope_missing" },
    setManagedRewardPaused: async (p) => {
      writes.push(p);
      rows[0].paused = p.paused;
      return { ok: true };
    },
  };
  const controls =
    require("../src/capabilities/feature-platform/http/register-dashboard-rewards.routes")(
      require("express")(),
      {
        getProvider: () => provider,
        getBuiltinRows: () => [{ handler: "song_request", trigger: { rewardId: "song" } }],
        intakePause: pause,
        registry: {
          list: () => ({
            features: ["twitch-integration", "song-request"].map((id) => ({
              id,
              lifecycle: "active",
            })),
          }),
          request: async () => ({ ok: true, value: { paused: queuePaused } }),
        },
      },
    );
  assert.equal((await controls.snapshot()).chatControlsAvailable, true);
  await controls.toggle();
  assert(purposes.every((p) => pause.paused("123", p)));
  await controls.toggle();
  assert(!pause.paused("123", "song_request"));
  rewardScope = true;
  rows.push({ id: "song", paused: false, manageable: true, enabled: true });
  managed.push({ rewardId: "song", purpose: "automation:" + "a".repeat(24) });
  assert.equal((await controls.snapshot()).rewards[0].purpose, "song_request");
  await controls.update({ purpose: "all", paused: true });
  const held = await controls.updateChannelPoints({ purpose: "song_request", paused: false });
  assert(held.results[0].held);
  assert(pause.paused("123", "song_request"));
  queuePaused = true;
  assert((await controls.update({ purpose: "all", paused: false })).results[0].held);
  assert(rows[0].paused);
  queuePaused = false;
  await controls.updateChannelPoints({ purpose: "song_request", paused: false });
  assert(!rows[0].paused);
  assert.equal(writes.length, 2);
  assert(writes.every((row) => row.purpose === "automation:" + "a".repeat(24)));
});

test("public deck styles preserve actions and artwork and cannot be deleted", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-style-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profiles = require("../src/domains/control-deck/deck-style-profiles")(root);
  const config = {
    pages: [
      {
        id: "synthetic",
        buttons: [
          {
            id: "a",
            title: "Keep label",
            press: [{ actionId: "song.skip", params: {} }],
            appearance: { color: "#123456", backgroundImage: "synthetic-artwork" },
          },
        ],
      },
    ],
  };
  const applied = profiles.apply({ id: "public-ocean", profileRevision: 0 }, config);
  assert.deepEqual(applied.pages[0].buttons[0].press, config.pages[0].buttons[0].press);
  assert.equal(applied.pages[0].buttons[0].appearance.backgroundImage, "synthetic-artwork");
  assert.notEqual(applied.pages[0].buttons[0].appearance.color, "#123456");
  assert.equal(config.pages[0].buttons[0].appearance.color, "#123456");
  assert.throws(
    () => profiles.remove({ id: "public-ocean", profileRevision: 0 }),
    /public_profile_required/,
  );
  assert(!fs.existsSync(path.join(root, "system", "deck-style-profiles.json")));
});

test("chat playlist and lighting handlers never settle nonexistent Channel Points redemptions", async () => {
  const songs = [],
    colors = [],
    settlements = [];
  const controller =
    require("../src/domains/system/widget-event.controller").createSystemWidgetEventController({
      submitSongRequest: async (p) => {
        songs.push(p);
        return { ok: true };
      },
      colorApply: async (p) => {
        colors.push(p);
        return { body: { ok: true } };
      },
      settleRedemption: async (p) => settlements.push(p),
    });
  for (const purpose of ["add_to_playlist", "lights"])
    await controller.handleChatAction({
      purpose,
      messageId: "chat-1",
      requesterId: "456",
      requesterName: "Viewer",
      input: "Artist Song",
    });
  assert.equal(songs[0].addToPlaylist, true);
  assert.equal(songs[0].requesterName, "Viewer");
  assert.equal(songs[0].rewardRedemption, undefined);
  assert.equal(songs[0].notifyChat, true);
  assert.equal(colors.length, 1);
  assert.equal(settlements.length, 0);
});
