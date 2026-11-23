const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const createCatalog = require("../src/capabilities/feature-platform/providers/tidal-catalog-provider");
const fixture = require("./support/tidal-catalog-fixture.cjs");
const credentials = { clientId: "client-fixture-123", countryCode: "PT" };
async function connect(catalog) {
  const result = catalog.begin({
    redirectUri: "http://127.0.0.1:5050/auth/tidal/callback",
  });
  assert.equal(result.ok, true);
  return catalog.callback(
    {
      state: new URL(result.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    },
    result.redirectUri,
  );
}
test("official catalog uses user PKCE, opaque search linkage and ordered track metadata; caches and disconnects safely", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-tidal-catalog-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let requests = [];
  const options = {
    vaultPath: path.join(root, "vault.json"),
    protect: (value) => ({
      ok: true,
      encrypted: {
        payload: Buffer.from(JSON.stringify(value)).toString("base64"),
      },
    }),
    unprotect: (value) => ({
      ok: true,
      plain: JSON.parse(Buffer.from(value.payload, "base64").toString()),
    }),
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init });
      return fixture(url, init);
    },
  };
  const catalog = createCatalog(options);
  assert.equal((await catalog.search("iron maiden")).error, "tidal_oauth_sign_in_required");
  assert.equal(catalog.configure(credentials).ok, true);
  assert.equal((await connect(catalog)).ok, true);
  assert.ok(!fs.readFileSync(options.vaultPath, "utf8").includes("fixture-refresh-token"));
  const [first, same] = await Promise.all([
    catalog.search("iron maiden the book of souls"),
    catalog.search("iron maiden the book of souls"),
  ]);
  assert.equal(first.candidates[0].providerItemId, "456");
  assert.equal(first.candidates[0].durationMs, 627000);
  assert.equal(same.ok, true);
  assert.equal(requests.length, 3);
  assert.equal(requests[1].url.searchParams.get("countryCode"), "PT");
  assert.equal(requests[2].url.pathname, "/v2/tracks/456");
  assert.equal(requests[0].init.body.get("grant_type"), "authorization_code");
  assert.equal(requests[1].init.headers.authorization, "Bearer fixture-access-token");
  assert.ok(requests.every((row) => row.init.redirect === "error"));
  first.candidates[0].title = "changed";
  assert.equal(
    (await catalog.search("iron maiden the book of souls")).candidates[0].title,
    "The Book Of Souls",
  );
  assert.equal(requests.length, 3);
  assert.equal(createCatalog(options).status().configured, true);
  assert.equal(catalog.status().clientIdSource, "custom");
  assert.ok(!JSON.stringify(catalog.status()).includes(credentials.clientId));
  assert.equal(requests[0].init.body.has("client_secret"), false);
  assert.ok(!JSON.stringify(catalog.status()).includes("fixture-access-token"));
  catalog.clear();
  assert.equal(createCatalog(options).status().connected, false);
  assert.equal(catalog.status().authenticated, false);
});
test("catalog rejects credential persistence failure and bounds responses and remote redirects", async () => {
  const denied = createCatalog({
    vaultPath: "unused",
    protect: () => ({ ok: false }),
  });
  assert.equal(denied.configure(credentials).error, "tidal_catalog_vault_write_failed");
  assert.equal(denied.status().connected, false);
  const oversized = createCatalog({
    fetchImpl: async (url, init) =>
      new URL(url).hostname === "auth.tidal.com"
        ? fixture(url, init)
        : new Response("x".repeat(524289)),
  });
  oversized.configure(credentials);
  await connect(oversized);
  assert.equal((await oversized.search("Artist Track")).error, "tidal_catalog_response_invalid");
  const redirect = createCatalog({
    fetchImpl: async (url, init) =>
      new URL(url).hostname === "auth.tidal.com"
        ? fixture(url, init)
        : new Response("", { status: 302 }),
  });
  redirect.configure(credentials);
  await connect(redirect);
  assert.equal((await redirect.search("Artist Track")).error, "tidal_catalog_unavailable");
  assert.ok(!JSON.stringify(redirect.status()).includes("fixture-refresh-token"));
});
test("catalog renews a rejected read token once and honors rate bounds", async () => {
  let authCalls = 0,
    searches = 0;
  const catalog = createCatalog({
    fetchImpl: async (url, init) => {
      const target = new URL(url);
      if (target.hostname === "auth.tidal.com") authCalls++;
      if (target.pathname === "/v2/searchResults" && searches++ === 0)
        return new Response("", { status: 401 });
      return fixture(url, init);
    },
  });
  catalog.configure(credentials);
  await connect(catalog);
  assert.equal((await catalog.search("first song")).ok, true);
  assert.equal(authCalls, 2);
  for (let index = 1; index < 10; index++)
    assert.equal((await catalog.search("different song " + index)).ok, true);
  assert.equal((await catalog.search("one more song")).error, "tidal_search_rate_limited");
});

test("favorites require collection consent and use exact track IDs with bounded authenticated writes", async () => {
  const calls = [];
  let fail = false;
  let skipReason = "";
  const catalog = createCatalog({
    fetchImpl: async (url, init) => {
      const target = new URL(url);
      if (target.hostname === "auth.tidal.com")
        return new Response(
          JSON.stringify({
            access_token: "test-token",
            refresh_token: "test-refresh",
            expires_in: 3600,
            scope: "search.read playlists.read playlists.write collection.read collection.write",
          }),
        );
      calls.push({
        path: target.pathname,
        method: init.method,
        body: JSON.parse(init.body),
        key: init.headers["Idempotency-Key"],
      });
      if (fail) throw Error("lost response");
      if (init.method === "POST") {
        const track = { type: "tracks", id: "123" };
        return Response.json(
          skipReason
            ? { data: [], meta: { skipped: [{ ...track, reason: skipReason }] } }
            : { data: [track] },
        );
      }
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(
    (await catalog.favorite({ trackId: "123", save: true })).error,
    "tidal_favorites_sign_in_required",
  );
  const login = catalog.begin({
    redirectUri: "http://127.0.0.1:5050/auth/tidal/callback",
    playlists: true,
  });
  assert.equal(
    (
      await catalog.callback(
        { state: new URL(login.authorizationUrl).searchParams.get("state"), code: "test-code" },
        login.redirectUri,
      )
    ).ok,
    true,
  );
  assert.equal((await catalog.favorite({ trackId: "123", save: true })).saved, true);
  assert.equal((await catalog.favorite({ trackId: "123", save: false })).saved, false);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["POST", "DELETE"],
  );
  assert.equal(calls[0].path, "/v2/userCollectionTracks/me/relationships/items");
  assert.deepEqual(calls[0].body, { data: [{ type: "tracks", id: "123" }] });
  assert.ok(calls[0].key);
  assert.equal((await catalog.favorite({ trackId: "../../anything", save: true })).ok, false);
  assert.equal(calls.length, 2);
  skipReason = "NOT_FOUND";
  assert.equal(
    (await catalog.favorite({ trackId: "123", save: true })).error,
    "tidal_favorite_track_not_found",
  );
  skipReason = "ALREADY_PRESENT";
  assert.equal((await catalog.favorite({ trackId: "123", save: true })).saved, true);
  fail = true;
  assert.equal((await catalog.favorite({ trackId: "123", save: true })).ok, false);
  assert.equal(calls.length, 5);
  catalog.shutdown();
});
