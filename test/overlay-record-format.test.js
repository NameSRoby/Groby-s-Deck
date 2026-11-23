const test = require("node:test"),
  assert = require("node:assert/strict");
const { watchtime } = require("../public/core/overlay-record-format"),
  model = require("../public/core/overlay-model");
test("watchtime formats convert stored minutes, bound decimals and label duration units", () => {
  for (const [minutes, format, expected] of [
    [1.5, "seconds", "90 seconds watched"],
    [159515.6366, "minutes", "159,515.64 minutes watched"],
    [159515.6366, "hours", "2,658.59 hours watched"],
    [1440, "days", "1 day watched"],
    [43200, "months", "1 month watched"],
    [525600, "years", "1 year watched"],
    [159515.6366, "compact", "110d 18h watched"],
    [0, "compact", "0m watched"],
    [0.5, "compact", "30s watched"],
  ])
    assert.equal(watchtime(minutes, format), expected);
  assert.equal(watchtime(NaN), "Watchtime unavailable");
  assert.equal(watchtime(-1), "Watchtime unavailable");
});
test("overlay motion and watchtime choices survive shared document normalization", () => {
  const doc = model.document({
    motion: "reduced",
    widgets: [
      {
        id: "leaderboard",
        type: "leaderboard",
        statSource: "watchtime",
        statField: "wins",
        watchtimeFormat: "years",
      },
    ],
  });
  assert.deepEqual(model.document(JSON.parse(JSON.stringify(doc))), doc);
  assert.equal(doc.widgets[0].statField, "wins");
  assert.equal(model.document().motion, "full");
  assert.equal(
    model.widget({ type: "leaderboard", watchtimeFormat: "unknown" }).watchtimeFormat,
    "compact",
  );
});
