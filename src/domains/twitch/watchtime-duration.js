/** Elapsed watchtime has no calendar start: use 365-day years and 30-day months. */
module.exports = (minutes) => {
  let remaining = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  const parts = [];
  for (const [size, name] of [
    [525600, "year"],
    [43200, "month"],
    [1440, "day"],
    [60, "hour"],
    [1, "minute"],
  ]) {
    const amount = Math.floor(remaining / size);
    remaining %= size;
    if (amount) parts.push(`${amount} ${name}${amount === 1 ? "" : "s"}`);
  }
  return parts.join(", ") || "0 minutes";
};
