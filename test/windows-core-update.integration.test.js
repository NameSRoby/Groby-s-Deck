const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const test = require("node:test");

const windows = process.platform === "win32";

function write(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

for (const targetVersion of ["0.6.2", "0.7.1a"])
  test(
    "Windows updater preserves mutable data and can restore managed files: " + targetVersion,
    { skip: !windows },
    (t) => {
      const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-update-integration-"));
      t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
      const root = path.join(fixture, "install");
      const release = path.join(fixture, "release");
      const updateRoot = path.join(root, "runtime", "updates");
      const archive = path.join(
        updateRoot,
        "downloads",
        `Grobys-Deck-Windows-v${targetVersion}-self-contained.zip`,
      );

      write(root, "RELEASE_BUILD.json", JSON.stringify({ version: "0.6.1", channel: "release" }));
      write(root, "src/old.js", "old program");
      write(root, "Groby's Deck.exe", "old host");
      write(root, "runtime/Grobys-Deck-Node.exe", "old node");
      write(root, "integrations/music-to-light/controller.cjs", "old controller");
      write(root, "runtime/music-to-light/cargo/release/groby-audio-probe.exe", "old probe");
      write(root, "runtime/music-to-light/operator.json", "private source selection");
      write(root, "runtime/user-state.json", "preserve runtime");
      write(root, "runtime/desktop/WebView2Loader.dll", "old desktop loader");
      write(root, "runtime/desktop-window.json", "preserve desktop position");
      write(root, "config/user.json", "preserve config");
      write(root, "features/installed/custom/state.json", "preserve feature");

      write(
        release,
        "RELEASE_BUILD.json",
        JSON.stringify({ version: targetVersion, channel: "release" }),
      );
      write(release, "src/app/core/create-core-server.js", "new program");
      write(release, "src/app/optional/feature-enabled-server.js", "new entry point");
      write(release, "Groby's Deck.exe", "new host");
      write(release, "packages/tidal-desktop/installer.cjs", "new companion");
      write(release, "runtime/Grobys-Deck-Node.exe", "new node");
      write(release, "runtime/desktop/WebView2Loader.dll", "new desktop loader");
      write(release, "integrations/music-to-light/controller.cjs", "new controller");
      write(release, "runtime/music-to-light/cargo/release/groby-audio-probe.exe", "new probe");
      fs.mkdirSync(path.dirname(archive), { recursive: true });
      const zipped = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Compress-Archive -Path (Join-Path $env:RAVELINK_TEST_RELEASE '*') -DestinationPath $env:RAVELINK_TEST_ARCHIVE -Force",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          env: {
            ...process.env,
            RAVELINK_TEST_RELEASE: release,
            RAVELINK_TEST_ARCHIVE: archive,
          },
        },
      );
      assert.equal(zipped.status, 0, zipped.stderr);
      const sha256 = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
      write(
        root,
        "runtime/updates/staged.json",
        JSON.stringify({
          version: targetVersion,
          archivePath: archive,
          sha256,
          verified: true,
        }),
      );

      const helper = path.resolve(__dirname, "../scripts/groby-update.ps1");
      const apply = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          helper,
          "-Action",
          "Apply",
          "-Root",
          root,
          "-NoLaunch",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, PSModulePath: path.join(root, "unavailable-modules") },
        },
      );
      assert.equal(apply.status, 0, `${apply.stdout}\n${apply.stderr}`);
      assert.equal(
        fs.readFileSync(path.join(root, "integrations/music-to-light/controller.cjs"), "utf8"),
        "new controller",
      );
      assert.equal(
        fs.readFileSync(
          path.join(root, "runtime/music-to-light/cargo/release/groby-audio-probe.exe"),
          "utf8",
        ),
        "new probe",
      );
      assert.equal(
        fs.readFileSync(path.join(root, "runtime/music-to-light/operator.json"), "utf8"),
        "private source selection",
      );
      assert.equal(
        fs.readFileSync(path.join(root, "src/app/core/create-core-server.js"), "utf8"),
        "new program",
      );
      assert.equal(fs.existsSync(path.join(root, "src/old.js")), false);
      assert.equal(
        fs.readFileSync(path.join(root, "runtime/desktop/WebView2Loader.dll"), "utf8"),
        "new desktop loader",
      );
      assert.equal(
        fs.readFileSync(path.join(root, "runtime/desktop-window.json"), "utf8"),
        "preserve desktop position",
      );
      assert.equal(
        fs.readFileSync(path.join(root, "packages/tidal-desktop/installer.cjs"), "utf8"),
        "new companion",
      );
      assert.equal(
        fs.readFileSync(path.join(root, "runtime/user-state.json"), "utf8"),
        "preserve runtime",
      );
      assert.equal(fs.readFileSync(path.join(root, "config/user.json"), "utf8"), "preserve config");
      assert.equal(
        fs.readFileSync(path.join(root, "features/installed/custom/state.json"), "utf8"),
        "preserve feature",
      );

      const rollback = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          helper,
          "-Action",
          "Rollback",
          "-Root",
          root,
          "-NoLaunch",
        ],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(rollback.status, 0, `${rollback.stdout}\n${rollback.stderr}`);
      assert.equal(
        fs.readFileSync(path.join(root, "integrations/music-to-light/controller.cjs"), "utf8"),
        "old controller",
      );
      assert.equal(
        fs.readFileSync(
          path.join(root, "runtime/music-to-light/cargo/release/groby-audio-probe.exe"),
          "utf8",
        ),
        "old probe",
      );
      assert.equal(
        fs.readFileSync(path.join(root, "runtime/music-to-light/operator.json"), "utf8"),
        "private source selection",
      );
      assert.equal(fs.readFileSync(path.join(root, "src/old.js"), "utf8"), "old program");
      assert.equal(
        fs.readFileSync(path.join(root, "runtime/desktop/WebView2Loader.dll"), "utf8"),
        "old desktop loader",
      );
      assert.equal(fs.existsSync(path.join(root, "src/app/core/create-core-server.js")), false);
      assert.equal(fs.existsSync(path.join(root, "packages/tidal-desktop/installer.cjs")), false);
      assert.equal(
        fs.readFileSync(path.join(root, "runtime/user-state.json"), "utf8"),
        "preserve runtime",
      );
    },
  );

