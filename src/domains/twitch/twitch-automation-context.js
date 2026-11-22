/** Only allowlisted values can enter Twitch text fields, never desktop/OBS parameters. */
const login = (value) =>
  typeof value === "string" && /^[a-z0-9_]{1,25}$/i.test(value) ? value : "";
const number = (value) => (Number.isSafeInteger(value) && value >= 0 ? String(value) : "0");
function fromEvent(type, event = {}) {
  event ||= {};
  const user = login(event.user_login || event.chatter_user_login),
    raider = login(event.from_broadcaster_user_login);
  return {
    user,
    raider,
    raiderId: /^\d{1,80}$/.test(event.from_broadcaster_user_id || "")
      ? event.from_broadcaster_user_id
      : "",
    viewers: number(event.viewers),
    bits: number(event.bits),
    months: number(event.cumulative_months),
    gifts: number(event.total),
    event: type,
    sender: user,
    channel: login(event.broadcaster_user_login),
    command: String(event.message?.text || "")
      .slice(0, 500)
      .trim()
      .split(/\s+/)[0],
    argv: String(event.message?.text || "")
      .slice(0, 500)
      .trim()
      .split(/\s+/)
      .slice(1),
  };
}
function text(template, context) {
  return template.replace(/\{(user|raider|viewers|bits|months|gifts|event)\}/g, (_, key) => {
    const value = context?.[key];
    if (value === undefined || value === "")
      throw Object.assign(Error("twitch_event_value_missing"), {
        code: "twitch_event_value_missing",
      });
    return value;
  });
}
function parameters(id, params, context, signal) {
  if (!id.startsWith("twitch.action.")) return params;
  let value = { ...params };
  if (
    ["twitch.action.chat", "twitch.action.announcement", "twitch.action.recipe"].includes(id) &&
    typeof value.message === "string"
  ) {
    if (context?.render)
      return context.render(value.message, signal).then((message) => ({
        ...value,
        message,
        [Symbol.for("groby.template.resolved")]: true,
      }));
    value.message = text(value.message, context);
  }
  if (id === "twitch.action.shoutout" && value.target === "raider") {
    if (!context?.raiderId)
      throw Object.assign(Error("twitch_event_value_missing"), {
        code: "twitch_event_value_missing",
      });
    value = { ...value, target: "user-id", userId: context.raiderId };
  }
  if (id === "twitch.action.bot-shoutout" && value.target === "raider") {
    if (!context?.raider)
      throw Object.assign(Error("twitch_event_value_missing"), {
        code: "twitch_event_value_missing",
      });
    value = { ...value, target: "login", login: context.raider };
  }
  if (id === "twitch.action.shoutout")
    Object.defineProperty(value, Symbol.for("groby.shoutout.guard"), {
      value: () => !signal?.aborted && (!context?.isCurrent || context.isCurrent()),
      enumerable: false,
    });
  return value;
}
module.exports = { fromEvent, text, parameters };
