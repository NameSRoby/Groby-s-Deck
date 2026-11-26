/** Execute the generated Inno prerequisite flow against a tiny fake vendor
 * installer and a unique registry key. Never alter the real WebView2 runtime. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const spec = require("../desktop/windows-host/prerequisites.json").webview2;
const compiler = [
  process.env.ISCC_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs/Inno Setup 6/ISCC.exe"),
  "C:/Program Files (x86)/Inno Setup 6/ISCC.exe",
].find((p) => p && fs.existsSync(p));
const run = (file, args, env) =>
  spawnSync(file, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 45000,
    env: { ...process.env, ...env },
  });

test(
  "Offline Setup skips supported runtimes, upgrades old ones, and blocks failed or tampered payloads",
  { skip: process.platform !== "win32" || !compiler },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-setup-prereq-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const stub = path.join(root, spec.file),
      source = path.join(root, "stub.cs");
    fs.writeFileSync(
      source,
      `using System; using System.IO; using Microsoft.Win32;
class Stub { static int Main(string[] args) {
  string id = Environment.GetEnvironmentVariable("RAVELINK_PREREQ_FIXTURE_ID");
  if (id == null || id.Length != 32) return 90;
  string key = "Software\\\\RaveLink\\\\SetupTests\\\\" + id;
  var view = Environment.GetEnvironmentVariable("RAVELINK_PREREQ_FIXTURE_64") == "1"
    ? RegistryView.Registry64 : RegistryView.Registry32;
  using (var user = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view)) {
    if (args.Length > 0 && args[0] == "--cleanup") { user.DeleteSubKeyTree(key, false); return 0; }
    if (args.Length == 0 || args[0] != "--preinstall") File.WriteAllText(Environment.GetEnvironmentVariable("RAVELINK_PREREQ_FIXTURE_MARKER"), "executed");
    if (Environment.GetEnvironmentVariable("RAVELINK_PREREQ_FIXTURE_FAIL") == "1") return 19;
    bool old = args.Length > 0 && args[0] == "--preinstall" && Environment.GetEnvironmentVariable("RAVELINK_PREREQ_FIXTURE_OLD") == "1";
    using (var installed = user.CreateSubKey(key)) installed.SetValue("pv", old ? "110.0.1.0" : "157.0.1.0");
  } return 0;
} }`,
    );
    const csc = path.join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
    const built = run(csc, ["/nologo", "/target:exe", "/platform:x64", "/out:" + stub, source]);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const digest = crypto.createHash("sha256").update(fs.readFileSync(stub)).digest("hex");
    const actualKey =
      "SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    for (const mode of ["missing", "existing", "existing64", "old", "failure", "tampered"]) {
      const directory = path.join(root, mode);
      fs.mkdirSync(directory);
      const id = crypto.randomBytes(16).toString("hex");
      const marker = path.join(directory, "executed.txt");
      const env = {
        RAVELINK_PREREQ_FIXTURE_ID: id,
        RAVELINK_PREREQ_FIXTURE_MARKER: marker,
        RAVELINK_PREREQ_FIXTURE_FAIL: mode === "failure" ? "1" : "0",
        RAVELINK_PREREQ_FIXTURE_OLD: mode === "old" ? "1" : "0",
        RAVELINK_PREREQ_FIXTURE_64: mode === "existing64" ? "1" : "0",
      };
      const fixtureKey = "Software\\RaveLink\\SetupTests\\" + id;
      try {
        if (mode.startsWith("existing") || mode === "old")
          assert.equal(run(stub, ["--preinstall"], env).status, 0);
        const code = require("../scripts/installer-prerequisite-code")()
          .join("\n")
          .replaceAll(actualKey, fixtureKey)
          .replaceAll(spec.sha256, mode === "tampered" ? "0".repeat(64) : digest)
          .replaceAll("install-webview2.ps1", spec.file)
          .replace(
            /Exec\(ExpandConstant\('\{sys\}[^]*?ResultCode\)/,
            "Exec(InstallerPath, '/silent /install', ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ResultCode)",
          );
        const payload = path.join(directory, "installed.txt");
        fs.writeFileSync(payload, "ready");
        const script = path.join(directory, "fixture.iss");
        fs.writeFileSync(
          script,
          `[Setup]
AppId=RaveLinkPrerequisiteFixture${id}
AppName=Groby’s Deck prerequisite test
AppVersion=1
DefaultDirName=${directory}\\app
OutputDir=${directory}
OutputBaseFilename=fixture
PrivilegesRequired=lowest
Uninstallable=no
CreateUninstallRegKey=no
DisableDirPage=yes
DisableProgramGroupPage=yes
UsePreviousAppDir=no
Compression=none
[Files]
Source: "${stub}"; Flags: dontcopy
Source: "${payload}"; DestDir: "{app}"
[Code]
${code}
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin Result := EnsureWebViewRuntime(NeedsRestart); end;
`,
        );
        const compiled = run(compiler, ["/Qp", script], env);
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        const result = run(
          path.join(directory, "fixture.exe"),
          [
            "/VERYSILENT",
            "/SUPPRESSMSGBOXES",
            "/NORESTART",
            "/SP-",
            "/LOG=" + path.join(directory, "setup.log"),
          ],
          env,
        );
        const success = mode === "missing" || mode.startsWith("existing") || mode === "old";
        assert.equal(
          result.status === 0,
          success,
          mode + ": " + fs.readFileSync(path.join(directory, "setup.log"), "utf8"),
        );
        assert.equal(fs.existsSync(path.join(directory, "app", "installed.txt")), success, mode);
        assert.equal(
          fs.existsSync(marker),
          mode === "missing" || mode === "old" || mode === "failure",
          mode,
        );
      } finally {
        assert.equal(run(stub, ["--cleanup"], env).status, 0);
      }
    }
  },
);

test(
  "Setup reports a failing post-install check and leaves navigation untouched",
  { skip: process.platform !== "win32" || !compiler },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-setup-result-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const check = path.join(root, "check-installation.js");
    const install = path.join(root, "install-official-features.js");
    fs.writeFileSync(
      check,
      'process.exitCode = process.env.GROBY_TEST_SETUP_FAILURE === "check" ? 1 : 0;\n',
    );
    fs.writeFileSync(
      install,
      'process.exitCode = process.env.GROBY_TEST_SETUP_FAILURE === "feature" ? 1 : 0;\n',
    );
    const registryPath =
      "Software\\GrobyDeck\\SetupFixture\\" + crypto.randomBytes(8).toString("hex");
    const firstRun = require("../scripts/installer-first-run-code")()
      .join("\n")
      .replace(
        String.raw`Software\Microsoft\Windows\CurrentVersion\Uninstall\{CF817F37-5F04-4C18-A2B0-8A1EAA2674C5}_is1`,
        registryPath,
      );
    const script = path.join(root, "setup.iss");
    fs.writeFileSync(
      script,
      `[Setup]
AppId=GrobySetupResult${crypto.randomBytes(8).toString("hex")}
AppName=Groby's Deck setup result fixture
AppVersion=1
DefaultDirName={code:DefaultCoreDirectory}
OutputDir=${root}
OutputBaseFilename=fixture
PrivilegesRequired=lowest
Uninstallable=no
CreateUninstallRegKey=no
Compression=none
[Tasks]
Name: "music_to_light"; Description: "Music-to-Light"; Flags: unchecked
Name: "feature_twitch_integration_bundled"; Description: "Twitch Integration"
Name: "feature_song_request_bundled"; Description: "Song Request"
[Files]
Source: "${process.execPath}"; DestDir: "{app}\\runtime"; DestName: "Grobys-Deck-Node.exe"
Source: "${check}"; DestDir: "{app}\\scripts"
Source: "${install}"; DestDir: "{app}\\scripts"
[Code]
${firstRun}
${require("../scripts/installer-navigation-code")().join("\n")}
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  ExistingInstall := not FreshSetup;
  Result := '';
end;
`,
    );
    const compiled = run(compiler, ["/Qp", script]);
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    for (const mode of ["ok", "check", "feature"]) {
      const app = path.join(root, mode);
      const result = run(
        path.join(root, "fixture.exe"),
        ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/DIR=" + app],
        { GROBY_TEST_SETUP_FAILURE: mode },
      );
      assert.equal(result.status, mode === "ok" ? 0 : 20, result.stdout + result.stderr);
      assert.equal(fs.existsSync(path.join(app, "runtime/system/navigation.json")), mode === "ok");
    }
    const existing = path.join(root, "User-chosen install folder");
    fs.mkdirSync(path.join(existing, "runtime", "system"), { recursive: true });
    fs.mkdirSync(path.join(existing, "config"));
    fs.writeFileSync(path.join(existing, "Groby's Deck.exe"), "existing host marker");
    fs.writeFileSync(path.join(existing, "RELEASE_BUILD.json"), '{"version":"0.8.2c"}');
    const layout = path.join(existing, "runtime", "system", "navigation.json");
    const audio = path.join(existing, "config", "music-to-light.disabled");
    fs.writeFileSync(layout, '{"custom":"layout"}');
    fs.writeFileSync(audio, "disabled by user");
    const registryKey = "HKCU\\" + registryPath;
    const registered = run("reg.exe", [
      "add",
      registryKey,
      "/v",
      "Inno Setup: App Path",
      "/t",
      "REG_SZ",
      "/d",
      existing,
      "/f",
    ]);
    assert.equal(registered.status, 0, registered.stderr);
    try {
      const result = run(
        path.join(root, "fixture.exe"),
        ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"],
        { GROBY_TEST_SETUP_FAILURE: "feature" },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.existsSync(path.join(existing, "scripts", "check-installation.js")), true);
      assert.equal(fs.readFileSync(layout, "utf8"), '{"custom":"layout"}');
      assert.equal(fs.readFileSync(audio, "utf8"), "disabled by user");
    } finally {
      assert.equal(run("reg.exe", ["delete", registryKey, "/f"]).status, 0);
    }
  },
);

test(
  "portable WebView helper rejects an unsigned bundled payload",
  { skip: process.platform !== "win32" },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "grobys-webview-signature-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "optional-components/prerequisites"), { recursive: true });
    const bytes = Buffer.from("unsigned fixture executable"),
      filename = "fixture.exe";
    fs.writeFileSync(path.join(root, "optional-components/prerequisites", filename), bytes);
    fs.writeFileSync(
      path.join(root, "scripts/prerequisites.json"),
      JSON.stringify({
        webview2: {
          minimumMajor: spec.minimumMajor,
          file: filename,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        },
      }),
    );
    const helper = fs
      .readFileSync(path.join(__dirname, "../scripts/install-webview2.ps1"), "utf8")
      .replace("if (Test-WebViewRuntime) {", "if ($false) {");
    const file = path.join(root, "scripts/install-webview2.ps1");
    fs.writeFileSync(file, helper);
    const result = run(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
      { PSModulePath: path.join(root, "incompatible-parent-modules") },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /signature verification failed/);
  },
);
