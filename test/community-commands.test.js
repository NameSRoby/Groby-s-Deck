const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-community-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = 0,
    live = true;
  const sent = [],
    writes = [];
  const provider = {
    status: () => ({
      connected: true,
      userId: "123",
      scopes: ["moderator:read:chatters", "moderator:read:followers"],
    }),
    dashboardStream: async () => ({ ok: true, live }),
    listChatters: async () => ({ ok: true, users: [{ id: "4", login: "viewer" }] }),
    sendChat: async (value) => sent.push(value.message),
    runAction: async (value) => {
      writes.push(value);
      return { ok: true };
    },
    searchCategories: async () => ({ ok: true, categories: [{ id: "9", name: "Stardew Valley" }] }),
    followAge: async () => ({ ok: true, followedAt: "2020-01-01T00:00:00Z" }),
  };
  const file = path.join(root, "community.json"),
    bot = require("../src/domains/twitch/community-commands")({
      file,
      getProvider: () => provider,
      now: () => now,
    });
  t.after(() => bot.shutdown());
  let id = 0;
  async function command(text, mod = false) {
    now += 6000;
    const result = bot.chat({
      broadcaster_user_id: "123",
      chatter_user_id: mod ? "123" : "4",
      chatter_user_login: mod ? "host" : "viewer",
      badges: [],
      message_id: String(++id),
      message: { text },
    });
    await bot.idle();
    return result;
  }
  return {
    file,
    bot,
    provider,
    sent,
    writes,
    command,
    advance: (ms) => (now += ms),
    setLive: (value) => (live = value),
  };
}
test("title and fuzzy category commands are moderator gated and writes are never retried", async (t) => {
  const f = fixture(t);
  await f.command("!title new title");
  assert.equal(f.writes.length, 0);
  await f.command("!title New title with spaces", true);
  assert.deepEqual(f.writes[0].params, { title: "New title with spaces" });
  await f.command("!category Stardew Valey", true);
  assert.deepEqual(f.writes[1].params, { gameId: "9" });
  assert.match(f.sent.at(-1), /Stardew Valley/);
});
test("quotes add, random/read, delete and renumber; viewer mutations fail and restart retains data", async (t) => {
  const f = fixture(t);
  await f.command("!quote add First", true);
  await f.command("!quote add Second", true);
  await f.command("!deletequote 1");
  assert.match(f.sent.at(-1), /Only moderators/);
  await f.command("!deletequote #1", true);
  await f.command("!quote 1");
  assert.equal(f.sent.at(-1), "#1: Second");
  const store = require("../src/domains/twitch/community-store")(f.file);
  assert.equal(store.quote("123", "read", "1"), "#1: Second");
  assert.equal(store.account("456").quotes.length, 0);
});
test("watchtime uses consecutive live presence samples, batched points and separate imported history", async (t) => {
  const f = fixture(t);
  f.bot.setActive(true);
  await new Promise((resolve) => setImmediate(resolve));
  f.advance(300000);
  await f.bot.tick();
  f.advance(300000);
  await f.bot.tick();
  assert.equal(f.bot.store.viewer("123", "viewer").minutes, 10);
  assert.equal(f.bot.store.viewer("123", "viewer").points, 10);
  f.setLive(false);
  f.advance(300000);
  await f.bot.tick();
  assert.equal(f.bot.store.viewer("123", "viewer").minutes, 10);
  const bundle = {
    owner: "123",
    watchtime: [{ username: "viewer", minutes: 100 }],
    points: [{ username: "viewer", points: 200 }],
    quotes: [{ text: "Imported" }],
  };
  assert.equal(f.bot.store.import(bundle).watchtime, 1);
  f.bot.store.import(bundle, true);
  f.bot.store.import(bundle, true);
  assert.equal(f.bot.store.account("123").quotes.length, 1);
  await f.command("!watchtime");
  assert.match(f.sent.at(-1), /1 hour, 50 minutes/);
  await f.command("!points");
  assert.match(f.sent.at(-1), /210/);
});
test("watchtime and quote opt-outs preserve channel data and silence their built-in commands", async (t) => {
  const f = fixture(t),
    store = f.bot.store;
  store.credit("123", "viewer", 25);
  store.quote("123", "add", "Keep this", "host", 0);
  assert.equal(f.bot.tracking({ mode: "off" }).mode, "off");
  assert.equal(store.manageQuotes("123", { operation: "settings", enabled: false }).enabled, false);
  let requests = 0;
  f.provider.dashboardStream = async () => {
    requests++;
    return { ok: true, live: true };
  };
  f.bot.setActive(true);
  await f.bot.tick();
  assert.equal(requests, 0);
  for (const command of ["!watchtime", "!points", "!quote", "!quote add Ignored", "!deletequote 1"])
    assert.equal((await f.command(command, true)).accepted, false);
  assert.deepEqual(f.sent, []);
  const restarted = require("../src/domains/twitch/community-store")(f.file);
  assert.equal(restarted.tracking("123"), "off");
  assert.equal(restarted.peek("123", "viewer").minutes, 25);
  assert.equal(restarted.manageQuotes("123").enabled, false);
  assert.equal(restarted.manageQuotes("123").rows[0].text, "Keep this");
  assert.equal(restarted.tracking("456"), "followers");
  assert.equal(restarted.manageQuotes("456").enabled, true);
  f.bot.tracking({ mode: "followers" });
  store.manageQuotes("123", { operation: "settings", enabled: true });
  await f.command("!watchtime");
  await f.command("!quote");
  assert.match(f.sent[0], /25 minutes/);
  assert.match(f.sent[1], /Keep this/);
});
test("category resolver rejects ties and unrelated queries", () => {
  const match = require("../src/domains/twitch/category-match");
  assert.equal(match("Stardew Valey", [{ id: "1", name: "Stardew Valley" }]).id, "1");
  assert.equal(
    match("Star", [
      { id: "1", name: "Star One" },
      { id: "2", name: "Star Two" },
    ]).ok,
    false,
  );
  assert.equal(match("Unrelated", [{ id: "1", name: "Music" }]).ok, false);
});

test("viewer names cannot change prototypes and failed imports do not write partial data", (t) => {
  const f = fixture(t);
  const store = f.bot.store;
  store.credit("123", "__proto__", 5);
  store.credit("123", "constructor", 5);
  store.flush();
  assert.equal(Object.prototype.minutes, undefined);
  assert.equal(store.viewer("123", "__proto__").minutes, 5);
  const before = fs.readFileSync(f.file, "utf8");
  assert.throws(
    () =>
      store.import(
        {
          owner: "123",
          watchtime: [
            { username: "valid", minutes: 5 },
            { username: "bad name!", minutes: 6 },
          ],
          quotes: [],
          points: [],
        },
        true,
      ),
    /Invalid/,
  );
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
});
