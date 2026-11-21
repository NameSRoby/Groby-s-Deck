const { closed, fault } = require("../control-deck/control-deck-config");
module.exports = (trigger, handler) => {
  const invalid = () => {
    throw fault("twitch_automation_trigger_invalid");
  };
  if (
    !closed(trigger, [
      "type",
      "intervalMs",
      "repeatLimit",
      "onlyLive",
      "minMessages",
      "calendarMonths",
      "nextAt",
      "calendarDay",
    ]) ||
    handler !== "flow" ||
    !Number.isInteger(trigger.repeatLimit) ||
    trigger.repeatLimit < 0 ||
    trigger.repeatLimit > 100000 ||
    typeof trigger.onlyLive !== "boolean" ||
    !Number.isInteger(trigger.minMessages) ||
    trigger.minMessages < 0 ||
    trigger.minMessages > 100000
  )
    invalid();
  const base = {
    type: "timer",
    repeatLimit: trigger.repeatLimit,
    onlyLive: trigger.onlyLive,
    minMessages: trigger.minMessages,
  };
  if (trigger.calendarMonths === undefined) {
    if (
      !Number.isInteger(trigger.intervalMs) ||
      trigger.intervalMs < 1000 ||
      trigger.intervalMs > 86400000 ||
      trigger.nextAt !== undefined ||
      trigger.calendarDay !== undefined
    )
      invalid();
    return {
      type: "timer",
      intervalMs: trigger.intervalMs,
      repeatLimit: trigger.repeatLimit,
      onlyLive: trigger.onlyLive,
      minMessages: trigger.minMessages,
    };
  }
  if (
    trigger.intervalMs !== undefined ||
    !Number.isInteger(trigger.calendarMonths) ||
    trigger.calendarMonths < 1 ||
    trigger.calendarMonths > 120 ||
    !Number.isSafeInteger(trigger.nextAt) ||
    trigger.nextAt < 0 ||
    !Number.isFinite(new Date(trigger.nextAt).getTime())
  )
    invalid();
  const nextAt =
    trigger.nextAt ||
    Math.ceil(require("./calendar-schedule").advance(Date.now(), trigger.calendarMonths) / 60000) *
      60000;
  const calendarDay = trigger.calendarDay ?? new Date(nextAt).getUTCDate();
  if (!Number.isInteger(calendarDay) || calendarDay < 1 || calendarDay > 31) invalid();
  return { ...base, calendarMonths: trigger.calendarMonths, nextAt, calendarDay };
};
