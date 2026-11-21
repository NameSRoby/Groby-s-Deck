/** State and request handling for the Core Updates panel. */
globalThis.initCoreUpdates = ({ byId, request }) => {
  const status = byId("updateStatus");
  const notice = byId("updateNotice");
  const checkOnLaunch = byId("checkUpdatesOnLaunch");
  const save = byId("saveUpdatePreference");
  const check = byId("checkForUpdate");
  const download = byId("downloadUpdate");
  const install = byId("applyUpdate");
  const rollback = byId("rollbackUpdate");
  let current;
  let busy = false;
  let restarting = false;

  function controls() {
    const locked = busy || restarting;
    check.disabled = locked;
    checkOnLaunch.disabled = locked || !current;
    save.disabled = checkOnLaunch.disabled || checkOnLaunch.checked === current.checkOnLaunch;
    download.disabled = locked || current?.latest?.available !== true;
    install.disabled = locked || current?.hosted !== true || current.staged?.verified !== true;
    rollback.disabled = locked || current?.hosted !== true || !current.rollback;
  }

  function message(text, failed = false) {
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

    if (value.checking) {
      status.textContent = "Checking";
      message("Checking for stable releases…");
    } else if (value.lastError) {
      status.textContent = "Check failed";
      message("Could not check for updates. " + value.lastError.replaceAll("_", " "), true);
    } else if (value.staged?.verified) {
      status.textContent = "Ready to install";
      message(`Version ${value.staged.version} is downloaded and verified.`);
    } else if (value.latest?.available) {
      status.textContent = "Update available";
      message(`Version ${value.latest.version} is available. Download verifies its checksum.`);
    } else if (value.latest) {
      status.textContent = "Up to date";
      message("You have the latest stable release.");
    } else {
      status.textContent = "Not checked";
      message("Use Check now to look for a stable release.");
    }
  }

  async function run(action, { progress, failure, body, onSuccess = render }) {
    if (busy || restarting) return;
    busy = true;
    message(progress);
    controls();
    try {
      const options =
        action === "status"
          ? undefined
          : {
              method: "POST",
              body: JSON.stringify(body || {}),
            };
      onSuccess(await request(`/system/update/${action}`, options));
    } catch (error) {
      if (!current) status.textContent = "Unavailable";
      message(`${failure} ${error.message.replaceAll("_", " ")}`, true);
    } finally {
      busy = false;
      controls();
    }
  }

  function requestRestart(action, progress, success, failure) {
    return run(action, {
      progress,
      failure,
      onSuccess() {
        restarting = true;
        status.textContent = "Restarting";
        message(success);
      },
    });
  }

  checkOnLaunch.onchange = controls;
  save.onclick = () =>
    run("configure", {
      progress: "Saving preference…",
      failure: "Could not save the update preference.",
      body: { checkOnLaunch: checkOnLaunch.checked },
      onSuccess(value) {
        render(value);
        if (!value.lastError) message("Update preference saved.");
      },
    });
  check.onclick = () =>
    run("check", {
      progress: "Checking for stable releases…",
      failure: "Could not check for updates.",
    });
  download.onclick = () =>
    run("download", {
      progress: "Downloading and verifying the release…",
      failure: "Download failed. Use Download and verify to retry.",
    });
  install.onclick = () => {
    if (
      confirm(
        `Install Groby’s Deck ${current.staged.version}? The app will create a rollback snapshot and restart.`,
      )
    )
      return requestRestart(
        "apply",
        "Preparing to install…",
        "Update started. Groby’s Deck will reopen after its health check.",
        "Could not install the update.",
      );
  };
  rollback.onclick = () => {
    if (
      confirm(
        `Restore Groby’s Deck ${current.rollback.version}? The app will preserve your settings and installed features.`,
      )
    )
      return requestRestart(
        "rollback",
        "Preparing to roll back…",
        "Rollback started. Groby’s Deck will reopen on the previous version.",
        "Could not roll back.",
      );
  };
  return () =>
    run("status", {
      progress: "Loading update status…",
      failure: "Could not load update status. Use Check now to try again.",
    });
};
