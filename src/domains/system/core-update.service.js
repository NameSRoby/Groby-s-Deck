/**
 * Managed update staging and recovery.
 * Application-managed files may be replaced; mutable configuration, installed
 * features, secrets, and runtime data must survive. A staged artifact is not an
 * accepted update until the expected version passes health confirmation. Preserve
 * the rollback record until that confirmation or an explicit recovery decision.
 */
// [TITLE] Module: domains/system/core-update.service.js
// [TITLE] Purpose: opt-in, verified GitHub release discovery and Windows update staging

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const REPOSITORY = "NameSRoby/Groby-s-Deck";
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_CHECKSUM_BYTES = 128 * 1024;
const MAX_ARCHIVE_BYTES = 750 * 1024 * 1024;

function parseVersion(value) {
  const match = /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:\.(0|[1-9]\d{0,8}))?([a-z])?$/.exec(
    String(value || "").trim(),
  );
  return match
    ? [
        ...match.slice(1, 4).map((part) => Number(part || 0)),
        ...(match[4] ? [match[4].charCodeAt(0) - 96] : []),
      ]
    : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left),
    b = parseVersion(right);
  if (!a || !b) throw new Error("invalid_release_version");
  for (let index = 0; index < 4; index++)
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) < (b[index] || 0) ? -1 : 1;
  return 0;
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

function localVersion(rootDir) {
  const release = readJson(path.join(rootDir, "RELEASE_BUILD.json"));
  const pkg = readJson(path.join(rootDir, "package.json"), {});
  return String(release?.version || pkg.releaseVersion || pkg.version || "0.0.0").replace(
    /-dev$/i,
    "",
  );
}

function safeAsset(release, name) {
  const asset = Array.isArray(release?.assets)
    ? release.assets.find((row) => row?.name === name)
    : null;
  if (!asset) throw new Error(`release_asset_missing:${name}`);
  const url = new URL(String(asset.browser_download_url || ""));
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !url.pathname.startsWith(`/${REPOSITORY}/releases/download/`)
  ) {
    throw new Error("release_asset_origin_invalid");
  }
  return { name, url: url.href, size: Number(asset.size || 0) };
}

