/** Run the explicit end-user regression inventory. The development workspace
 * retains its full test suite; source publications contain only this subset. */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const files = require("../test/public-suite.json");
if (
  !Array.isArray(files) ||
  !files.length ||
  files.length > 100 ||
  new Set(files).size !== files.length ||
  files.some(
    (name) =>
      !/^[a-z0-9][a-z0-9.-]*\.test\.js$/.test(name) ||
      !fs.statSync(path.join(root, "test", name), { throwIfNoEntry: false })?.isFile(),
  )
)
  throw Error("Public test inventory is invalid or incomplete.");
const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...files.map((file) => "test/" + file)],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
