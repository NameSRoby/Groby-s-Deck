/** Update steps and the status reported by the Windows launcher. */
globalThis.initCoreUpdates = ({ byId, request }) => {
  const status = byId("updateStatus");
  const notice = byId("updateNotice");
  const progress = byId("updateProgress");
  const checkOnLaunch = byId("checkUpdatesOnLaunch");
  const check = byId("checkForUpdate");
  const download = byId("downloadUpdate");
  const install = byId("applyUpdate");
  const rollback = byId("rollbackUpdate");
  let current;
  let busy = false;
  let timer;
  let revision = 0;
  let reconnectUntil = 0;

  const working = () =>
    current?.checking ||
    current?.downloading ||
    ["preparing", "restarting"].includes(current?.operation?.phase);
  const read = () => request("/system/update/status", { cache: "no-store" });
  const post = (action, body = {}) =>
    request("/system/update/" + action, { method: "POST", body: JSON.stringify(body) });

  function controls() {
    const locked = busy || working();
    check.disabled = locked;
    checkOnLaunch.disabled = locked || !current;
    install.hidden = !(current?.hosted && current.staged?.verified);
    install.disabled = locked;
    download.hidden =
      !current?.latest?.available || current.staged?.version === current.latest.version;
    download.disabled = locked;
    download.textContent = current?.hosted ? "Download and restart" : "Download update";
    rollback.disabled = locked || !current?.hosted || !current.rollback;
  }

  function message(title, text, failed = false) {
    status.textContent = title;
    notice.textContent = text;
    notice.classList.toggle("bad", failed);
  }

  function render(value) {
    current = value;
    byId("installedVersion").textContent = value.currentVersion || "Unknown";
    byId("latestVersion").textContent = value.latest?.version || "Not checked";
    byId("stagedVersion").textContent = value.staged?.version || "None";
    byId("rollbackVersion").textContent = value.rollback?.version || "None";
    checkOnLaunch.checked = value.checkOnLaunch === true;
    progress.hidden = !value.downloading;
    const { received, total } = value.progress || {};
    if (total > 0) {
      progress.max = total;
      progress.value = received;
    } else progress.removeAttribute("value");

    const phase = value.operation?.phase;
    const target = value.operation?.version;
    if (phase === "restarting") {
      reconnectUntil ||= Date.now() + 90000;
      message(
        "Restarting",
        "Groby’s Deck is installing the verified files and will reopen automatically.",
      );
    } else if (phase === "preparing") {
      message(
        "Preparing",
        "Checking the update files. You can keep using the app while this finishes.",
      );
    } else if (value.downloading) {
      message("Downloading", "Downloading the release and verifying its checksum…");
    } else if (value.checking) {
      message("Checking", "Checking for stable releases…");
    } else if (phase === "failed" || phase === "rolled-back") {
      message(
        phase === "rolled-back" ? "Previous version restored" : "Update failed",
        "See runtime/updates/update.log for details. You can retry from here.",
        true,
      );
    } else if (value.lastError) {
      message(
        "Check failed",
        "Could not check for updates. " + value.lastError.replaceAll("_", " "),
        true,
      );
    } else if (value.staged?.verified) {
      message(
        "Ready to install",
        "Version " +
          value.staged.version +
          " is verified. " +
          (value.hosted ? "Restart to install it." : "Open the Windows desktop app to install it."),
      );
    } else if (value.latest?.available) {
      message("Update available", "Version " + value.latest.version + " is ready to download.");
    } else if (phase === "installed" || phase === "restored") {
      message(
        phase === "installed" ? "Update installed" : "Version restored",
        "Groby’s Deck " + target + " is running.",
      );
    } else if (value.latest) {
      message("Up to date", "You have the latest stable release.");
    } else {
      message("Not checked", "Check for a stable release.");
    }
    if (phase !== "restarting") reconnectUntil = 0;
    controls();
  }

  function poll() {
    clearTimeout(timer);
    if (!busy && !working()) return;
    timer = setTimeout(async () => {
      const started = revision;
      try {
        const value = await read();
        if (
          revision === started &&
          (!busy || value.downloading || value.checking || value.operation?.phase === "preparing")
        )
          render(value);
      } catch {
        if (revision === started && reconnectUntil && Date.now() >= reconnectUntil) {
          current.operation = null;
          reconnectUntil = 0;
          message(
            "Waiting for the app",
            "If Groby’s Deck hasn’t reopened, start it from Windows and check the update log.",
            true,
          );
          controls();
        }
      }
      poll();
    }, 1000);
  }

  async function run(task, title, text, failure) {
    if (busy || working()) return;
    revision++;
    busy = true;
    message(title, text);
    controls();
    poll();
    try {
      render(await task());
    } catch (error) {
      if (current?.downloading) current.downloading = false;
      progress.hidden = true;
      checkOnLaunch.checked = current?.checkOnLaunch === true;
      message(
        current ? "Try again" : "Unavailable",
        failure + " " + error.message.replaceAll("_", " "),
        true,
      );
    } finally {
      revision++;
      busy = false;
      controls();
      poll();
    }
  }

  checkOnLaunch.onchange = () =>
    run(
      () => post("configure", { checkOnLaunch: checkOnLaunch.checked }),
      "Saving",
      "Saving preference…",
      "Could not save the preference.",
    );
  check.onclick = () =>
    run(
      () => post("check"),
      "Checking",
      "Checking for stable releases…",
      "Could not check for updates.",
    );
  download.onclick = () =>
    run(
      async () => {
        const staged = await post("download");
        if (!staged.hosted) return staged;
        render(staged);
        message("Preparing", "Preparing to install the verified update…");
        return post("apply");
      },
      "Downloading",
      "Downloading the release and verifying its checksum…",
      "Could not finish the update.",
    );
  install.onclick = () =>
    run(
      () => post("apply"),
      "Preparing",
      "Preparing to install the verified update…",
      "Could not start the update.",
    );
  rollback.onclick = () => {
    if (confirm("Restore Groby’s Deck " + current.rollback.version + " and restart?"))
      return run(
        () => post("rollback"),
        "Preparing",
        "Checking the recovery snapshot…",
        "Could not start recovery.",
      );
  };
  return () => run(read, "Loading", "Loading update status…", "Could not load update status.");
};
