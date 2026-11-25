const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { writeArchive, readArchive } = require("../integrations/spotify-desktop/archive.cjs");
const installer = require("../integrations/spotify-desktop/installer.cjs");
const sidecar = require("../integrations/spotify-desktop/sidecar.cjs");
const snapshotSource = require("../integrations/spotify-desktop/snapshot-source.cjs");
const discover = require("../integrations/spotify-desktop/discovery.cjs");
const launch = require("../integrations/spotify-desktop/launcher.cjs");

async function fixture(t, sourceName = "Spotify") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spotify-sidecar-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, sourceName),
    apps = path.join(source, "Apps"),
    runtime = path.join(root, "runtime");
  fs.mkdirSync(apps, { recursive: true });
  fs.writeFileSync(path.join(source, "Spotify.exe"), "fixture");
  const original = await writeArchive([
    {
      name: "index.html",
      rawName: "/index.html",
      data: Buffer.from('<html><script defer src="/xpui-snapshot.js"></script></html>'),
    },
    {
      name: "xpui-snapshot.js",
      rawName: "/xpui-snapshot.js",
      data: Buffer.from("var snapshot=true;"),
    },
  ]);
  const script =
    "var __webpack_modules__={};function registerFactory(){};registerFactory();const platform={version:build,getPlayerAPI:()=>native};\n//# sourceMappingURL=xpui-modules.js.map";
  const snapshot = Buffer.concat([Buffer.from([1, 2, 3]), Buffer.from(script, "utf16le")]);
  fs.writeFileSync(path.join(apps, "xpui.spa"), original);
  fs.writeFileSync(path.join(apps, "login.spa"), "untouched login");
  fs.writeFileSync(path.join(source, "v8_context_snapshot.bin"), snapshot);
  const plan = await installer.plan(apps);
  const options = {
    allowUnverifiedBuild: true,
    expectedArchiveHash: plan.archiveHash,
    expectedSnapshotHash: plan.snapshotHash,
  };
  return { root, source, apps, runtime, original, snapshot, options };
}

test("Spotify rooted SPA and odd-offset V8 source stage locally without modifying the client", async (t) => {
  const f = await fixture(t),
    result = await sidecar.stage(f.apps, f.runtime, f.options);
  assert.deepEqual(fs.readFileSync(path.join(f.apps, "xpui.spa")), f.original);
  assert.deepEqual(fs.readFileSync(path.join(f.source, "v8_context_snapshot.bin")), f.snapshot);
  assert.equal(fs.existsSync(path.join(result.apps, "xpui.spa")), false);
  assert.ok(
    fs
      .readFileSync(path.join(result.apps, "xpui/xpui-modules.js"), "utf8")
      .includes("__ravelinkSpotify"),
  );
  const html = fs.readFileSync(path.join(result.apps, "xpui/index.html"), "utf8");
  assert.ok(html.indexOf("/xpui-modules.js") < html.indexOf("/xpui-snapshot.js"));
  assert.equal(sidecar.launchPlan(f.runtime, result.id).args[0], "--app-directory=" + result.apps);
  assert.equal((await sidecar.stage(f.apps, f.runtime, f.options)).reused, true);
  sidecar.remove(f.runtime, result.id);
  assert.deepEqual(fs.readdirSync(f.runtime), []);
  assert.equal(fs.readFileSync(path.join(f.apps, "login.spa"), "utf8"), "untouched login");
});

test("Spotify sidecar rejects stale sources, unsafe targets and modified local assets", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    sidecar.stage(f.apps, path.join(f.source, "nested"), f.options),
    /root_invalid/,
  );
  assert.equal(fs.existsSync(path.join(f.source, "nested")), false);
  await assert.rejects(
    sidecar.stage(f.apps, f.runtime, {
      ...f.options,
      expectedSnapshotHash: "0".repeat(64),
    }),
    /source_changed/,
  );
  const result = await sidecar.stage(f.apps, f.runtime, f.options);
  const verified = sidecar.createVerifier(f.runtime, result.id);
  assert.equal(verified().ok, true);
  assert.equal(verified().ok, true);
  fs.writeFileSync(path.join(result.apps, "login.spa"), "changed");
  assert.equal(verified().ok, false);
  assert.throws(() => sidecar.remove(f.runtime, result.id), /modified/);
  assert.equal(fs.readFileSync(path.join(result.apps, "login.spa"), "utf8"), "changed");
});

