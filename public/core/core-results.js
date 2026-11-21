/** Render safe action summaries and optional developer details. */
globalThis.initCoreResults = (byId) => {
  const sensitiveDisplayKey =
    /(?:authorization|cookie|credential|password|secret|token|jwt|username|clientkey)/i;
  const networkDisplayKey = /(?:ip|host|url|bridgeid|deviceid)$/i;
  function redactDisplayString(value) {
    return String(value ?? "")
      .replace(
        /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
        (address) => `${address.split(".").slice(0, 2).join(".")}.x.x`,
      )
      .replace(/\beyJ[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]{8,}){1,2}\b/g, "[REDACTED TOKEN]")
      .replace(/\b[a-fA-F0-9]{24,}\b/g, (value) => `${value.slice(0, 4)}...[REDACTED]`);
  }
  function safeDisplayValue(value, key = "", depth = 0) {
    if (sensitiveDisplayKey.test(key) && !/(?:configured|present)$/i.test(key)) return "[REDACTED]";
    if (networkDisplayKey.test(key)) return value ? redactDisplayString(value) : value;
    if (depth >= 5) return "[TRUNCATED]";
    if (Array.isArray(value))
      return value.slice(0, 20).map((item) => safeDisplayValue(item, key, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 40)
          .map(([childKey, child]) => [childKey, safeDisplayValue(child, childKey, depth + 1)]),
      );
    return typeof value === "string" ? redactDisplayString(value) : value;
  }
  function showResult(id, value, failed = false) {
    const output = byId(id);
    output.hidden = false;
    const safe = safeDisplayValue(value);
    const previousDetails = byId(`${id}DeveloperDetails`);
    previousDetails?.remove();
    if (typeof safe === "string") output.textContent = safe;
    else {
      const count = Array.isArray(safe?.installed)
        ? safe.installed.length
        : Array.isArray(safe?.fixtures)
          ? safe.fixtures.length
          : null;
      output.textContent =
        failed || safe?.ok === false
          ? "ACTION FAILED"
          : count !== null
            ? `${count} FIXTURE${count === 1 ? "" : "S"} SAVED`
            : safe?.operation
              ? `${String(safe.operation).replaceAll("_", " ").toUpperCase()} COMPLETE`
              : "ACTION COMPLETED";
      const details = document.createElement("pre");
      details.id = `${id}DeveloperDetails`;
      details.className = "result developerDetails";
      details.dataset.developerOnly = "true";
      details.textContent = JSON.stringify(safe, null, 2);
      output.after(details);
    }
    output.style.color = failed ? "var(--bad)" : "#c9d8ff";
  }
  return { showResult, redactDisplayString };
};