test(
  "the packaged Windows host stays open on preflight failure and reopens after an update",
  { skip: !windows, timeout: 95000 },
  async (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "groby-native-update-"));
    const root = path.join(fixture, "Custom installation");
    const release = path.join(fixture, "candidate");
    const updater = path.resolve(__dirname, "../src/domains/system/core-update.service.js");
    const host = path.join(fixture, "compiled", "Groby's Deck.exe");
    t.after(() => fs.rmSync(path.dirname(host), { recursive: true, force: true }));
    const compiled = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.resolve(__dirname, "../scripts/build-windows-host.ps1"),
        "-OutputPath",
        host,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 40000 },
    );
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const executable = path.join(root, "Groby's Deck.exe");
    const archive = path.join(root, "runtime", "updates", "downloads", "candidate.zip");
    const port = await new Promise((resolve) => {
      const listener = net.createServer().listen(0, "127.0.0.1", () => {
        const { port } = listener.address();
        listener.close(() => resolve(port));
      });
    });
    const env = { ...process.env, PORT: String(port) };
    const base = "http://127.0.0.1:" + port;
    const server = [
      "const http = require('node:http');",
      "const fs = require('node:fs');",
      "const rootDir = process.cwd();",
      "const version = JSON.parse(fs.readFileSync('RELEASE_BUILD.json')).version;",
      "const updates = require(" +
        JSON.stringify(updater) +
        ").createCoreUpdateService({rootDir});",
      "const send = (res, data) => res.end(JSON.stringify(data));",
      "http.createServer(async (req, res) => {",
      "  try {",
      "    if (req.url === '/health') send(res, {ok:true, profile:'clean-slate-core', version, pid:process.env.RAVELINK_HOST_PID});",
      "    else if (req.url === '/system/stop') { send(res, {ok:true}); setTimeout(() => process.exit(0), 20); }",
      "    else if (req.url === '/apply') send(res, await updates.apply());",
      "    else send(res, updates.status());",
      "  } catch (error) { res.statusCode = 500; send(res, {error:error.message}); }",
      "}).listen(Number(process.env.PORT), '127.0.0.1');",
    ].join("\n");
    function install(at, version) {
      write(at, "RELEASE_BUILD.json", JSON.stringify({ version, channel: "release" }));
      write(at, "src/app/optional/feature-enabled-server.js", server);
      fs.copyFileSync(host, path.join(at, "Groby's Deck.exe"));
      fs.mkdirSync(path.join(at, "runtime"), { recursive: true });
      fs.copyFileSync(process.execPath, path.join(at, "runtime", "Grobys-Deck-Node.exe"));
      fs.cpSync(
        path.join(path.dirname(host), "runtime", "desktop"),
        path.join(at, "runtime", "desktop"),
        { recursive: true },
      );
      fs.mkdirSync(path.join(at, "scripts"), { recursive: true });
      fs.copyFileSync(
        path.resolve(__dirname, "../scripts/groby-update.ps1"),
        path.join(at, "scripts", "groby-update.ps1"),
      );
    }
    function stage() {
      write(
        root,
        "runtime/updates/staged.json",
        JSON.stringify({
          archivePath: archive,
          version: "0.8.22",
          verified: true,
          sha256: crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex"),
        }),
      );
    }
    async function read(route) {
      const response = await fetch(base + route, { signal: AbortSignal.timeout(1000) });
      const body = await response.json();
      assert.equal(response.ok, true, JSON.stringify(body));
      return body;
    }
    async function until(route, predicate) {
      for (let i = 0; i < 180; i++) {
        const value = await read(route).catch(() => null);
        if (value && predicate(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const logs = ["updates/update.log", "logs/windows-host.log", "updates/operation.json"]
        .map((relative) => path.join(root, "runtime", relative))
        .filter((file) => fs.existsSync(file))
        .map((file) => fs.readFileSync(file, "utf8"))
        .join("\n");
      throw Error("Timed out at " + route + "\n" + logs);
    }

    install(root, "0.8.21");
    install(release, "0.8.22");
    write(root, "runtime/user-settings.json", '{"saved":true}');
    const original = spawn(executable, ["--background"], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: "ignore",
    });
    t.after(async () => {
      spawnSync(executable, ["--stop"], { cwd: root, env, windowsHide: true, timeout: 5000 });
      for (let i = 0; i < 20 && original.exitCode === null; i++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    });
    const before = await until("/health", (health) => health.version === "0.8.21");
    assert.equal((await read("/status")).canRestart, true);
    write(root, "runtime/updates/downloads/candidate.zip", "corrupt archive");
    stage();
    assert.equal((await read("/apply")).operation.phase, "preparing");
    await until("/status", (value) => value.operation?.phase === "failed");
    assert.equal((await read("/health")).pid, before.pid);

    const zipped = spawnSync("tar.exe", ["-acf", archive, "-C", release, "."], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(zipped.status, 0, zipped.stderr);
    stage();
    await read("/apply");
    const after = await until("/health", (health) => health.version === "0.8.22");
    assert.notEqual(after.pid, before.pid);
    const confirmed = await until("/status", (value) => value.operation?.phase === "installed");
    assert.equal(confirmed.rollback.version, "0.8.21");
    assert.equal(
      fs.readFileSync(path.join(root, "runtime/user-settings.json"), "utf8"),
      '{"saved":true}',
    );
  },
);