test("Spotify prepared status invalidates on a client update and preserves legacy sidecars for safe removal", async (t) => {
  const f = await fixture(t),
    prepared = await sidecar.stage(f.apps, f.runtime, f.options),
    verify = sidecar.createVerifier(f.runtime, prepared.id);
  assert.equal(verify().ok, true);
  fs.appendFileSync(path.join(f.apps, "xpui.spa"), "client update");
  assert.deepEqual(verify(), { ok: false, error: "spotify_source_changed" });
  const file = path.join(f.runtime, prepared.id, "ravelink-sidecar.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  delete manifest.layoutVersion;
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.equal(sidecar.createVerifier(f.runtime, prepared.id)().ok, false);
  assert.throws(() => sidecar.launchPlan(f.runtime, prepared.id), /spotify_setup_required/);
  assert.equal(sidecar.remove(f.runtime, prepared.id).removed, true);
});

test("Spotify snapshot extraction rejects missing, ambiguous and invalid source without executing it", () => {
  assert.throws(() => snapshotSource(Buffer.from("unknown")), /unavailable/);
  const source = "var __webpack_modules__={};\n//# sourceMappingURL=xpui-modules.js.map";
  assert.equal(snapshotSource(Buffer.from(source, "utf16le")), source);
  assert.throws(() => snapshotSource(Buffer.from(source + source, "utf16le")), /ambiguous/);
  assert.throws(
    () => snapshotSource(Buffer.from(source.replace("{};", "{!;"), "utf16le")),
    /invalid/,
  );
});

test("Spotify source hardlinks remain read-only while owned sidecar files require exclusive ownership", async (t) => {
  const f = await fixture(t);
  for (const name of ["Spotify.exe", "v8_context_snapshot.bin", "Apps/xpui.spa"])
    fs.linkSync(path.join(f.source, name), path.join(f.root, path.basename(name) + ".source-link"));
  const plan = await installer.plan(f.apps, { allowProtectedRead: true });
  const prepared = await sidecar.stage(f.apps, f.runtime, {
    ...f.options,
    expectedArchiveHash: plan.archiveHash,
    expectedSnapshotHash: plan.snapshotHash,
  });
  assert.equal(sidecar.launchPlan(f.runtime, prepared.id).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(f.apps, "xpui.spa")), f.original);
  fs.linkSync(path.join(prepared.apps, "login.spa"), path.join(f.root, "owned-link"));
  assert.throws(() => sidecar.launchPlan(f.runtime, prepared.id), /file_invalid/);
});

test("Spotify prepared status verifies the discovered catalog configuration and survives Core restart", async (t) => {
  const f = await fixture(t),
    create = require("../integrations/spotify-desktop/provider.cjs");
  const rows = await readArchive(f.original);
  rows.push({
    name: "search.js",
    data: Buffer.from(
      'function descriptors(){new q.Doc("searchTracks","query","' + "a".repeat(64) + '",null)}',
    ),
  });
  fs.writeFileSync(path.join(f.apps, "xpui.spa"), await writeArchive(rows));
  const options = {
    runtimeDir: f.runtime,
    discover: () => [{ appsPath: f.apps }],
    launch: async () => {
      throw Error("must_not_launch");
    },
  };
  let provider = create(options);
  t.after(() => provider.close());
  assert.equal(
    (await provider.handle("setup", { action: "prepare", coreUrl: "http://127.0.0.1:53210" })).ok,
    true,
  );
  assert.equal(provider.status().installation.prepared, true);
  provider.close();
  provider = create(options);
  assert.equal(provider.status().installation.prepared, true);
  provider.close();
  fs.writeFileSync(
    path.join(f.runtime, "spotify-desktop/pairing.json"),
    JSON.stringify({ token: "b".repeat(64) }),
  );
  provider = create(options);
  assert.equal(provider.status().installation.prepared, false);
  assert.equal(
    (await provider.handle("setup", { action: "launch" })).error,
    "spotify_setup_required",
  );
});

