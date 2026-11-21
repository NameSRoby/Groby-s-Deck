/** Saved automations are ordinary deck/flow action choices. */
module.exports = ({ getRows, account, control }) => ({
  handles: (id) => id.startsWith("twitch.automation."),
  catalog() {
    let owner;
    try {
      owner = account();
    } catch {
      return [];
    }
    return getRows(owner).flatMap((row) =>
      ["start", "pause", "toggle", ...(row.trigger.type === "timer" ? ["restart"] : [])].map(
        (operation) => ({
          id: `twitch.automation.${operation}:${row.id}`,
          label:
            (operation === "start"
              ? "Start / resume"
              : operation === "pause"
                ? "Pause"
                : operation === "toggle"
                  ? "Start / pause"
                  : "Restart timer") +
            " · " +
            row.name,
          group: "Twitch automations",
          symbol: "⏱",
          available: operation !== "restart" || row.trigger.type === "timer",
          parameters: { type: "object", additionalProperties: false, properties: {} },
          defaults: {},
          state: {
            active: row.enabled,
            tone: row.enabled ? "ready" : "paused",
            text: row.enabled ? "Enabled" : "Paused",
          },
          description:
            operation === "pause"
              ? "Pause future triggers. A running flow finishes its current work; Stop & restore cancels it."
              : "Control this saved automation from a deck button or another flow.",
        }),
      ),
    );
  },
  execute(id) {
    const match = /^twitch\.automation\.(start|pause|toggle|restart):([a-f0-9]{24})$/.exec(id);
    if (!match) return { ok: false, error: "twitch_automation_action_invalid" };
    return control({ operation: match[1], id: match[2] });
  },
});

/** Validate a saved control and rearm calendar timers from the operator's current time. */
module.exports.prepare = (row, operation, closed, timestamp) => {
  const { fault } = require("../control-deck/control-deck-config");
  if (closed || !row || !["start", "pause", "toggle", "restart"].includes(operation))
    throw fault("twitch_automation_missing");
  if (operation === "restart" && row.trigger.type !== "timer")
    throw fault("twitch_automation_trigger_invalid");
  if (operation !== "restart" || !row.trigger.calendarMonths) return row.trigger;
  const nextAt = require("./calendar-schedule").advance(timestamp, row.trigger.calendarMonths);
  return { ...row.trigger, nextAt, calendarDay: new Date(nextAt).getUTCDate() };
};
