/**
 * Injector.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#desktop-companions
 */
// Runs inside TIDAL's Electron runtime; no separate Electron dependency is shipped.
const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const bundle = __dirname;
function diagnostic(stage, error) {
  try {
    const filename = path.join(process.resourcesPath, "ravelink-tidal-startup.log");
    if (fs.existsSync(filename) && fs.statSync(filename).size > 65536)
      fs.writeFileSync(filename, "");
    const code = String(error?.code || error?.name || "")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 60);
    fs.appendFileSync(filename, `${new Date().toISOString()} ${stage}${code ? " " + code : ""}\n`);
  } catch {
    /* Diagnostics must never prevent TIDAL startup. */
  }
}
diagnostic("bootstrap-start");
const original = path.join(process.resourcesPath, "ravelink-original.asar");
const manifest = JSON.parse(fs.readFileSync(path.join(original, "package.json"), "utf8"));
let bridge, runtime, transform;
try {
  transform = require("./transform.cjs").transform;
  bridge = require("./native-bridge.cjs").createNativeBridge(
    JSON.parse(fs.readFileSync(path.join(bundle, "config.json"), "utf8")),
    (...args) => electron.net.fetch(...args),
  );
  runtime = fs.readFileSync(path.join(bundle, "renderer.js"), "utf8");
} catch (error) {
  diagnostic("companion-config-disabled", error);
}
const trusted = (url) => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      ["desktop.tidal.com", "listen.tidal.com"].includes(parsed.hostname) &&
      !parsed.port
    );
  } catch {
    return false;
  }
};
const windows = new Set();
const hookedSessions = new WeakSet();
function installSession(session) {
  if (
    !runtime ||
    !session ||
    hookedSessions.has(session) ||
    (electron.app.isReady && !electron.app.isReady())
  )
    return;
  hookedSessions.add(session);
  try {
    const preload = path.join(bundle, "preload.cjs");
    if (session.registerPreloadScript)
      session.registerPreloadScript({ type: "frame", filePath: preload });
    else session.setPreloads([...session.getPreloads(), preload]);
  } catch (error) {
    diagnostic("preload-hook-disabled", error);
  }
  try {
    const protocol =
      session.protocol || (session === electron.session.defaultSession ? electron.protocol : null);
    const fetchAsset =
      typeof session.fetch === "function"
        ? session.fetch.bind(session)
        : session === electron.session.defaultSession
          ? electron.net.fetch.bind(electron.net)
          : null;
    if (!protocol?.handle || !fetchAsset || typeof Response !== "function")
      throw Error("tidal_electron_unsupported");
    protocol.handle("https", async (request) => {
      const response = await fetchAsset(request, { bypassCustomProtocolHandlers: true });
      if (
        !trusted(request.url) ||
        !/^\/assets\/[\w.-]+\.js$/.test(new URL(request.url).pathname) ||
        !response.ok
      )
        return response;
      // Keep the original response intact so optional integration failures never
      // replace a working TIDAL asset with a network error or consumed body.
      try {
        const reader = response.clone().body.getReader(),
          chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16000000) {
            void reader.cancel().catch(() => {});
            return response;
          }
          chunks.push(Buffer.from(value));
        }
        const source = Buffer.concat(chunks).toString("utf8");
        const patched = transform(source);
        if (!patched.actionHooks && !patched.storeHooks) return response;
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        headers.delete("etag");
        const wrappedRuntime = "try{\n" + runtime + "\n}catch{}\n";
        return new Response(wrappedRuntime + patched.code, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        diagnostic("asset-hook-disabled", error);
        return response;
      }
    });
  } catch (error) {
    diagnostic("protocol-hook-disabled", error);
  }
}
// Observe real Electron windows instead of replacing its module exports. TIDAL's
// cached/named imports can otherwise bypass a BrowserWindow proxy entirely.
electron.app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "window") return;
  installSession(contents.session);
  const id = contents.id;
  windows.add(id);
  diagnostic("window-created");
  contents.on("destroyed", () => windows.delete(id));
  contents.on("did-finish-load", () => diagnostic("window-loaded"));
  contents.on("did-fail-load", () => diagnostic("window-load-failed"));
});
try {
  electron.ipcMain.handle("ravelink-tidal-command", (event, method, payload) => {
    if (
      !windows.has(event.sender.id) ||
      event.senderFrame !== event.sender.mainFrame ||
      !trusted(event.senderFrame.url)
    )
      throw new Error("tidal_sender_invalid");
    if (!bridge) throw new Error("tidal_companion_config_invalid");
    return bridge.call(method, payload);
  });
} catch (error) {
  bridge = null;
  runtime = undefined;
  diagnostic("ipc-hook-disabled", error);
}
// Protocols, cookies and preloads belong to a session. Register before the
// original app's ready handlers and also cover windows using another partition.
electron.app.on("ready", () => installSession(electron.session.defaultSession));
electron.app
  .whenReady()
  .then(() => installSession(electron.session.defaultSession))
  .catch((error) => {
    diagnostic("protocol-hook-disabled", error);
  });
const originalRequire = Module.createRequire(path.join(original, "package.json"));
electron.app.setAppPath(original);
electron.app.setName(manifest.name);
const entry = path.resolve(original, manifest.main);
if (!entry.startsWith(original + path.sep)) throw new Error("tidal_entry_invalid");
diagnostic("original-entry-start");
try {
  originalRequire(entry);
} catch (error) {
  diagnostic("original-entry-failed", error);
  throw error;
}