test("Spotify discovery locates a client from Store/process results without launching it", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const rows = discover({
    platform: "win32",
    appData: null,
    spawn: (exe, args, options) => {
      calls++;
      assert.equal(exe, "powershell.exe");
      assert.equal(options.windowsHide, true);
      assert.ok(args.at(-1).includes("Get-AppxPackage"));
      return { status: 0, stdout: JSON.stringify([f.source, f.source]) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].appsPath, f.apps);
});

test("Spotify launcher keeps paths out of shell source and refuses running clients or failed launches", async (t) => {
  const f = await fixture(t),
    prepared = await sidecar.stage(f.apps, f.runtime, f.options);
  let calls = 0;
  const result = await launch(f.runtime, prepared.id, {
    platform: "win32",
    spawn: (exe, args, options) => {
      calls++;
      assert.equal(exe, "powershell.exe");
      assert.equal(options.windowsHide, true);
      assert.ok(args.at(-1).includes("Get-Process -Name Spotify"));
      assert.ok(!args.at(-1).includes(f.root));
      const input = JSON.parse(options.input);
      assert.equal(input.apps, prepared.apps);
      assert.equal(input.store, false);
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, launched: true, launcherPid: 1234 }),
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.runtimeVerified, false);
  const options = {
    platform: "win32",
    spawn: () => ({
      status: 1,
      stdout: JSON.stringify({
        ok: false,
        error: "spotify_close_client_required",
      }),
    }),
  };
  await assert.rejects(() => launch(f.runtime, prepared.id, options), /close_client_required/);
  await assert.rejects(
    () =>
      launch(f.runtime, prepared.id, {
        ...options,
        spawn: () => ({ status: null, stdout: "" }),
      }),
    /launch_failed/,
  );
  await assert.rejects(() => launch(f.runtime, prepared.id, { platform: "linux" }), /windows_only/);
  fs.writeFileSync(path.join(f.apps, "xpui.spa"), "updated");
  await assert.rejects(() => launch(f.runtime, prepared.id, options), /source_changed/);
});

test(
  "Spotify discovery and launch preserve Unicode and shell punctuation through Windows PowerShell",
  { skip: process.platform !== "win32" },
  async (t) => {
    const f = await fixture(t, "Spotífy 東京 [test] $name"),
      prepared = await sidecar.stage(f.apps, f.runtime, f.options);
    const { spawnSync } = require("node:child_process");
    const env = {
      ...process.env,
      GROBY_SPOTIFY_FIXTURE_EXE: path.join(f.source, "Spotify.exe"),
      GROBY_SPOTIFY_FIXTURE_ROOT: f.source,
      GROBY_SPOTIFY_FIXTURE_APPS: prepared.apps,
    };
    const rows = discover({
      platform: "win32",
      appData: null,
      localAppData: null,
      spawn: (exe, args, options) =>
        spawnSync(
          exe,
          [
            ...args.slice(0, -1),
            "[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(437); function Get-Process { param($Name,$ErrorAction) [pscustomobject]@{Path=$env:GROBY_SPOTIFY_FIXTURE_EXE} }; function Get-AppxPackage { param($Name,$ErrorAction) }; " +
              args.at(-1),
          ],
          { ...options, env },
        ),
    });
    assert.equal(rows[0]?.appsPath, f.apps);
    const result = await launch(f.runtime, prepared.id, {
      platform: "win32",
      spawn: (exe, args, options) => {
        const stub =
          "[Console]::InputEncoding = [Text.Encoding]::GetEncoding(437); function Get-Process { param($Name,$ErrorAction) }; function Start-Process { param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru) if ($FilePath -ne $env:GROBY_SPOTIFY_FIXTURE_EXE -or $ArgumentList -ne ('--app-directory=\"' + $env:GROBY_SPOTIFY_FIXTURE_APPS + '\"')) { throw \"unicode_path_changed\" }; [pscustomobject]@{Id=1234} }; ";
        return spawnSync(exe, [...args.slice(0, -1), stub + args.at(-1)], { ...options, env });
      },
    });
    assert.equal(result.launched, true);
  },
);
