const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("deck feed ignores duplicate frames and callbacks from superseded connections", async (t) => {
  const browserModule = readFileSync(join(__dirname, "../public/core/control-deck-feed.js"));
  const { createDeckFeed } = await import(
    "data:text/javascript;base64," + browserModule.toString("base64")
  );
  const streams = [];
  const received = [];
  const requests = [];
  let visible = true;
  let outages = 0;
  const previous = globalThis.EventSource;
  globalThis.EventSource = class {
    constructor() {
      streams.push(this);
    }
    send(instance, version, value) {
      this.onmessage({ data: JSON.stringify({ instance, version, value }) });
    }
    close() {
      this.closed = true;
    }
  };
  const feed = createDeckFeed({
    request: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    receive: (value) => received.push(value),
    offline: () => outages++,
    visible: () => visible,
  });
  t.after(() => {
    feed.close();
    globalThis.EventSource = previous;
  });

  const firstRequest = feed.refresh();
  const [first] = streams;
  first.send("first", 4, "live");
  first.send("first", 4, "duplicate");
  requests[0].resolve({ instance: "old", version: 9, value: "stale HTTP" });
  await firstRequest;
  assert.deepEqual(received, ["live"]);

  const failedRefresh = feed.refresh();
  requests[1].reject(Error("HTTP unavailable"));
  await failedRefresh;
  assert.equal(outages, 0);

  const beforeHide = feed.refresh();
  visible = false;
  feed.sync();
  assert.equal(first.closed, true);
  visible = true;
  const afterShow = feed.refresh();
  first.onerror();
  first.send("first", 5, "late live event");
  requests[2].reject(Error("old HTTP error"));
  await beforeHide;
  requests[3].resolve({ instance: "new", version: 1, value: "reloaded" });
  await afterShow;
  assert.equal(outages, 0);
  assert.equal(streams[1].closed, undefined);

  streams[1].onerror();
  assert.equal(outages, 1);
  feed.sync();
  streams[2].send("new", 1, "reconnected with the same version");
  assert.deepEqual(received, ["live", "reloaded", "reconnected with the same version"]);

  visible = false;
  const overview = feed.refresh(true);
  feed.sync();
  requests[4].resolve({ instance: "new", version: 2, value: "overview settings" });
  await overview;
  assert.equal(received.at(-1), "overview settings");
});
