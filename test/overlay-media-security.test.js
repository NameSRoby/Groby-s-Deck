const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const createMedia = require("../src/domains/overlays/overlay-media");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-media-security-"));
  const runtimeDir = path.join(root, "runtime"),
    outside = path.join(root, "outside");
  fs.mkdirSync(runtimeDir);
  fs.mkdirSync(outside);
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith("groby-media-security-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    runtimeDir,
    outside,
    media: createMedia(runtimeDir),
    dir: path.join(runtimeDir, "overlays", "media"),
  };
}

test("media rejects non-scalar and inherited MIME keys before coercion or disk access", (t) => {
  const f = fixture(t);
  const poisonous = {
    toString() {
      throw Error("must not coerce input");
    },
  };
  for (const type of [
    undefined,
    null,
    [],
    ["image/png"],
    {},
    poisonous,
    42,
    "constructor",
    "__proto__",
    "toString",
    "text/html",
    "image/svg+xml",
    "image/png\0",
  ]) {
    assert.throws(() => f.media.add(type, png), /supported|valid/, String(typeof type));
  }
  assert.equal(fs.existsSync(f.dir), false);
  const poisonousBody = {
    get length() {
      throw Error("must not read a non-Buffer length");
    },
  };
  for (const body of [
    "not a buffer",
    [],
    Array.from(png),
    {},
    { length: png.length },
    new Uint8Array(png),
    poisonousBody,
  ]) {
    assert.throws(() => f.media.add("image/png", body), /valid/);
  }
  assert.equal(
    fs.existsSync(f.dir),
    false,
    "non-Buffer bodies must be rejected before filesystem access",
  );
  assert.throws(() => f.media.add("image/png", Buffer.alloc(4)), /valid/);
  const asset = f.media.add("IMAGE/PNG; charset=binary", png);
  assert.deepEqual(fs.readFileSync(f.media.locate(asset.url.split("/").pop()).file), png);
});

test("media reads accept only complete generated filenames and do not coerce input", (t) => {
  const f = fixture(t),
    asset = f.media.add("image/png", png),
    name = asset.url.split("/").pop();
  assert.ok(f.media.locate(name));
  const poisonous = {
    toString() {
      throw Error("must not coerce input");
    },
  };
  for (const input of [
    undefined,
    null,
    [name],
    {},
    poisonous,
    42,
    "../" + name,
    "..\\" + name,
    path.join(f.outside, name),
    "C:\\private\\" + name,
    "%2e%2e%2f" + name,
    name + "\n",
    name + "\r\n",
    name + "\0",
    name + ":secret",
    name.replace(".png", ".html"),
    "-".repeat(36) + ".png",
  ]) {
    assert.equal(f.media.locate(input), null);
  }
  assert.equal(f.media.locate(randomUUID() + ".png"), null);
});

test("media rejects directory junctions before creating or serving files outside its root", (t) => {
  for (const folder of ["overlays", "media"]) {
    const f = fixture(t),
      name = randomUUID() + ".png";
    fs.writeFileSync(path.join(f.outside, name), png);
    const linked = folder === "overlays" ? path.join(f.runtimeDir, "overlays") : f.dir;
    if (folder === "media") fs.mkdirSync(path.dirname(f.dir));
    fs.symlinkSync(f.outside, linked, process.platform === "win32" ? "junction" : "dir");
    assert.equal(f.media.locate(name), null);
    assert.throws(() => f.media.add("image/png", png), /storage is unavailable/);
    assert.deepEqual(
      fs.readdirSync(f.outside),
      [name],
      "rejected uploads must not create anything in the redirected directory",
    );
  }
});

test("media refuses linked files even when the generated filename and extension are valid", (t) => {
  const f = fixture(t);
  f.media.add("image/png", png);
  const name = randomUUID() + ".png",
    outside = path.join(f.outside, "private.png");
  fs.writeFileSync(outside, png);
  try {
    fs.symlinkSync(outside, path.join(f.dir, name), "file");
  } catch (error) {
    if (error.code === "EPERM")
      return t.skip("File symlinks require Windows Developer Mode or elevation");
    throw error;
  }
  assert.equal(f.media.locate(name), null);
});

