const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const model = require("../public/core/overlay-model"),
  make = require("../src/domains/overlays/stream-overlays.service");
function fixture(t) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "groby-widgets-"));
  let at = 100000,
    owner = "123",
    reads = 0;
  const provider = {
    status: () => ({
      connected: true,
      userId: owner,
      scopes: ["user:read:chat", "channel:read:predictions", "channel:manage:redemptions"],
    }),
    refreshSubscriptions() {},
    overlayPrediction: async () => ({
      ok: true,
      prediction: { title: "Initial prediction", status: "ACTIVE", outcomes: [] },
    }),
  };
  const create = () =>
    make({
      runtimeDir,
      getProvider: () => provider,
      getRecords: () => {
        reads++;
        return { sample: { value: 17 } };
      },
      getSoundboard: async () => [{ name: "Test sound" }],
      now: () => at,
    });
  const service = create();
  t.after(() => {
    service.close();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const save = (widgets) =>
    service.save({
      expectedRevision: service.store.revision(),
      document: { name: "Test scene", widgets: widgets.map((w, i) => ({ id: "w" + i, ...w })) },
    }).documents[0];
  return {
    service,
    save,
    create,
    runtimeDir,
    provider,
    advance: (n) => (at += n),
    account: (v) => (owner = v),
    reads: () => reads,
  };
}
test("only approved additional widget types are implemented and validated", () => {
  for (const type of [
    "prediction",
    "leaderboard",
    "player-card",
    "activity",
    "redemptions",
    "counter",
    "schedule",
    "chat-vote",
    "wheel",
    "bingo",
    "challenge-board",
    "tile-match",
    "soundboard",
  ])
    assert.ok(model.definitions.some((row) => row.type === type));
  for (const type of ["creator-goals", "quotes", "automation-status"])
    assert.throws(() => model.widget({ type }));
  const bingo = model.widget({ type: "bingo", items: ["first", "", "third"] });
  assert.deepEqual(bingo.items, ["first", "", "third"]);
  const schedule = model.widget({
    type: "schedule",
    timezone: "not a zone",
    schedule: [
      { day: 5, time: "12:00", title: "Weekend" },
      { day: 1, time: "19:00", title: "Tuesday" },
    ],
  });
  assert.equal(schedule.timezone, "UTC");
  assert.equal(schedule.schedule[0].title, "Tuesday");
});
test("Tile Match flips a pair, delays mismatches, and saves progress without exposing the shuffle", async (t) => {
  const rules = require("../public/core/overlay-game-rules");
  const widget = model.widget({
    type: "tile-match",
    id: "matching-game",
    matchPairs: [
      { id: "moon", text: "Moon" },
      { id: "sun", text: "Sun" },
    ],
    matchRevealSeconds: 2,
  });
  const flip = (state, cell, now) =>
    rules.control(state, widget, "flip", { cell }, now, (n) => n - 1);
  const first = flip(rules.initial(widget), 1, 100);
  const wrong = flip(first, 2, 200);
  assert.equal(rules.board(widget, wrong, 250).waiting, true);
  assert.throws(() => flip(wrong, 3, 250), /Wait/);
  assert.equal(rules.board(widget, wrong, 2200).cells.filter((cell) => cell.covered).length, 4);
  const match = flip(flip(wrong, 1, 2201), 3, 2202);
  const won = flip(flip(match, 2, 2203), 4, 2204);
  assert.equal(rules.board(widget, won, 2204).won, true);
  assert.equal(rules.board(widget, won, 2204).attempts, 3);
  const { service, save, create } = fixture(t);
  const doc = save([widget]);
  const id = doc.widgets[0].id;
  service.execute("overlay.game.flip", { widget: doc.id + "/" + id, cell: 1 });
  const state = (await service.data()).games[doc.id][id];
  assert.equal(state.matchOrder, undefined);
  assert.deepEqual(Object.keys(state.matchFaces), ["0"]);
  const reloaded = create();
  t.after(() => reloaded.close());
  assert.equal(
    reloaded.bingoDeck({ documentId: doc.id, widgetId: id }).board.cells[0].covered,
    false,
  );
});
test("large Bingo marks and freeform tile IDs survive reloads and layout edits", async (t) => {
  const { service, save, create } = fixture(t);
  const doc = save([
    { type: "bingo", id: "bingo", gridSize: 12, gridRows: 10, bingoPatterns: ["all"] },
    {
      type: "challenge-board",
      id: "challenge",
      tiles: [
        { id: "one", text: "One" },
        { id: "two", text: "Two", x: 55, y: 12, width: 30, height: 40, rotation: -15 },
      ],
    },
  ]);
  const mark = (widgetId, cell) =>
    service.execute("overlay.game.mark", { widget: doc.id + "/" + widgetId, cell });
  const markAction = service.actionCatalog().find((row) => row.id === "overlay.game.mark");
  assert.ok(markAction.parameters.properties.cell.maximum >= 120);
  for (let i = 1; i <= 120; i++) mark("bingo", i);
  mark("challenge", 2);
  const board = service.bingoDeck({ documentId: doc.id, widgetId: "bingo" }).board;
  assert.equal(board.cells.length, 120);
  assert.equal(board.won, true);
  assert.ok((await service.data()).games[doc.id].bingo.bingoAt);
  const edited = service.store.get(doc.id);
  edited.widgets[1].tiles.reverse();
  edited.widgets[1].tiles[0].width = 45;
  service.save({ document: edited, expectedRevision: service.store.revision() });
  const fresh = create();
  t.after(() => fresh.close());
  assert.equal(
    fresh.bingoDeck({ documentId: doc.id, widgetId: "bingo" }).board.cells[119].marked,
    true,
  );
  const challenge = fresh.bingoDeck({ documentId: doc.id, widgetId: "challenge" }).board;
  assert.equal(challenge.freeform, true);
  assert.deepEqual(
    challenge.cells.map(({ id, marked, width }) => [id, marked, width]),
    [
      ["two", true, 45],
      ["one", false, 25],
    ],
  );
});
test("wheel rules share a saved result, remove one selected entry, and reject overlapping spins without mutations", (t) => {
  const f = fixture(t),
    doc = f.save([
      { type: "wheel", items: ["Alice", "Bob", "Carol"], spinSeconds: 1, removeWinner: true },
    ]);
  const control = (operation) =>
    f.service.gameControl({ documentId: doc.id, widgetId: "w0", operation });
  control("spin");
  return (async () => {
    const first = (await f.service.data()).games[doc.id].w0;
    assert.ok(first.entries.includes(first.winner));
    assert.throws(() => control("spin"), /finish/);
    f.advance(1100);
    control("spin");
    const second = (await f.service.data()).games[doc.id].w0;
    assert.equal(second.entries.length, 2);
    assert.ok(!second.entries.includes(first.winner));
    const restarted = f.create();
    t.after(() => restarted.close());
    assert.equal((await restarted.data()).games[doc.id].w0.winner, second.winner);
    control("reset");
    assert.equal((await f.service.data()).games[doc.id].w0.entries.length, 3);
  })();
});
test("chat voting deduplicates users, excludes app replies, expires, persists and isolates accounts", async (t) => {
  const f = fixture(t),
    doc = f.save([{ type: "chat-vote", items: ["A", "B"], duration: 10 }]);
  f.service.gameControl({ documentId: doc.id, widgetId: "w0", operation: "start" });
  const receive = (id, message, isAppMessage = false) =>
    f.service.receive(
      "channel.chat.message",
      { broadcaster_user_id: "123", chatter_user_id: id, message: { text: message } },
      { isAppMessage },
    );
  receive("999", "!vote 2");
  receive("999", "!vote 1");
  receive("998", "!vote 1", true);
  receive("997", "!vote 7");
  let state = (await f.service.data()).games[doc.id].w0;
  assert.deepEqual(state.counts, [0, 1]);
  assert.equal(state.votes, undefined);
  assert.equal(state.owner, undefined);
  f.service.close();
  const restarted = f.create();
  t.after(() => restarted.close());
  assert.deepEqual((await restarted.data()).games[doc.id].w0.counts, [0, 1]);
  f.advance(10001);
  receive("996", "!vote 1");
  state = (await f.service.data()).games[doc.id].w0;
  assert.equal(state.open, false);
  assert.deepEqual(state.counts, [0, 1]);
  f.account("456");
  state = (await f.service.data()).games[doc.id].w0;
  assert.deepEqual(state.counts, [0, 0]);
});
test("bingo and wheel controls use the standard action catalog and do not run on save", async (t) => {
  const f = fixture(t),
    doc = f.save([{ type: "bingo", gridSize: 3 }, { type: "wheel" }]);
  assert.equal(fs.existsSync(path.join(f.runtimeDir, "system", "overlay-games.json")), false);
  const action = f.service.actionCatalog().find((row) => row.id === "overlay.game.mark");
  assert.ok(action.available);
  assert.ok(
    !f.service
      .actionCatalog()
      .some((row) => row.id === "overlay.game.collect" || row.id === "overlay.game.start"),
  );
  assert.ok(action.parameters.properties.widget.enum.includes(doc.id + "/w0"));
  f.service.execute(action.id, { widget: doc.id + "/w0", cell: 1 });
  assert.deepEqual((await f.service.data()).games[doc.id].w0.marks, [0]);
  assert.throws(() => f.service.execute("overlay.game.spin", { widget: doc.id + "/w0" }), /Choose/);
  assert.throws(
    () =>
      f.service.gameControl({ documentId: doc.id, widgetId: "w0", operation: "mark", cell: 99 }),
    /square/,
  );
});
test("record and soundboard feeds share a lazy cache; prediction interests use official events", async (t) => {
  const f = fixture(t);
  f.save([
    { type: "prediction" },
    { type: "counter" },
    { type: "soundboard" },
    { type: "redemptions" },
  ]);
  const result = await Promise.all(Array.from({ length: 20 }, () => f.service.data()));
  assert.equal(f.reads(), 1);
  assert.equal(result[0].records.sample.value, 17);
  assert.equal(result[0].soundboard[0].name, "Test sound");
  assert.equal(result[0].twitch.prediction.prediction.title, "Initial prediction");
  for (const suffix of ["begin", "progress", "lock", "end"])
    assert.ok(f.service.events().includes("channel.prediction." + suffix));
  assert.ok(f.service.events().includes("channel.channel_points_custom_reward_redemption.update"));
  f.service.receive("channel.prediction.end", {
    id: "p1",
    title: "Result",
    status: "resolved",
    winning_outcome_id: "yes",
    outcomes: [
      {
        id: "yes",
        title: "Yes",
        channel_points: 42,
        users: 3,
        top_predictors: [{ user_id: "private" }],
      },
    ],
  });
  const data = await f.service.data();
  assert.equal(data.prediction.status, "RESOLVED");
  assert.doesNotMatch(JSON.stringify(data), /top_predictors|private/);
});
test("record widgets read real generic stats without running or modifying commands", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-record-widget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const counterOwner = require("../src/domains/twitch/command-counters")(
      path.join(root, "counters.json"),
    ),
    c = counterOwner("123");
  c("player alice xp", "set", 75);
  c("player bob xp", "set", 25);
  c("deaths", "set", 9);
  const widgets = [
    model.widget({ type: "counter", counterName: "deaths" }),
    model.widget({ type: "leaderboard", statField: "xp" }),
    model.widget({ type: "player-card", player: "@Alice", items: ["xp", "wins"] }),
  ];
  const records = require("../src/domains/twitch/overlay-command-records")({
    widgets,
    owner: "123",
    counterOwner,
    community: {},
  });
  assert.equal(records[model.recordKey(widgets[0])].value, 9);
  assert.deepEqual(records[model.recordKey(widgets[1])].entries, [
    { player: "alice", value: 75 },
    { player: "bob", value: 25 },
  ]);
  assert.equal(records[model.recordKey(widgets[2])].entries[0].value, 75);
  assert.equal(c("deaths", "get"), 9);
  assert.deepEqual(
    require("../src/domains/twitch/overlay-command-records")({
      widgets,
      owner: "456",
      counterOwner,
      community: {},
    })[model.recordKey(widgets[1])].entries,
    [],
  );
});
test("redemption backfill respects ownership, ignores stale network results and never projects viewer input", async () => {
  let time = 1;
  const feed = require("../src/domains/overlays/overlay-redemptions")(() => time);
  feed.reset("123");
  let resolve;
  const p = feed.refresh({
    listRewards: async () => ({ ok: true, rewards: [{ id: "reward", manageable: true }] }),
    overlayRedemptions: () => new Promise((r) => (resolve = r)),
  });
  await new Promise((r) => setImmediate(r));
  const event = {
    id: "r1",
    broadcaster_user_id: "123",
    reward: { id: "reward", title: "Test", cost: 100 },
    status: "UNFULFILLED",
    user_name: "Alice",
    user_input: "secret",
  };
  feed.receive("channel.channel_points_custom_reward_redemption.add", event);
  resolve({ ok: true, entries: [], truncated: false });
  await p;
  assert.equal(feed.snapshot().entries.length, 1);
  assert.doesNotMatch(JSON.stringify(feed.snapshot()), /secret|user_input/);
  time++;
  feed.receive("channel.channel_points_custom_reward_redemption.update", {
    ...event,
    status: "FULFILLED",
  });
  assert.equal(feed.snapshot().entries.length, 0);
  feed.reset("456");
  feed.receive("channel.channel_points_custom_reward_redemption.add", event);
  assert.equal(feed.snapshot().entries.length, 0);
});
test("Twitch widget APIs use read-only endpoints and strip private payloads", async () => {
  const calls = [],
    api = require("../src/capabilities/feature-platform/providers/twitch-overlay-api")({
      base: "https://api.twitch.tv/helix",
      text: (v, n) => String(v || "").slice(0, n),
      request: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          body: {
            data: url.includes("predictions")
              ? [
                  {
                    id: "p",
                    title: "Win?",
                    status: "ACTIVE",
                    outcomes: [
                      {
                        id: "a",
                        title: "Yes",
                        channel_points: 5,
                        users: 1,
                        top_predictors: [{ user_id: "private" }],
                      },
                    ],
                  },
                ]
              : [
                  {
                    id: "r",
                    user_name: "Alice",
                    user_input: "private",
                    reward: { id: "reward", title: "Test", cost: 10 },
                  },
                ],
          },
        };
      },
    });
  const credentials = { userId: "123", clientId: "client", accessToken: "token" };
  assert.equal((await api.overlayPrediction({ credentials })).prediction.outcomes[0].points, 5);
  const queue = await api.overlayRedemptions({ credentials, rewardId: "reward" });
  assert.equal(queue.entries[0].name, "Alice");
  assert.doesNotMatch(JSON.stringify(queue), /private|token|user_input/);
  assert.ok(calls.every((row) => row.init.method === undefined));
  assert.match(calls[1].url, /status=UNFULFILLED/);
});

