/** Watchtime values are stored in minutes; presentation never changes or rounds saved data. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OverlayRecordFormat = factory();
})(globalThis, function () {
  const formats = [
    ["compact", "Readable duration (days, hours, minutes)"],
    ["seconds", "Seconds"],
    ["minutes", "Minutes"],
    ["hours", "Hours"],
    ["days", "Days"],
    ["months", "Months (30 days)"],
    ["years", "Years (365 days)"],
  ];
  const numbers = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
  function watchtime(value, format = "compact") {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes < 0) return "Watchtime unavailable";
    if (format === "compact") {
      let seconds = Math.floor(minutes * 60);
      const parts = [];
      for (const [unit, size] of [
        ["d", 86400],
        ["h", 3600],
        ["m", 60],
        ["s", 1],
      ]) {
        const amount = Math.floor(seconds / size);
        seconds %= size;
        if (amount) parts.push(numbers.format(amount) + unit);
      }
      return (parts.slice(0, 2).join(" ") || "0m") + " watched";
    }
    const scale = {
      seconds: 1 / 60,
      minutes: 1,
      hours: 60,
      days: 1440,
      months: 43200,
      years: 525600,
    };
    const unit = Object.hasOwn(scale, format) ? format : "minutes";
    const amount = Math.round((minutes / scale[unit]) * 100) / 100;
    return numbers.format(amount) + " " + (amount === 1 ? unit.slice(0, -1) : unit) + " watched";
  }
  return { formats, watchtime };
});
