/** Broken UTF-8 display strings must be fixed in authored sources before generating pages. */
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
test("shipped UI sources have no mojibake or replacement characters", () => {
  const roots = ["public/core", "features/twitch-integration/ui", "features/song-request/ui"];
  const broken = [];
  function walk(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (
        /\.(js|html|css)$/.test(file) &&
        /[\u00c2\u00c3][^\x00-\x7f]|\ufffd|\u00e2\u20ac|\u00f0\u0178/.test(
          fs.readFileSync(file, "utf8"),
        )
      )
        broken.push(file);
    }
  }
  for (const root of roots) walk(path.join(__dirname, "..", root));
  assert.deepEqual(broken, []);
});
