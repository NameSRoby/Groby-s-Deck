const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const create = require("../src/domains/twitch/command-counters");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-records-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "records.json");
}
test("legacy records migrate once, reopen with leaders and boards, and previews never write", (t) => {
  const file = fixture(t);
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 2,
      values: { "123:player hero xp": 100, "123:deaths": 7 },
      boards: {
        "123:old": { label: "Old", field: "xp", entries: [{ player: "hero", value: 100 }] },
      },
    }),
  );
  const store = create(file),
    preview = store("123", true, true);
  preview("deaths", "add", 1);
  preview.commit();
  assert.equal(fs.existsSync(file + ".sqlite"), false);
  const live = store("123", false, true);
  live("player rival xp", "set", 200);
  live.commit();
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(file + ".migrated"), true);
  const reopened = create(file)("123");
  assert.equal(reopened("deaths", "get"), 7);
  assert.match(reopened.top("xp", 2), /1\. rival: 200.*2\. hero: 100/);
  assert.equal(reopened.board("old"), "Old: 1. hero: 100");
  const bytes = fs.readFileSync(file + ".sqlite");
  const sample = store("123", true, true);
  sample.resetField("xp", 0);
  sample.saveBoard("Example", "xp", 3);
  sample.commit();
  assert.deepEqual(fs.readFileSync(file + ".sqlite"), bytes);
});
test("staged writers preserve other accounts and reject stale changes atomically", (t) => {
  const file = fixture(t),
    store = create(file),
    first = store("123", false, true),
    stale = store("123", false, true),
    other = store("456", false, true);
  first("xp", "set", 10);
  stale("xp", "set", 20);
  other("xp", "set", 30);
  first.commit();
  other.commit();
  assert.throws(() => stale.commit(), /changed during/);
  assert.equal(store("123")("xp", "get"), 10);
  assert.equal(store("456")("xp", "get"), 30);
});
test("reset, changes and season snapshots use the staged values in order", (t) => {
  const file = fixture(t),
    store = create(file),
    seed = store("123", false, true);
  seed("player hero xp", "set", 30);
  seed("player rival xp", "set", 20);
  seed.commit();
  const turn = store("123", false, true);
  turn.saveBoard("S1", "xp", 3);
  turn.resetField("xp", 0);
  turn("player rival xp", "add", 4);
  assert.equal(turn.top("xp", 2), "1. rival: 4 · 2. hero: 0");
  turn.commit();
  const next = create(file)("123");
  assert.equal(next.board("s1"), "S1: 1. hero: 30 · 2. rival: 20");
  assert.equal(next("player rival xp", "get"), 4);
});
test("invalid legacy data fails closed without replacing its source", (t) => {
  const file = fixture(t);
  fs.writeFileSync(file, '{"bad":"no"}');
  const bytes = fs.readFileSync(file);
  assert.throws(() => create(file)("123"), /unavailable/);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(fs.existsSync(file + ".sqlite"), false);
});
