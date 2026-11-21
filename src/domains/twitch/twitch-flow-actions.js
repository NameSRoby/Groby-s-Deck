/** These are action choices, never automatically-created Channel Points rewards. */
const definitions = [
  [
    "recipe",
    "Run variable recipe (no chat)",
    "",
    { message: { type: "string", title: "Recipe", minLength: 1, maxLength: 12000 } },
    { message: "" },
    "Run public variables, conditions and saved-value functions without sending chat. Use this for resets, season rollovers and data-only automation steps.",
  ],
  [
    "shoutout",
    "Send a native shoutout",
    "moderator:manage:shoutouts",
    {
      target: { type: "string", enum: ["raider", "user-id"] },
      userId: { type: "string", maxLength: 80 },
    },
    { target: "raider", userId: "" },
    "Twitch's native shoutout resolves the incoming raider when the raid arrives. Requires a live broadcast and Shoutouts access. Twitch enforces 2 minutes globally and 60 minutes per broadcaster.",
  ],
  [
    "bot-shoutout",
    "Send a bot shoutout (!so / !shoutout)",
    "user:write:chat",
    {
      target: { type: "string", enum: ["raider", "login"] },
      login: { type: "string", maxLength: 25 },
      command: { type: "string", enum: ["!so", "!shoutout"] },
    },
    { target: "raider", login: "", command: "!so" },
    "Sends !so or !shoutout to an external chat bot. That bot must be connected and recognise the command; this is separate from Twitch's native shoutout.",
  ],
  [
    "commercial",
    "Start an ad",
    "channel:edit:commercial",
    { length: { type: "integer", enum: [30, 60, 90, 120, 150, 180] } },
    { length: 30 },
    "Requires a live eligible channel. Twitch ad cooldowns apply.",
  ],
  [
    "snooze-ad",
    "Snooze the next ad break",
    "channel:manage:ads",
    {},
    {},
    "Only when Twitch offers an available snooze.",
  ],
  [
    "chat",
    "Send a chat message",
    "user:write:chat",
    { message: { type: "string", minLength: 1, maxLength: 16384 } },
    { message: "" },
    "Write a message and insert variables. Names and event values are resolved when the flow runs.",
  ],
  [
    "announcement",
    "Send a chat announcement",
    "moderator:manage:announcements",
    {
      message: { type: "string", minLength: 1, maxLength: 16384 },
      color: { type: "string", enum: ["primary", "blue", "green", "orange", "purple"] },
    },
    { message: "", color: "primary" },
    "Post a highlighted announcement in your channel.",
  ],
  [
    "channel-info",
    "Change stream title / category",
    "channel:manage:broadcast",
    { title: { type: "string", maxLength: 140 }, gameId: { type: "string", maxLength: 30 } },
    { title: "", gameId: "" },
    "Set a title, a Twitch category ID, or both. Leave the other field empty to keep it.",
  ],
];
module.exports = ({
  getProvider,
  isActive = () => true,
  now = Date.now,
  getAutomations = () => null,
}) => {
  let adAfter = 0;
  const shoutouts = require("./shoutout-queue")({ getProvider, isActive, now });
  function catalog() {
    const provider = isActive() ? getProvider() : null,
      status = provider?.status();
    return [
      ...definitions.map(([kind, label, scope, properties, defaults, description]) => ({
        id: "twitch.action." + kind,
        label,
        group: kind === "recipe" ? "Saved values" : "Twitch",
        symbol: "\uD83D\uDCFA",
        description,
        requiresLive: ["commercial", "snooze-ad", "shoutout"].includes(kind),
        ...(kind === "shoutout" ? { queueSupported: true } : {}),
        available:
          !!status?.connected &&
          (!scope || status.scopes.includes(scope)) &&
          (kind !== "commercial" || now() >= adAfter),
        parameters: {
          type: "object",
          additionalProperties: false,
          properties,
          required:
            kind === "channel-info"
              ? []
              : kind === "shoutout"
                ? ["target"]
                : kind === "bot-shoutout"
                  ? ["target", "command"]
                  : Object.keys(properties),
        },
        defaults,
        ...(scope && !status?.scopes?.includes(scope)
          ? { state: { tone: "unavailable", text: "Enable Twitch permission for this action" } }
          : {}),
      })),
      ...(provider ? getAutomations()?.actions.catalog() || [] : []),
      ...require("./twitch-event-conditions").catalog(),
    ];
  }
  return {
    shoutouts,
    shutdown: () => shoutouts.clear(),
    catalog,
    handles: (id) => id.startsWith("twitch.action."),
    async execute(id, params, signal) {
      if (signal?.aborted)
        throw Object.assign(Error("control_deck_cancelled"), { code: "control_deck_cancelled" });
      if (getAutomations()?.actions.handles(id)) return getAutomations().actions.execute(id);
      if (!catalog().find((row) => row.id === id)?.available)
        return { ok: false, error: "twitch_action_unavailable" };
      if (
        ["twitch.action.chat", "twitch.action.announcement", "twitch.action.recipe"].includes(id) &&
        !params[Symbol.for("ravelink.template.resolved")] &&
        getAutomations()?.renderMessage
      ) {
        params = {
          ...params,
          message: await getAutomations().renderMessage(params.message, signal),
        };
      }
      if (id === "twitch.action.recipe") return { ok: true };
      if (id === "twitch.action.shoutout")
        return shoutouts.enqueue(
          params,
          params[Symbol.for("ravelink.shoutout.guard")] || (() => !signal?.aborted),
        );
      const kind = id.slice("twitch.action.".length),
        clean =
          kind === "channel-info"
            ? Object.fromEntries(Object.entries(params).filter(([, value]) => value !== ""))
            : params,
        result =
          kind === "bot-shoutout"
            ? !/^[a-z0-9_]{1,25}$/i.test(params.login || "") ||
              !["!so", "!shoutout"].includes(params.command)
              ? { ok: false, error: "twitch_shoutout_target_required" }
              : await getProvider().runAction({
                  kind: "chat",
                  params: { message: params.command + " " + params.login },
                })
            : await getProvider().runAction({ kind, params: clean });
      if (kind === "commercial" && result.ok) adAfter = now() + result.retryAfter * 1000;
      return result;
    },
  };
};
