/** Account-scoped intake admission; independent of reward IDs and request mode. */
const fs = require("node:fs");
const { writeJsonFile } = require("../../shared/fs/json-file-store");
const purposes = ["lights", "teach", "song_request", "add_to_playlist"];
module.exports = (file) => {
  let state = { version: 1, accounts: {} },
    invalid = false;
  if (fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        saved.version !== 1 ||
        !saved.accounts ||
        Array.isArray(saved.accounts) ||
        Object.keys(saved.accounts).length > 128
      )
        throw Error();
      for (const [owner, row] of Object.entries(saved.accounts)) {
        if (
          !/^\d{1,20}$/.test(owner) ||
          !row ||
          Object.entries(row).some(
            ([key, value]) => !["all", ...purposes].includes(key) || typeof value !== "boolean",
          )
        )
          throw Error();
      }
      state = saved;
    } catch {
      invalid = true;
    }
  }
  const paused = (owner, purpose = "all") =>
    invalid ||
    state.accounts[owner]?.all === true ||
    (purpose === "all"
      ? purposes.every((key) => state.accounts[owner]?.[key] === true)
      : state.accounts[owner]?.[purpose] === true);
  function set(owner, purpose, value) {
    if (invalid) throw Error("twitch_intake_state_unavailable");
    if (
      !/^\d{1,20}$/.test(owner || "") ||
      !["all", ...purposes].includes(purpose) ||
      typeof value !== "boolean"
    )
      throw Error("twitch_intake_request_invalid");
    if (!state.accounts[owner] && Object.keys(state.accounts).length >= 128)
      throw Error("twitch_intake_account_limit");
    const next = structuredClone(state);
    next.accounts[owner] =
      purpose === "all" ? { all: value } : { ...next.accounts[owner], [purpose]: value };
    writeJsonFile(file, next, { mode: 0o600 });
    state = next;
  }
  return { paused, set };
};
