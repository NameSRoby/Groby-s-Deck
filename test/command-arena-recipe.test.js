const savedCounters = require("./support/counter-snapshot.cjs");
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { render } = require("../src/domains/twitch/command-template"),
  arena = require("../src/domains/twitch/command-arena-variables"),
  create = require("../src/domains/twitch/command-counters"),
  math = require("../src/domains/twitch/command-math");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-recipe-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "records.json");
  return { file, store: create(file) };
}
const context = { sender: "hero", user: "rival", argv: ["rival"] };
test("editable arena has one fair roll, exact odds and symmetric saved records", async (t) => {
  const f = fixture(t);
  let wins = 0;
  for (let roll = 1; roll <= 20; roll++) {
    const counter = f.store(String(roll), false, true);
    let calls = 0;
    const text = await render(arena.message, {
      context,
      counter,
      random: () => {
        calls++;
        return (roll - 0.5) / 20;
      },
    });
    assert.equal(calls, 2);
    assert.match(text, new RegExp(`NEED: 16.*25% chance.*ROLLED: hero rolled ${roll}/20`));
    const win = roll >= 16;
    if (win) wins++;
    assert.match(text, new RegExp(`RESULT: ${win ? "hero" : "rival"} wins`));
    assert.equal(counter(`player ${win ? "hero" : "rival"} wins`, "get"), 1);
    assert.equal(counter(`player ${win ? "rival" : "hero"} losses`, "get"), 1);
    assert.ok(counter(`player ${win ? "hero" : "rival"} xp`, "get") >= 15);
    assert.equal(counter(`player ${win ? "rival" : "hero"} xp`, "get"), 0);
    counter.commit();
  }
  assert.equal(wins, 5);
  assert.equal(create(f.file)("20")("player hero xp", "get"), 49);
  assert.equal(create(f.file)("another")("player hero xp", "get"), 0);
});
test("recipe changes alter difficulty, rewards and story; previews and failed recipes never commit", async (t) => {
  const f = fixture(t),
    counter = f.store("owner", false, true);
  counter("player hero streak", "set", -50);
  counter("player rival rating", "set", 800);
  const edited = arena.message
    .replace("set difficulty 16", "set difficulty 12")
    .replace("set xpAward 10 + (100 - winnerChance) * 2 / 5 + margin", "set xpAward 25")
    .replace("add xpAward 5", "add xpAward 0")
    .replace("legendary finishing blow", "CUSTOM STORY");
  const text = await render(edited, {
    context,
    counter,
    random: (() => {
      let n = 0;
      return () => (++n === 1 ? 0.999 : 0);
    })(),
  });
  assert.match(text, /NEED: 10/);
  assert.match(text, /CUSTOM STORY/);
  assert.equal(counter("player hero xp", "get"), 25);
  counter.commit();
  const before = savedCounters(f.file),
    preview = f.store("owner", true, true);
  await render(arena.message, { context, counter: preview });
  preview.commit();
  assert.equal(savedCounters(f.file), before);
  const failed = f.store("owner", false, true);
  await assert.rejects(
    render(arena.message + "${unknown}", { context, counter: failed }),
    /Unknown/,
  );
  assert.equal(savedCounters(f.file), before);
  await assert.rejects(
    render(arena.message, { context: { sender: "hero", argv: ["bad-name"] }, counter: failed }),
    /username/,
  );
  await assert.rejects(
    render(arena.message, { context: { sender: "hero", argv: [] }, counter: failed }),
    /Provide a Twitch username/,
  );
});

test("public recipe scores upsets, narrow wins, decisive rolls and criticals; losses survive restart", async (t) => {
  const f = fixture(t);
  for (const [roll, award, loss] of [
    [1, 30, 13],
    [8, 25, 10],
    [15, 20, 7],
    [16, 40, 17],
    [19, 43, 19],
    [20, 49, 22],
  ]) {
    const counter = f.store(String(roll), false, true);
    counter("player hero xp", "set", 100);
    counter("player rival xp", "set", 100);
    const text = await render(arena.message, { context, counter, random: () => (roll - 0.5) / 20 });
    const winner = roll >= 16 ? "hero" : "rival",
      loser = roll >= 16 ? "rival" : "hero";
    assert.equal(counter(`player ${winner} xp`, "get"), 100 + award);
    assert.equal(counter(`player ${loser} xp`, "get"), 100 - loss);
    assert.match(
      text,
      new RegExp(`RESULT: ${winner} wins \\(\\+${award} XP\\); ${loser} loses \\(-${loss} XP\\)`),
    );
    counter.commit();
    assert.equal(create(f.file)(String(roll))(`player ${loser} xp`, "get"), 100 - loss);
  }
});

