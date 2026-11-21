const test = require("node:test"),
  assert = require("node:assert/strict");
const { parse } = require("../src/domains/twitch/quote-import");
test("quote list edits preserve metadata, stale deletes fail and successful deletes renumber", (t) => {
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-quote-list-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "data.json"),
    store = require("../src/domains/twitch/community-store")(file);
  store.import(
    {
      owner: "123",
      quotes: [
        { text: "First", category: "Music", author: "viewer" },
        { text: "Second" },
        { text: "Third" },
      ],
    },
    true,
  );
  const initial = store.manageQuotes("123", { operation: "list" });
  assert.equal(initial.total, 3);
  assert.equal(initial.rows[0].number, 1);
  store.manageQuotes("123", {
    operation: "edit",
    number: 1,
    token: initial.rows[0].token,
    text: "${countnever} edited",
  });
  assert.equal(store.account("123").quotes[0].category, "Music");
  assert.equal(store.account("123").quotes[0].author, "viewer");
  assert.throws(
    () =>
      store.manageQuotes("123", { operation: "delete", number: 1, token: initial.rows[0].token }),
    /changed/,
  );
  const updated = store.manageQuotes("123", { operation: "list" });
  store.manageQuotes("123", { operation: "delete", number: 1, token: updated.rows[0].token });
  assert.throws(
    () =>
      store.manageQuotes("123", {
        operation: "edit",
        number: 2,
        token: initial.rows[1].token,
        text: "Wrong quote",
      }),
    /changed/,
  );
  const searched = store.manageQuotes("123", { operation: "list", search: "Third", limit: 1 });
  assert.equal(searched.rows[0].number, 2);
  assert.equal(searched.matched, 1);
  assert.equal(store.manageQuotes("456", {}).total, 0);
  const reloaded = require("../src/domains/twitch/community-store")(file);
  assert.equal(reloaded.quote("123", "read", "1"), "#1: Second");
  reloaded.manageQuotes("123", { operation: "add", text: "Fourth" });
  assert.equal(reloaded.manageQuotes("123", {}).total, 3);
});
test("copied Markdown and clipboard rows retain quotes and metadata, ordered by source number", () => {
  const result = parse(`| #35 | |
| --- | - |
"A quote with &amp; and &#x20; spaces" -Viewer
| 3 weeks ago | A game | added_by | |
| ----------- | ------ | -------- | - |
| #34 | | | |
A second quote that
continues on another line.
| Oct 2025 | Another game | another_viewer | |
| -------- | ---------- | -------- | - |
| #33 | | |
Third quote.
1 month ago\tA category\tthird_viewer\t`);
  assert.equal(result.quotes.length, 3);
  assert.deepEqual(
    result.quotes.map((row) => row.id),
    [33, 34, 35],
  );
  assert.equal(result.quotes[0].category, "A category");
  assert.equal(result.quotes[0].author, "third_viewer");
  assert.equal(result.quotes[1].text, "A second quote that continues on another line.");
  assert.equal(result.quotes[2].text, '"A quote with & and spaces" -Viewer');
  assert.equal(result.quotes[2].sourceDate, "3 weeks ago");
});
test("plain lists, blank rows, Unicode and repeated rows resolve without treating text as executable", () => {
  assert.deepEqual(parse("First quote\nSecond quote\n").quotes, [
    { text: "First quote" },
    { text: "Second quote" },
  ]);
  const result = parse("#2\n${countnever} café 一群\n#1\nUnique\n#3\nUnique");
  assert.equal(result.quotes.length, 2);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.quotes[1].text, "${countnever} café 一群");
  assert.equal(parse("#2\nNo quote text in this marker?", "lines").quotes.length, 2);
  assert.throws(() => parse("a".repeat(100001)), /100,000/);
});
test("rich quote imports validate before writing, skip existing text, retain details and keep long originals", (t) => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rvl-quotes-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "data.json"),
    store = require("../src/domains/twitch/community-store")(file);
  const bundle = {
    owner: "123",
    quotes: [
      {
        id: 35,
        text: "Long ".repeat(150),
        category: "A game",
        sourceDate: "3 weeks ago",
        author: "viewer",
      },
    ],
  };
  assert.equal(store.import(bundle).quotes, 1);
  assert.equal(fs.existsSync(file), false);
  store.import(bundle, true);
  assert.equal(store.account("123").quotes[0].sourceId, 35);
  assert.equal(store.account("123").quotes[0].text.length, 749);
  assert.equal(store.quote("123", "read", "1").length, 500);
  assert.equal(
    store.import({ ...bundle, quotes: [...bundle.quotes, { text: "New" }] }, true).quotes,
    1,
  );
  assert.equal(store.account("123").quotes.length, 2);
  const before = fs.readFileSync(file, "utf8");
  assert.throws(
    () => store.import({ owner: "123", quotes: [{ text: "Valid" }, { text: "" }] }, true),
    /Quote text/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(store.import({ ...bundle, quotes: [{ text: "New" }] }).duplicates, 1);
});
