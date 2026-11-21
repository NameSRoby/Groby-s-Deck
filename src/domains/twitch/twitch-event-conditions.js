/** Numeric event fields are condition sources, never standalone output actions. */
const labels = {
  viewers: "Raid viewer count",
  bits: "Cheer Bits",
  months: "Cumulative subscription months",
  gifts: "Gift subscription count",
};
module.exports = {
  catalog: () =>
    Object.entries(labels).map(([field, label]) => ({
      id: "twitch.event." + field,
      label,
      description: "Read this trigger’s " + label.toLowerCase() + " in an If block.",
      group: "Twitch event values",
      kind: "condition",
      available: true,
      state: { value: 0, tone: "ready" },
      parameters: { type: "object", additionalProperties: false, properties: {} },
      defaults: {},
    })),
  read(rule, context) {
    const field = rule.actionId.slice("twitch.event.".length);
    return Object.hasOwn(labels, field) && context
      ? { available: true, state: { value: Number(context[field]), tone: "ready" } }
      : { available: false };
  },
};
