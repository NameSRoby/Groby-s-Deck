/** UTC calendar arithmetic keeps the original day across short months and leap years. */
function advance(timestamp, months, anchorDay = new Date(timestamp).getUTCDate()) {
  const result = new Date(timestamp);
  if (
    !Number.isFinite(result.getTime()) ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > 120000 ||
    !Number.isInteger(anchorDay) ||
    anchorDay < 1 ||
    anchorDay > 31
  )
    throw Error("Invalid calendar schedule.");
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(anchorDay, last));
  if (!Number.isFinite(result.getTime())) throw Error("Invalid calendar schedule.");
  return result.getTime();
}
function future(timestamp, months, now, anchorDay) {
  // Skip missed dates in one jump, then correct a boundary; never replay missed periods.
  const date = new Date(timestamp),
    current = new Date(now);
  const difference =
    (current.getUTCFullYear() - date.getUTCFullYear()) * 12 +
    current.getUTCMonth() -
    date.getUTCMonth();
  let next = timestamp;
  const jumps = Math.max(0, Math.floor(difference / months));
  if (jumps) next = advance(timestamp, jumps * months, anchorDay);
  if (next <= now) next = advance(next, months, anchorDay);
  return next;
}
module.exports = { advance, future };
