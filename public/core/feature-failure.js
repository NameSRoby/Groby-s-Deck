/** Startup reports contain package metadata and classified codes, never raw errors. */
export function describeFeatureFailure(feature) {
  const error = typeof feature.error === "string" ? feature.error : "";
  if (["active_rss_limit", "idle_cpu_limit"].includes(feature.stateReason))
    return {
      code: feature.stateReason,
      description: "The package exceeded its resource limit. Restart it from Packages.",
    };
  if (error === "feature_update_required")
    return {
      code: error,
      description: "This package needs an update for the installed Core. Update it from Packages.",
    };
  if (error === "runtime_isolation_unavailable")
    return {
      code: error,
      description:
        "The Windows runtime is incompatible. Repair the app using the complete current installer.",
    };
  if (error.includes("broker_timeout") || error.includes("request_deadline_exceeded"))
    return {
      code: "startup_read_timeout",
      description:
        "Startup took too long while loading saved data. Restart the package; your saved data was retained.",
    };
  if (error === "activation_timeout")
    return {
      code: error,
      description: "The package did not finish starting in time. Restart it from Packages.",
    };
  if (
    /song_settings_restore_failed|song_settings_read_failed|song_settings_snapshot_rejected/.test(
      error,
    )
  )
    return {
      code: "settings_restore_failed",
      description:
        "Saved settings could not be restored. Your data was retained; copy this report before attempting a repair.",
    };
  if (/MODULE_NOT_FOUND|Cannot find module|ENOENT/.test(error))
    return {
      code: "package_files_missing",
      description:
        "Required package files are missing. Update or repair the package from Packages.",
    };
  if (/ERR_ACCESS_DENIED|EACCES|EPERM/.test(error))
    return {
      code: "package_access_denied",
      description:
        "Windows denied access to a required file. Copy this report and check the installation's access permissions.",
    };
  if (/^feature_exit_(?:\d{1,10}|null)_(?:none|SIGTERM|SIGKILL|SIGABRT|SIGSEGV)$/.test(error))
    return {
      code: error,
      description:
        "The package process exited. Restart it from Packages and copy this report if it fails again.",
    };
  return {
    code: "package_startup_failed",
    description:
      "The package could not start. Restart it from Packages and copy this report if it fails again.",
  };
}

export function createFeatureFailureDetails(feature) {
  const failure = describeFeatureFailure(feature);
  const safe = (value, pattern) =>
    typeof value === "string" && pattern.test(value) ? value : "unknown";
  const report = [
    "Groby's Deck package startup",
    `Package: ${safe(feature.id, /^[a-z][a-z0-9-]{1,63}$/)}`,
    `Version: ${safe(feature.version, /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/)}`,
    `State: ${safe(feature.lifecycle, /^[a-z-]{1,32}$/)}`,
    `Code: ${failure.code}`,
  ].join("\n");
  const details = document.createElement("details");
  details.className = "featureFailureDetails";
  const summary = document.createElement("summary");
  summary.textContent = "Startup details";
  const explanation = document.createElement("p");
  explanation.textContent = failure.description;
  const text = document.createElement("textarea");
  text.readOnly = true;
  text.rows = 5;
  text.setAttribute("aria-label", "Startup report");
  text.value = report;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy startup report";
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(report);
      copy.textContent = "Report copied";
    } catch {
      text.focus();
      text.select();
      copy.textContent = "Select and copy the report above";
    }
  };
  details.append(summary, explanation, text, copy);
  return details;
}
