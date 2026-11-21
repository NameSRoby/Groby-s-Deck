const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const create = require("../src/domains/control-deck/control-deck.service");
const step = (id) => ({ actionId: id, params: {}, delayMs: 0 }),
  wait = (ms) => ({ actionId: "deck.wait", params: { durationMs: ms }, delayMs: 0 });
const rule = (field = "active", value = true, operator = "equals") => ({
  actionId: "owner.state",
  field,
  value,
  operator,
});
const branch = (condition, yes, no = []) => ({ type: "if", condition, then: yes, else: no });
async function until(fn) {
  const end = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > end) assert.fail("Flow did not settle");
    await new Promise((r) => setTimeout(r, 4));
  }
}
function fixture(t, steps, { state = false, execute, refresh } = {}) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-flow-")),
    calls = [];
  const owner = { state, available: true };
  const actions = {
    catalog: () => [
      {
        id: "owner.state",
        state: owner.state,
        available: owner.available,
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
      ...["a", "b", "c", "fail"].map((id) => ({
        id,
        available: true,
        parameters: { type: "object", properties: {}, additionalProperties: false },
      })),
    ],
    refreshLive: async () => refresh?.(owner),
    execute: async (id, params, signal) => {
      calls.push(id);
      return execute ? execute(id, signal) : { ok: id !== "fail" };
    },
  };
  const deck = create({ runtimeDir, actions });
  const config = {
    version: 1,
    mode: "deck",
    columns: 4,
    pages: [
      {
        id: "main",
        name: "Main",
        buttons: [{ id: "flow", title: "Flow", kind: "macro", steps, cancelOnPress: true }],
      },
    ],
  };
  deck.save(config, 0);
  t.after(async () => {
    await deck.shutdown();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  return { deck, owner, calls, config };
}
test("If selects one branch from fresh confirmed state; later conditions see changed state", async (t) => {
  let reads = 0;
  const f = fixture(
    t,
    [branch(rule(), [step("a")], [step("b")]), wait(5), branch(rule(), [step("a")], [step("c")])],
    {
      refresh: (owner) => {
        owner.state = ++reads === 1;
      },
    },
  );
  f.deck.execute("flow");
  await until(() => !f.deck.snapshot().running.length);
  assert.deepEqual(f.calls, ["a", "c"]);
  assert.equal(reads, 2);
  assert.equal(f.deck.snapshot().states.flow.lastResult.ok, true);
});
test("unavailable condition source can take Otherwise without requiring its unavailable branch", async (t) => {
  const f = fixture(t, [branch(rule("available"), [step("missing")], [step("b"), step("c")])]);
  f.owner.available = false;
  f.deck.execute("flow");
  await until(() => !f.deck.snapshot().running.length);
  assert.deepEqual(f.calls, ["b", "c"]);
});
test("unknown feedback and type mismatches stop instead of treating unknown as false", async (t) => {
  for (const state of [null, { active: false, tone: "unknown" }, { value: "12" }]) {
    const f = fixture(
      t,
      [
        branch(
          rule(state?.value ? "value" : "active", state?.value ? 12 : true),
          [step("a")],
          [step("b")],
        ),
        step("c"),
      ],
      { state },
    );
    f.deck.execute("flow");
    await until(() => !f.deck.snapshot().running.length);
    assert.deepEqual(f.calls, []);
    assert.equal(
      f.deck.snapshot().states.flow.lastResult.code,
      "control_deck_condition_unavailable",
    );
  }
});
test("numeric and status comparisons use typed fields and do not coerce strings", async (t) => {
  const f = fixture(
    t,
    [
      branch(rule("value", 40, "greater"), [step("a")]),
      branch(rule("status", "playing"), [step("b")]),
    ],
    { state: { value: 55, status: "playing" } },
  );
  f.deck.execute("flow");
  await until(() => !f.deck.snapshot().running.length);
  assert.deepEqual(f.calls, ["a", "b"]);
});
test("Together starts independent actions before either completes and waits before continuing", async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const f = fixture(t, [{ type: "parallel", steps: [step("a"), step("b")] }, step("c")], {
    execute: async (id) => {
      if (id !== "c") await gate;
      return { ok: true };
    },
  });
  t.after(() => release());
  f.deck.execute("flow");
  await until(() => f.calls.length === 2);
  assert.deepEqual(f.calls, ["a", "b"]);
  release();
  await until(() => !f.deck.snapshot().running.length);
  assert.deepEqual(f.calls, ["a", "b", "c"]);
});
test("Together failure aborts sibling waits and never executes the following step", async (t) => {
  const f = fixture(t, [
    {
      type: "parallel",
      steps: [step("fail"), { type: "repeat", count: 10, steps: [wait(86400000), step("a")] }],
    },
    step("c"),
  ]);
  f.deck.execute("flow");
  await until(() => !f.deck.snapshot().running.length);
  assert.deepEqual(f.calls, ["fail"]);
  assert.equal(f.deck.snapshot().states.flow.lastResult.ok, false);
});
test("a sequence inside Together keeps its own order while other actions can proceed", async (t) => {
  const f = fixture(t, [
    {
      type: "parallel",
      steps: [{ type: "sequence", steps: [step("a"), wait(20), step("b")] }, step("c")],
    },
    step("c"),
  ]);
  f.deck.execute("flow");
  await until(() => !f.deck.snapshot().running.length);
  assert.deepEqual(f.calls, ["a", "c", "b", "c"]);
});
test("condition reader refreshes the selected owner and rejects a result racing a write", async () => {
  const rows = [
      { id: "mod:demo:toggle", available: true, state: { active: false } },
      { id: "obs:demo", available: true, state: { active: false } },
    ],
    epochs = new Map();
  let changedDuringRead = false,
    reads = 0,
    otherReads = 0;
  const reader = require("../src/domains/control-deck/deck-condition-state")({
    catalog: () => rows,
    feedbackEpoch: epochs,
    fault: (code) => Object.assign(Error(code), { code }),
    getMods: () => ({
      readActionState: async (mod, id) => {
        assert.equal(mod, "demo");
        assert.equal(id, "toggle");
        reads++;
        if (changedDuringRead) epochs.set("mod:demo:toggle", 1);
        return { ok: true, value: { feedback: { active: true } } };
      },
    }),
    rememberFeedback: (id, result) =>
      (rows.find((row) => row.id === id).state = result.value.feedback),
    obs: {
      refresh: async (force) => {
        assert.equal(force, true);
        rows[1].state.active = true;
      },
    },
    desktop: { refresh: async () => otherReads++ },
    refreshSong: async () => otherReads++,
  });
  assert.equal((await reader({ actionId: "mod:demo:toggle", field: "active" })).state.active, true);
  assert.equal((await reader({ actionId: "obs:demo", field: "active" })).state.active, true);
  assert.equal(reads, 1);
  assert.equal(otherReads, 0);
  changedDuringRead = true;
  await assert.rejects(
    reader({ actionId: "mod:demo:toggle", field: "active" }),
    /condition_unavailable/,
  );
});
test("Repeat nests actions and waits; a second press cancels a waiting branch", async (t) => {
  const f = fixture(t, [
    { type: "repeat", count: 3, steps: [step("a"), wait(2), step("b")] },
    branch(rule(), [step("c")], [wait(86400000), step("c")]),
  ]);
  f.deck.execute("flow");
  await until(() => f.calls.length === 6 && f.deck.snapshot().running[0]?.phase === "waiting");
  assert.deepEqual(f.calls, ["a", "b", "a", "b", "a", "b"]);
  assert.equal(f.deck.execute("flow").cancelled, true);
  await until(() => !f.deck.snapshot().running.length);
  assert.equal(f.calls.length, 6);
});
test("flow validation rejects executable conditions, excessive nesting and unbounded parallel fanout", async (t) => {
  const f = fixture(t, [step("a")]);
  const save = (steps) => {
    const c = structuredClone(f.config);
    c.pages[0].buttons[0].steps = steps;
    return f.deck.save(c, 1);
  };
  assert.throws(
    () => save([branch({ ...rule(), field: "__proto__" }, [step("a")])]),
    /steps_invalid/,
  );
  assert.throws(
    () => save([branch({ ...rule(), value: { code: "bad" } }, [step("a")])]),
    /steps_invalid/,
  );
  assert.throws(
    () => save([{ type: "parallel", steps: Array.from({ length: 9 }, () => step("a")) }]),
    /steps_invalid/,
  );
  assert.throws(
    () => save([{ type: "parallel", steps: [{ type: "parallel", steps: [step("a")] }] }]),
    /steps_invalid/,
  );
  let nested = [step("a")];
  for (let at = 0; at < 7; at++) nested = [{ type: "repeat", count: 2, steps: nested }];
  assert.throws(() => save(nested), /steps_invalid/);
});
