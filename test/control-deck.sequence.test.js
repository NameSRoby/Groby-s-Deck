const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const create = require("../src/domains/control-deck/control-deck.service"),
  { validate } = require("../src/domains/control-deck/control-deck-config");
const action = (name) => ({ actionId: "test." + name, params: {}, delayMs: 0 });
const wait = (ms) => ({ actionId: "deck.wait", params: { durationMs: ms }, delayMs: 0 });
function fixture(t, steps, extra = {}) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-sequence-")),
    calls = [];
  let available = true;
  const deck = create({
    runtimeDir,
    actions: {
      catalog: () =>
        ["on", "off", "fail"].map((name) => ({
          id: "test." + name,
          available,
          parameters: { type: "object", additionalProperties: false, properties: {} },
        })),
      execute: async (name) => {
        calls.push(name);
        return { ok: name !== "test.fail" };
      },
    },
  });
  deck.save(
    {
      version: 1,
      mode: "deck",
      columns: 4,
      pages: [
        {
          id: "main",
          name: "Main",
          buttons: [{ id: "timed", title: "Timed", kind: "macro", steps, ...extra }],
        },
      ],
    },
    0,
  );
  t.after(async () => {
    await deck.shutdown();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  return { deck, calls, revoke: () => (available = false) };
}
async function until(fn) {
  const deadline = Date.now() + 2000;
  while (!fn()) {
    if (Date.now() > deadline) assert.fail("sequence did not reach expected state");
    await new Promise((r) => setTimeout(r, 5));
  }
}
test("timed action, wait and finish run in order for every repetition with no browser owner", async (t) => {
  const { deck, calls } = fixture(t, [action("on"), wait(35), action("off")], { repeatCount: 3 });
  deck.execute("timed");
  await until(() => deck.snapshot().running[0]?.phase === "waiting");
  assert.deepEqual(calls, ["test.on"]);
  assert(deck.snapshot().running[0].waitUntil > Date.now());
  await until(() => !deck.snapshot().running.length);
  assert.deepEqual(calls, ["test.on", "test.off", "test.on", "test.off", "test.on", "test.off"]);
  assert.equal(deck.snapshot().states.timed.lastResult.ok, true);
});
test("wait-first sequences and day-long waits stop immediately on a second press", async (t) => {
  const { deck, calls } = fixture(t, [wait(86400000), action("on")], {
    cancelOnPress: true,
    repeatCount: 10,
  });
  const run = deck.execute("timed");
  await until(() => deck.snapshot().running[0]?.phase === "waiting");
  assert.deepEqual(calls, []);
  assert.equal(deck.execute("timed").cancelled, true);
  await until(() => !deck.snapshot().running.length);
  assert.equal(deck.snapshot().states.timed.lastResult.code, "control_deck_cancelled");
  assert.deepEqual(calls, []);
  assert.equal(deck.cancel(run.runId).cancelled, 0);
});
test("failure and revoked permissions stop a timed sequence before later actions", async (t) => {
  const first = fixture(t, [action("on"), action("fail"), action("off")], { repeatCount: 3 });
  first.deck.execute("timed");
  await until(() => !first.deck.snapshot().running.length);
  assert.deepEqual(first.calls, ["test.on", "test.fail"]);
  const second = fixture(t, [action("on"), wait(40), action("off")]);
  second.deck.execute("timed");
  await until(() => second.deck.snapshot().running[0]?.phase === "waiting");
  second.revoke();
  await until(() => !second.deck.snapshot().running.length);
  assert.deepEqual(second.calls, ["test.on"]);
  assert.equal(
    second.deck.snapshot().states.timed.lastResult.code,
    "control_deck_action_unavailable",
  );
});
test("long chains have no sixteen-step cutoff and repeat cancellation yields to Core", async (t) => {
  const { deck, calls } = fixture(
    t,
    Array.from({ length: 80 }, () => action("on")),
    { repeatCount: 1000 },
  );
  deck.execute("timed");
  await new Promise(setImmediate);
  deck.cancel();
  await until(() => !deck.snapshot().running.length);
  assert(calls.length > 0 && calls.length < 80000);
  const config = deck.snapshot().config;
  config.pages[0].buttons[0].steps = [wait(60000), wait(60000), action("off")];
  assert.equal(validate(config).pages[0].buttons[0].steps.length, 3);
  config.pages[0].buttons[0].repeatCount = 1001;
  assert.throws(() => validate(config), /sequence_invalid/);
});
test("invalid timer data never reaches an action and shutdown cancels outstanding waits", async (t) => {
  const { deck, calls } = fixture(t, [wait(-1), action("on")]);
  assert.throws(() => deck.execute("timed"), /parameters_invalid/);
  assert.deepEqual(calls, []);
  const config = deck.snapshot().config;
  config.pages[0].buttons[0].steps = [wait(86400000), action("off")];
  deck.save(config, 1);
  deck.execute("timed");
  await until(() => deck.snapshot().running[0]?.phase === "waiting");
  await deck.shutdown();
  assert.equal(deck.snapshot().running.length, 0);
  assert.deepEqual(calls, []);
});