test("uploads retain image/font size limits and the generated-file storage quota", (t) => {
  const f = fixture(t),
    large = Buffer.alloc(8 * 1024 * 1024 + 1);
  png.copy(large);
  assert.throws(() => f.media.add("image/png", large), /up to 8 MB/);
  const largeFont = Buffer.alloc(5 * 1024 * 1024 + 1);
  largeFont.write("wOFF");
  assert.throws(() => f.media.add("font/woff", largeFont), /up to 5 MB/);
  f.media.add("image/png", png);
  for (let i = 1; i < 200; i++)
    fs.writeFileSync(path.join(f.dir, randomUUID() + ".png"), Buffer.alloc(0));
  assert.throws(() => f.media.add("image/png", png), /storage is full/);
  assert.equal(fs.readdirSync(f.dir).length, 200);
});

async function serverFixture(t, mediaReadLimitOptions = {}) {
  const f = fixture(t),
    express = require("express"),
    app = express();
  const service = require("../src/domains/overlays/stream-overlays.service")({
    runtimeDir: f.runtimeDir,
  });
  app.use(express.json());
  require("../src/app/core/register-stream-overlays.routes")(app, {
    service,
    runtimeDir: f.runtimeDir,
    express,
    mediaReadLimitOptions,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(async () => {
    service.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { ...f, base: "http://127.0.0.1:" + server.address().port };
}

test("HTTP media remains usable for image, font and video Range requests with fixed MIME types", async (t) => {
  const f = await serverFixture(t),
    font = Buffer.alloc(20),
    video = Buffer.alloc(20);
  font.write("wOFF");
  video.write("ftyp", 4);
  for (const [endpoint, type, body] of [
    ["media", "image/png", png],
    ["fonts", "font/woff", font],
    ["media", "video/mp4", video],
  ]) {
    const response = await fetch(f.base + "/api/stream-overlays/" + endpoint, {
      method: "POST",
      headers: { "Content-Type": type },
      body,
    });
    assert.equal(response.status, 200);
    const asset = await response.json();
    assert.equal(asset.ok, true);
    const fetched = await fetch(f.base + asset.url);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get("content-type"), type);
    assert.equal(fetched.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), body);
    const partial = await fetch(f.base + asset.url, { headers: { Range: "bytes=0-3" } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 0-3/" + body.length);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), body.subarray(0, 4));
  }
});

test("operator admission precedes media throttling and repeated file reads receive 429", async (t) => {
  const f = await serverFixture(t, { limit: 2 }),
    asset = f.media.add("image/png", png),
    url = f.base + asset.url;
  for (let i = 0; i < 3; i++)
    assert.equal(
      (await fetch(url, { headers: { Origin: "https://untrusted.example" } })).status,
      403,
    );
  assert.equal((await fetch(url, { method: "HEAD" })).status, 200);
  assert.equal((await fetch(url, { headers: { Range: "bytes=0-3" } })).status, 206);
  const limited = await fetch(url);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("ratelimit"));
});

test("HTTP malformed and encoded filenames never reveal neighboring runtime files", async (t) => {
  const f = await serverFixture(t);
  fs.writeFileSync(path.join(f.runtimeDir, "private.json"), "fixture-private-content");
  for (const name of [
    "%2e%2e%2fprivate.json",
    "%2e%2e%5cprivate.json",
    randomUUID() + ".png%0a",
    randomUUID() + ".png%00",
    "private.json",
  ]) {
    const response = await fetch(f.base + "/api/stream-overlays/media/" + name);
    assert.equal(response.status, 404);
    assert.equal((await response.text()).includes("fixture-private-content"), false);
  }
});
