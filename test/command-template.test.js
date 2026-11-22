const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { render } = require("../src/domains/twitch/command-template");
test("shoutout templates resolve arguments, nested channel lookups and links without interpreting viewer functions", async () => {
  const context = { argv: ["friend"], sender: "mod", target: "friend", channel: "host" };
  assert.equal(
    await render('Go follow ${1}, playing ${game "${1}"}: ${link user}', {
      context,
      lookup: async (name) => ({ game: name === "friend" ? "Music" : "Other" }),
    }),
    "Go follow friend, playing Music: https://www.twitch.tv/friend",
  );
  assert.equal(
    await render("${1}", { context: { argv: ["${count[stolen]}"] } }),
    "${count[stolen]}",
  );
});
test("chance and weighted choices are deterministic under seeded samples and unused branches cannot change counters", async () => {
  let calls = 0;
  await assert.rejects(
    render('${setcount "${1}" 0}', { context: { argv: ["deaths|100"] }, counter: () => calls++ }),
    /counter.*name/,
  );
  assert.equal(calls, 0);
  let mutations = 0;
  const options = { random: () => 0.05, counter: () => ++mutations };
  assert.equal(await render('${chance 0 "${countbad}" "Safe"}', options), "Safe");
  assert.equal(mutations, 0);
  assert.equal(await render('${weighted "1:Rare" "9:Common"}', options), "Rare");
  assert.equal(await render("${random 1 20}", options), "2");
  await assert.rejects(render('${chance 101 "a" "b"}'), /Chance/);
  await assert.rejects(render("${unknown}"), /Unknown/);
  await assert.rejects(render("${user"), /Close/);
});
test("named counters survive reload, previews never write, and repeated increment tokens are coalesced", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-counters-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "counts.json"),
    create = require("../src/domains/twitch/command-counters"),
    store = create(file);
  assert.equal(await render("${countdeaths} / ${countdeaths}", { counter: store("123") }), "1 / 1");
  assert.equal(await render("${countdeaths}", { counter: store("123", true), preview: true }), "2");
  assert.equal(create(file)("123")("deaths", "get", 0), 1);
  assert.equal(create(file)("456")("deaths", "get", 0), 0);
});

test("compact counter names reuse existing totals and support plain read/reset names", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-short-count-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "counts.json"),
    store = require("../src/domains/twitch/command-counters")(file),
    counter = store("123");
  counter("adddeath", "set", 7);
  assert.equal(
    await render("${countadddeath} / ${countadddeath} / ${readcountadddeath}", { counter }),
    "8 / 8 / 8",
  );
  assert.equal(await render("${countothercounter} / ${readcountadddeath}", { counter }), "1 / 8");
  assert.equal(await render("${resetcountadddeath} / ${readcountadddeath}", { counter }), "0 / 0");
  assert.equal(
    require("../src/domains/twitch/command-counters")(file)("123")("othercounter", "get"),
    1,
  );
});

test("feature source boundary migrates retired counter spellings and never reinterprets escaped literals", () => {
  const syntax = require("../features/twitch-integration/dist/counter-syntax");
  assert.equal(
    syntax.display(syntax.display("${countadddeath} ${readcountadddeath} ${resetcountadddeath}")),
    "${countadddeath} ${readcountadddeath} ${resetcountadddeath}",
  );
  assert.equal(
    syntax.display("${count[adddeath]} ${getcount[adddeath]} ${setcount[adddeath|0]}"),
    "${countadddeath} ${readcountadddeath} ${resetcountadddeath}",
  );
  assert.equal(syntax.display("\\${countliteral}"), "\\${countliteral}");
  assert.equal(syntax.display("${setcount[score|8]}"), "${setcount score 8}");
  const payload = {
    automation: { steps: [{ params: { message: "${countscore}", login: "${countscore}" } }] },
  };
  assert.equal(
    syntax.display(syntax.fields(payload, syntax.display).automation.steps[0].params.message),
    "${countscore}",
  );
  assert.equal(payload.automation.steps[0].params.message, "${countscore}");
  assert.equal(
    syntax.fields(payload, syntax.display).automation.steps[0].params.login,
    "${countscore}",
  );
});
