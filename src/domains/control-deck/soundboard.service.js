/** Shared action owner for buttons, timed flows and Twitch automations. */
const path = require("node:path");
const { fault } = require("./control-deck-config");

function cableRole(endpoint, role) {
  const name = endpoint?.name || "";
  const adapter = String(endpoint?.adapter || name);
  if (!/\bvb-audio\b.*\bcable\b/i.test(adapter)) return "";
  const cable = name.match(/\b((?:hi-fi )?cable(?:-[a-d])?) (input|output)\b/i);
  return cable?.[2].toLowerCase() === role ? cable[1].toLowerCase() : "";
}

function selectableOutputs(outputs, inputs) {
  return outputs.map((output) => {
    const cable = cableRole(output, "input");
    const matches = cable ? inputs.filter((input) => cableRole(input, "output") === cable) : [];
    // Two installed cables can expose the same name. Leave those as playback choices.
    const name = matches.length === 1 ? "Virtual mic: " + matches[0].name : output.name;
    return { key: output.key, name: name.slice(0, 128) };
  });
}

module.exports = function soundboard({
  rootDir,
  runtimeDir = path.join(rootDir, "runtime"),
  platform = process.platform,
  request: injected,
}) {
  const library = require("./soundboard-library")(runtimeDir);
  const bridge = injected
    ? null
    : require("./windows-bridge")({
        rootDir,
        scriptName: "windows-soundboard.ps1",
        idleTimeoutMs: 0,
      });
  const request = injected || bridge.request;
  const recent = new Map();
  let state = { available: false, outputs: [], playing: [], error: "" },
    flight,
    readAt = 0;
  async function refresh(force = false) {
    if (platform !== "win32") return state;
    if (!force && Date.now() - readAt < 5000) return state;
    if (!flight)
      flight = request("soundboard.status", {})
        .then((next) => {
          if (
            !Array.isArray(next?.outputs) ||
            next.outputs.length > 64 ||
            next.outputs.some(
              (row) => !/^device:[a-f0-9]{64}$/.test(row.key) || typeof row.name !== "string",
            )
          )
            throw fault("soundboard_state_invalid");
          const { inputs, ...status } = next;
          const recording = Array.isArray(inputs)
            ? inputs.slice(0, 64).filter((row) => typeof row?.name === "string")
            : [];
          state = { ...status, outputs: selectableOutputs(next.outputs, recording) };
          readAt = Date.now();
          return state;
        })
        .catch((error) => {
          state = {
            available: false,
            outputs: [],
            playing: [],
            error: error.code || "soundboard_unavailable",
          };
          readAt = Date.now();
          return state;
        })
        .finally(() => {
          flight = null;
        });
    return flight;
  }
  function catalog() {
    const clips = library.list(),
      outputNames = Object.fromEntries(state.outputs.map((row) => [row.key, row.name]));
    const clip = {
      type: "string",
      title: "Audio file",
      format: "soundboard-clip",
      enum: clips.map((row) => row.id),
      enumNames: Object.fromEntries(clips.map((row) => [row.id, row.name])),
    };
    const row = (id, label, properties, required, defaults) => ({
      id,
      label,
      group: "Soundboard",
      symbol: "♪",
      available: platform === "win32",
      description:
        "Choose an audio file and play it through speakers, headphones or an available virtual microphone feed.",
      parameters: { type: "object", additionalProperties: false, properties, required },
      defaults,
    });
    return [
      row(
        "native.soundboard.play",
        "Play sound file",
        {
          clip,
          outputs: {
            type: "array",
            title: "Audio destinations",
            format: "soundboard-outputs",
            minItems: 1,
            maxItems: 8,
            items: { type: "string", enum: ["default", ...Object.keys(outputNames)] },
            enumNames: { default: "Windows default output", ...outputNames },
          },
          volume: {
            type: "integer",
            title: "Sound volume (%)",
            "x-group": "Playback options",
            default: 80,
            minimum: 0,
            maximum: 100,
          },
          mode: {
            type: "string",
            title: "When pressed again",
            default: "restart",
            "x-group": "Playback options",
            enum: ["restart", "overlap", "toggle"],
            enumNames: {
              restart: "Restart this sound",
              overlap: "Play another copy",
              toggle: "Stop if already playing",
            },
          },
        },
        ["clip", "outputs"],
        { clip: "", outputs: ["default"], volume: 80, mode: "restart" },
      ),
      row(
        "native.soundboard.stop",
        "Stop sounds",
        {
          clip: {
            ...clip,
            format: undefined,
            title: "Sound to stop",
            enum: ["", ...clip.enum],
            enumNames: { "": "All sounds", ...clip.enumNames },
          },
        },
        [],
        { clip: "" },
      ),
    ];
  }
  async function execute(id, params = {}, signal) {
    if (platform !== "win32") throw fault("desktop_windows_required");
    if (signal?.aborted) throw fault("control_deck_cancelled");
    if (id === "native.soundboard.stop") {
      if (params.clip) library.read(params.clip);
      readAt = 0;
      const result = await request("soundboard.stop", { clip: params.clip || "" }, signal);
      for (const [id, row] of recent)
        if (!params.clip || params.clip === id) row.until = Date.now();
      return result;
    }
    params = { volume: 80, mode: "restart", ...params };
    if (
      id !== "native.soundboard.play" ||
      !Array.isArray(params.outputs) ||
      params.outputs.length < 1 ||
      params.outputs.length > 8 ||
      new Set(params.outputs).size !== params.outputs.length ||
      params.outputs.some(
        (output) => typeof output !== "string" || !/^(default|device:[a-f0-9]{64})$/.test(output),
      ) ||
      !Number.isInteger(params.volume) ||
      params.volume < 0 ||
      params.volume > 100 ||
      !["restart", "overlap", "toggle"].includes(params.mode)
    )
      throw fault("soundboard_request_invalid");
    const file = library.read(params.clip);
    readAt = 0;
    const result = await request("soundboard.play", { ...params, file }, signal);
    if (Number.isFinite(result.durationSeconds) && result.durationSeconds > 0) {
      const at = Date.now();
      recent.delete(params.clip);
      recent.set(params.clip, { at, until: at + result.durationSeconds * 1000 });
      while (recent.size > 64) recent.delete(recent.keys().next().value);
    } else if (params.mode === "toggle" && recent.has(params.clip))
      recent.get(params.clip).until = Date.now();
    return result;
  }
  return {
    catalog,
    execute,
    refresh,
    library,
    presentation: () => {
      const at = Date.now(),
        clips = library.list();
      for (const [id, row] of recent) if (at - row.at > 120000 && row.until < at) recent.delete(id);
      return [...recent].map(([id, row]) => ({
        name: clips.find((clip) => clip.id === id)?.name || "Sound",
        at: row.at,
        playing: row.until > at && (readAt < row.at || state.playing.includes(id)),
      }));
    },
    snapshot: () => ({ ...structuredClone(state), clips: library.list() }),
    shutdown: () => bridge?.shutdown(),
  };
};
