const test = require("node:test"),
  assert = require("node:assert/strict");
const make =
  require("../src/capabilities/feature-platform/providers/twitch-api-client").createTwitchApiClient;
const credentials = { accessToken: "private-token", clientId: "fixture", userId: "123" };
function response(body, status = 200) {
  return { ok: status === 200, status, text: async () => JSON.stringify(body) };
}

test("credits fetch bounded official pages and expose names without subscriber IDs or credentials", async () => {
  const urls = [];
  const api = make({
    fetch: async (url) => {
      urls.push(new URL(url));
      return response({
        data: [
          { user_name: "Supporter", user_id: "private-id", followed_at: "2026-01-01T00:00:00Z" },
        ],
        pagination: urls.length === 1 ? { cursor: "next" } : {},
      });
    },
  });
  const value = await api.overlaySupporters({ credentials, kind: "subscribers" });
  assert.equal(urls.length, 2);
  assert.equal(urls[1].searchParams.get("after"), "next");
  assert.equal(urls[0].pathname, "/helix/subscriptions");
  assert.equal(value.names[0].at, null);
  assert.equal(value.truncated, false);
  assert.doesNotMatch(JSON.stringify(value), /private-/);
});
for (const kind of ["followers", "subscribers"]) {
  test(`${kind} credits preserve long opaque Twitch cursors through the final empty page`, async () => {
    // A real response returned 21 names and a 2,279-character cursor.
    // Truncation made the next request fail and discarded the entire list.
    const cursor = "opaque+/=".repeat(300),
      calls = [],
      api = make({
        fetch: async (url) => {
          const after = new URL(url).searchParams.get("after");
          calls.push(after);
          if (after !== null && after !== cursor) return response({}, 400);
          return response({
            data: after ? [] : [{ user_name: "Supporter", followed_at: "2026-01-01T00:00:00Z" }],
            pagination: after ? {} : { cursor },
          });
        },
      });
    const value = await api.overlaySupporters({ credentials, kind });
    assert.equal(value.ok, true);
    assert.equal(value.names[0].name, "Supporter");
    assert.equal(value.truncated, false);
    assert.deepEqual(calls, [null, cursor]);
  });
}

test("clip and moderator/VIP lists preserve opaque pagination tokens", async () => {
  const cursor = "opaque+/=".repeat(300),
    pages = new Map(),
    api = make({
      fetch: async (url) => {
        const query = new URL(url),
          route = query.pathname,
          after = query.searchParams.get("after");
        assert.equal(after, pages.has(route) ? cursor : null);
        pages.set(route, (pages.get(route) || 0) + 1);
        return response({ data: [], pagination: after ? {} : { cursor } });
      },
    });
  assert.equal((await api.dashboardClips({ credentials })).complete, true);
  assert.equal((await api.listRequesterRoles({ credentials })).ok, true);
  assert.deepEqual([...pages.values()], [2, 2, 2]);
});

test("official dashboard queries normalize totals without forwarding user tokens or subscriber identities", async () => {
  const calls = [],
    api = make({
      fetch: async (url, init) => {
        calls.push({ url, init });
        const p = new URL(url).pathname;
        if (p.endsWith("/streams"))
          return response({
            data: [
              {
                id: "99",
                started_at: "2026-01-01T00:00:00Z",
                title: "Stream",
                viewer_count: 12,
                game_name: "Game",
              },
            ],
          });
        if (p.endsWith("/followers")) return response({ total: 200, data: [] });
        return response({ total: 25, points: 30, data: [{ user_id: "private-subscriber-id" }] });
      },
    });
  assert.equal((await api.dashboardStream({ credentials })).viewers, 12);
  assert.equal((await api.dashboardFollowers({ credentials })).total, 200);
  const subs = await api.dashboardSubscribers({ credentials });
  assert.equal(subs.total, 25);
  assert(!JSON.stringify(subs).includes("private-"));
  assert(calls.every((c) => c.init.headers.Authorization === "Bearer private-token"));
});
test("clip counts remain bounded and VOD associations use the actual stream ID", async () => {
  let pages = 0;
  const api = make({
    fetch: async (url) => {
      if (new URL(url).pathname.endsWith("/clips")) {
        pages++;
        return response({
          data: [
            {
              id: "Clip" + pages,
              title: "Clip",
              created_at: "2026-01-01T01:00:00Z",
              creator_name: "Viewer",
            },
          ],
          pagination: { cursor: "more" },
        });
      }
      return response({
        data: [
          { id: "77", stream_id: "99" },
          { id: "88", stream_id: "another" },
        ],
      });
    },
  });
  const clips = await api.dashboardClips({ credentials, startedAt: Date.parse("2026-01-01") });
  assert.equal(pages, 3);
  assert.equal(clips.complete, false);
  assert.equal(clips.count, 3);
  assert.deepEqual((await api.dashboardVod({ credentials, streamIds: ["99"] })).videos, [
    { streamId: "99", videoId: "77" },
  ]);
});
test("marker success requires a confirmed Twitch position and uncertain POSTs are never retried", async () => {
  let calls = 0;
  const api = make({
    fetch: async (_url, init) => {
      calls++;
      assert.equal(init.method, "POST");
      return response({}, 504);
    },
  });
  const result = await api.createStreamMarker({ credentials, description: "Highlight" });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
});