async function readLimited(response, maximum) {
  if (!response.ok) throw new Error(`release_http_${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maximum) throw new Error("release_response_too_large");
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body || []) {
    received += chunk.length;
    if (received > maximum) throw new Error("release_response_too_large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, received);
}

async function downloadFile(fetchImpl, url, destination, maximum, progress) {
  const response = await fetchImpl(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120000),
    headers: {
      "User-Agent": "RaveLink-Core-Updater",
      Accept: "application/octet-stream",
    },
  });
  if (!response.ok) throw new Error(`release_http_${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maximum) throw new Error("release_archive_too_large");
  progress.total = length || progress.total;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.rmSync(temporary, { force: true });
  const output = fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 });
  const hash = crypto.createHash("sha256");
  let received = 0;
  try {
    if (!response.body) throw new Error("release_archive_empty");
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > maximum) return callback(new Error("release_archive_too_large"));
        progress.received = received;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), meter, output);
    fs.renameSync(temporary, destination);
    return { bytes: received, sha256: hash.digest("hex") };
  } catch (error) {
    output.destroy();
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function createCoreUpdateService(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, "../../.."));
  const runtimeDir = path.resolve(options.runtimeDir || path.join(rootDir, "runtime"));
  const updateDir = path.join(runtimeDir, "updates");
  const settingsPath = path.join(updateDir, "settings.json");
  const stagedPath = path.join(updateDir, "staged.json");
  const availableRollbackPath = path.join(updateDir, "available-rollback.json");
  const operationPath = path.join(updateDir, "operation.json");
  const fetchImpl = options.fetch || globalThis.fetch;
  let latest = null;
  let checking = null;
  let progress = null;
  let lastError = "";
  const hosted = process.platform === "win32" && process.env.RAVELINK_WINDOWS_HOST === "1";
  const canRestart = hosted && process.env.RAVELINK_WINDOWS_UPDATE_PROTOCOL === "1";

  function settings() {
    const value = readJson(settingsPath, {});
    return { checkOnLaunch: value?.checkOnLaunch === true };
  }

  function status() {
    const currentVersion = localVersion(rootDir);
    const staged = readJson(stagedPath);
    const rollback = readJson(availableRollbackPath);
    const operation = readJson(operationPath);
    const phase =
      (activeOperation(operation) && !canRestart) ||
      (activeOperation(operation) && Date.now() - Date.parse(operation.startedAt) > 600000)
        ? "failed"
        : operation?.phase;
    return {
      ok: true,
      currentVersion,
      checkOnLaunch: settings().checkOnLaunch,
      checking: Boolean(checking),
      downloading: Boolean(progress),
      progress: progress ? { ...progress } : null,
      latest: latest
        ? {
            version: latest.version,
            name: latest.name,
            publishedAt: latest.publishedAt,
            available: compareVersions(currentVersion, latest.version) < 0,
            installerUrl: latest.installerUrl,
          }
        : null,
      staged: usableStage(staged, currentVersion)
        ? { version: staged.version, verified: true }
        : null,
      rollback: rollback ? { version: String(rollback.previousVersion || "") } : null,
      hosted,
      canRestart,
      operation: phase ? { phase, action: operation.action, version: operation.version } : null,
      lastError,
    };
  }

  const activeOperation = (value) => ["preparing", "restarting"].includes(value?.phase);
  function usableStage(staged, currentVersion) {
    return (
      staged?.verified === true &&
      parseVersion(staged.version) &&
      compareVersions(currentVersion, staged.version) < 0 &&
      typeof staged.archivePath === "string" &&
      fs.existsSync(staged.archivePath)
    );
  }

  function configure(value = {}) {
    writeJsonAtomic(settingsPath, {
      checkOnLaunch: value.checkOnLaunch === true,
    });
    return status();
  }

  function check() {
    if (!checking) checking = loadRelease().then(status);
    return checking;
  }

  async function loadRelease() {
    lastError = "";
    try {
      const response = await fetchImpl(RELEASE_API, {
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent": "RaveLink-Core-Updater",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      const body = JSON.parse((await readLimited(response, MAX_METADATA_BYTES)).toString("utf8"));
      if (body?.draft || body?.prerelease) throw new Error("release_is_not_stable");
      const version = String(body?.tag_name || "").replace(/^v/, "");
      if (!parseVersion(version)) throw new Error("invalid_release_version");
      const archiveBase = `Grobys-Deck-Windows-v${version}`;
      const legacyName = archiveBase + "-self-contained.zip";
      const archiveName = body.assets?.some?.((asset) => asset?.name === legacyName)
        ? legacyName
        : archiveBase + ".zip";
      const installerName = archiveBase + "-setup-installer.exe";
      latest = {
        version,
        name: String(body.name || `Groby’s Deck v${version}`).slice(0, 160),
        publishedAt: String(body.published_at || "").slice(0, 64),
        archive: safeAsset(body, archiveName),
        checksums: safeAsset(body, "SHA256SUMS.txt"),
        installerUrl: body.assets?.some?.((asset) => asset?.name === installerName)
          ? safeAsset(body, installerName).url
          : "",
      };
    } catch (error) {
      lastError = String(error?.message || "update_check_failed").slice(0, 160);
      throw error;
    } finally {
      checking = null;
    }
  }

  async function download() {
    if (progress) throw new Error("update_download_in_progress");
    if (activeOperation(status().operation)) throw new Error("update_in_progress");
    progress = { received: 0, total: 0 };
    try {
      if (checking || !latest) await check();
      const release = latest;
      const currentVersion = localVersion(rootDir);
      const currentStage = readJson(stagedPath);
      if (compareVersions(currentVersion, release.version) >= 0)
        throw new Error("no_newer_release");
      if (currentStage?.version === release.version && usableStage(currentStage, currentVersion)) {
        progress = null;
        return status();
      }
      progress.total = release.archive.size;
      const checksumResponse = await fetchImpl(release.checksums.url, {
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent": "RaveLink-Core-Updater",
          Accept: "text/plain",
        },
      });
      const checksumText = (await readLimited(checksumResponse, MAX_CHECKSUM_BYTES)).toString(
        "ascii",
      );
      const escapedName = release.archive.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(`^([a-fA-F0-9]{64})[ \\t]+\\*?${escapedName}$`, "m").exec(
        checksumText,
      );
      if (!match) throw new Error("release_checksum_missing");
      const downloadsDir = path.join(updateDir, "downloads");
      const archivePath = path.join(downloadsDir, release.archive.name);
      const downloaded = await downloadFile(
        fetchImpl,
        release.archive.url,
        archivePath,
        MAX_ARCHIVE_BYTES,
        progress,
      );
      if (downloaded.sha256 !== match[1].toLowerCase()) {
        fs.rmSync(archivePath, { force: true });
        throw new Error("release_checksum_mismatch");
      }
      writeJsonAtomic(stagedPath, {
        version: release.version,
        archivePath,
        sha256: downloaded.sha256,
        bytes: downloaded.bytes,
        verified: true,
        stagedAt: new Date().toISOString(),
      });
      const previous = currentStage?.archivePath;
      if (
        typeof previous === "string" &&
        previous !== archivePath &&
        path.dirname(previous) === downloadsDir
      )
        fs.rmSync(previous, { force: true });
    } finally {
      progress = null;
    }
    return status();
  }

  async function launchHelper(action) {
    if (!hosted) throw new Error("windows_host_required");
    if (!canRestart) throw new Error("windows_launcher_update_required");
    if (progress || activeOperation(status().operation)) throw new Error("update_in_progress");
    const staged = readJson(stagedPath);
    const rollback = readJson(availableRollbackPath);
    if (action === "Apply" && !usableStage(staged, localVersion(rootDir)))
      throw new Error("verified_update_required");
    if (action === "Rollback" && !rollback) throw new Error("rollback_unavailable");
    const source = path.join(rootDir, "scripts", "groby-update.ps1");
    if (!fs.existsSync(source)) throw new Error("update_helper_missing");
    fs.mkdirSync(updateDir, { recursive: true });
    const runner = path.join(updateDir, "groby-update-runner.ps1");
    fs.copyFileSync(source, runner);
    const operation = {
      phase: "preparing",
      action,
      version: action === "Apply" ? staged.version : rollback.previousVersion,
      startedAt: new Date().toISOString(),
    };
    writeJsonAtomic(operationPath, operation);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(path.join(rootDir, "Groby's Deck.exe"), ["--update"], {
          windowsHide: true,
          stdio: "ignore",
          signal: AbortSignal.timeout(5000),
        });
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error("update_host_unavailable"));
        });
      });
    } catch {
      writeJsonAtomic(operationPath, { ...operation, phase: "failed" });
      throw new Error("update_host_unavailable");
    }
    return status();
  }

  function startLaunchCheck() {
    if (!settings().checkOnLaunch) return;
    const timer = setTimeout(() => check().catch(() => {}), Number(options.launchDelayMs ?? 5000));
    timer.unref?.();
  }

  return Object.freeze({
    status,
    configure,
    check,
    download,
    apply: () => launchHelper("Apply"),
    rollback: () => launchHelper("Rollback"),
    startLaunchCheck,
  });
}

module.exports = {
  createCoreUpdateService,
  compareVersions,
  parseVersion,
  RELEASE_API,
};
