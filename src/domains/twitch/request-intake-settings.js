/** One source preference shared by Widget and every music player's Setup page. */
module.exports = ({ file, provider, registry }) => {
  const { readJsonFile, writeJsonFile } = require("../../shared/fs/json-file-store");
  let choice = readJsonFile(file, { source: "auto" }).source;
  if (!["auto", "native", "streamelements"].includes(choice)) choice = "auto";
  let pending = Promise.resolve();
  const status = () => {
    const available =
      registry()
        ?.list()
        .features.some((row) => row.id === "twitch-integration" && row.lifecycle === "active") ===
      true;
    const state = provider().status();
    return {
      ok: true,
      twitchAvailable: available,
      connected: state.connected,
      source: choice,
      effectiveSource: available && choice !== "streamelements" ? "native" : "streamelements",
      songRequestChatEnabled: available && state.monitorConfig.songRequestChatEnabled === true,
    };
  };
  const configure = (input) => {
    const run = async () => {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => !["source", "songRequestChatEnabled"].includes(key)) ||
        (input.songRequestChatEnabled !== undefined &&
          typeof input.songRequestChatEnabled !== "boolean")
      )
        throw Error("Invalid intake settings.");
      if (input.source !== undefined) {
        if (!["auto", "native", "streamelements"].includes(input.source))
          throw Error("Invalid event source.");
        choice = input.source;
        writeJsonFile(file, { source: choice }, { mode: 0o600 });
      }
      const state = status(),
        current = provider().status().monitorConfig;
      const next = {
        intakeMode: state.effectiveSource,
        songRequestChatEnabled:
          state.twitchAvailable &&
          (input.songRequestChatEnabled ?? current.songRequestChatEnabled) === true,
      };
      if (
        current.intakeMode !== next.intakeMode ||
        current.songRequestChatEnabled !== next.songRequestChatEnabled
      )
        await provider().configureMonitor(next);
      return status();
    };
    const task = pending.then(run);
    pending = task.catch(() => {});
    return task;
  };
  return { status, configure };
};
