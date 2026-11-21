const test = require("node:test"),
  assert = require("node:assert/strict");
const duration = require("../src/domains/twitch/watchtime-duration");
test("watchtime shows only completed nonzero duration units", () => {
  assert.equal(duration(0), "0 minutes");
  assert.equal(duration(1), "1 minute");
  assert.equal(duration(60), "1 hour");
  assert.equal(duration(1441), "1 day, 1 minute");
  assert.equal(duration(43200), "1 month");
  assert.equal(duration(525600), "1 year");
  assert.equal(
    duration(525600 + 86400 + 4320 + 240 + 5),
    "1 year, 2 months, 3 days, 4 hours, 5 minutes",
  );
  assert.equal(duration(-1), "0 minutes");
  assert.equal(duration(Infinity), "0 minutes");
});