test("wheel chat entries are unique, stop when spinning, and do not expose voter identities", async (t) => {
  const f = fixture(t),
    doc = f.save([{ type: "wheel", entrySource: "chat", joinCommand: "!join" }]);
  const control = (operation) =>
    f.service.gameControl({ documentId: doc.id, widgetId: "w0", operation });
  control("collect");
  const join = (id, name, bot = false) =>
    f.service.receive(
      "channel.chat.message",
      {
        broadcaster_user_id: "123",
        chatter_user_id: id,
        chatter_user_login: name,
        message: { text: "!join" },
      },
      { isAppMessage: bot },
    );
  join("991", "alice");
  join("991", "alice");
  join("992", "bot", true);
  join("993", "bob");
  let game = (await f.service.data()).games[doc.id].w0;
  assert.deepEqual(game.entries, ["alice", "bob"]);
  assert.equal(game.entrants, undefined);
  control("spin");
  join("994", "carol");
  game = (await f.service.data()).games[doc.id].w0;
  assert.deepEqual(game.entries, ["alice", "bob"]);
  assert.equal(game.collecting, false);
  f.account("456");
  game = (await f.service.data()).games[doc.id].w0;
  assert.deepEqual(game.entries, []);
  assert.equal(game.winner, "");
});

test("watchtime and points leaderboards use existing disk records and include pending amounts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-watchtime-board-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = require("../src/domains/twitch/community-store")(path.join(root, "community.json"));
  Object.assign(store.viewer("123", "alice"), {
    minutes: 70,
    importedMinutes: 50,
    points: 100,
    importedPoints: 25,
  });
  Object.assign(store.viewer("123", "bob"), { minutes: 30, points: 200 });
  store.flush();
  assert.deepEqual(
    store.leaders("123", "watchtime", 5).map((row) => ({ ...row })),
    [
      { player: "alice", value: 120 },
      { player: "bob", value: 30 },
    ],
  );
  assert.equal(store.leaders("123", "points", 1)[0].player, "bob");
  assert.deepEqual(store.leaders("456", "watchtime", 5), []);
  assert.equal(store.count("123"), 2);
});

test("soundboard presentation retains a short sound name without replaying or exposing file paths", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-sound-cue-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = require("../src/domains/control-deck/soundboard.service")({
    rootDir: root,
    platform: "win32",
    request: async (op) =>
      op === "soundboard.play"
        ? { ok: true, durationSeconds: 0.001 }
        : { available: true, outputs: [], playing: [] },
  });
  const file = Buffer.alloc(44);
  file.write("RIFF", 0);
  file.write("WAVE", 8);
  const clip = await service.library.upload(
    require("node:stream").Readable.from([file]),
    "Short cue",
  );
  await service.execute("native.soundboard.play", { clip: clip.id, outputs: ["default"] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await service.refresh(true);
  const view = service.presentation();
  assert.equal(view[0].name, "Short cue");
  assert.equal(view[0].playing, false);
  assert.equal(typeof view[0].at, "number");
  assert.doesNotMatch(JSON.stringify(view), /file|wav|runtime|outputs/);
});