test("same winning margin earns more for lower odds, with larger penalties for the losing favorite", async (t) => {
  const f = fixture(t);
  const results = [];
  for (const [difficulty, award, loss] of [
    [10, 28, 11],
    [16, 40, 17],
    [19, 46, 20],
  ]) {
    const counter = f.store(String(difficulty), false, true);
    counter("player rival xp", "set", 100);
    const source = arena.message.replace("set difficulty 16", "set difficulty " + difficulty);
    await render(source, { context, counter, random: () => (difficulty - 0.5) / 20 });
    assert.equal(counter("player hero xp", "get"), award);
    assert.equal(counter("player rival xp", "get"), 100 - loss);
    results.push(award);
  }
  assert.ok(results[0] < results[1] && results[1] < results[2]);
});

test("XP deductions stop at zero and the message reports the actual deduction", async (t) => {
  const f = fixture(t);
  for (const balance of [0, 3, 22]) {
    const counter = f.store(String(balance), false, true);
    counter("player rival xp", "set", balance);
    const text = await render(arena.message, { context, counter, random: () => 0.999 });
    assert.equal(counter("player rival xp", "get"), 0);
    assert.match(text, new RegExp(`rival loses \\(-${balance} XP\\)`));
  }
});

test("defender rewards use the defender's odds and stronger defenses earn a larger margin bonus", async (t) => {
  const f = fixture(t);
  for (const [difficulty, roll, award, loss] of [
    [10, 9, 32, 13],
    [19, 18, 14, 4],
    [19, 13, 19, 7],
  ]) {
    const counter = f.store(`${difficulty}-${roll}`, false, true);
    counter("player hero xp", "set", 100);
    await render(arena.message.replace("set difficulty 16", "set difficulty " + difficulty), {
      context,
      counter,
      random: () => (roll - 0.5) / 20,
    });
    assert.equal(counter("player rival xp", "get"), award);
    assert.equal(counter("player hero xp", "get"), 100 - loss);
  }
});

test("a stronger opponent rewards the same winning die more instead of cancelling risk against margin", async (t) => {
  const f = fixture(t);
  let previousAward = 0,
    previousLoss = 0;
  for (let difficulty = 10; difficulty <= 19; difficulty++) {
    const counter = f.store(String(difficulty), false, true);
    counter("player rival xp", "set", 100);
    await render(arena.message.replace("set difficulty 16", "set difficulty " + difficulty), {
      context,
      counter,
      random: () => 0.999,
    });
    const award = counter("player hero xp", "get"),
      loss = 100 - counter("player rival xp", "get");
    assert.ok(award > previousAward, "the same natural 20 is worth more at lower odds");
    assert.ok(loss >= previousLoss, "the losing favorite risks more");
    previousAward = award;
    previousLoss = loss;
  }
});
test("generic recipes have lazy branches, local values, saved zero defaults and leaderboards", async (t) => {
  const f = fixture(t),
    counter = f.store("owner", false, true);
  assert.equal(
    await render("${set n random 1 20}${n}:${n}${if 0}${addstat hero wins 1}${else}safe${end}", {
      counter,
      random: () => 0,
    }),
    "1:1safe",
  );
  assert.equal(counter("player hero wins", "get"), 0);
  assert.equal(
    await render("${stat hero rating 1000}${setstat hero rating 0}:${stat hero rating 1000}", {
      counter,
    }),
    "1000:0",
  );
  await render("${addstat hero wins 2}${addstat rival wins 3}", { counter });
  assert.equal(await render("${top wins 2}", { counter }), "1. rival: 3 · 2. hero: 2");
});
test("bounded arithmetic accepts formulas and rejects executable or unbounded expressions", () => {
  assert.equal(math("clamp(round(24*(1-0.25)),-20,20)"), 18);
  assert.equal(math("2+3*4==14 && 1!=2"), 1);
  for (const source of [
    "process.exit()",
    "constructor(1)",
    "1/0",
    "2**999",
    "(".repeat(40) + "1" + ")".repeat(40),
  ])
    assert.throws(() => math(source));
});
