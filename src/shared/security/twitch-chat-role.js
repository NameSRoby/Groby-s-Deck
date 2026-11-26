/** Roles are derived from the authorized Twitch event, never from message text. */
function boundedText(value, maximum) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function roleFromEvent(event = {}) {
  const badges = Array.isArray(event.badges) ? event.badges : [];
  const badgeIds = new Set(
    badges.map((row) => boundedText(row?.set_id || row?.id, 40).toLowerCase()),
  );
  if (
    (event.chatter_user_id && event.chatter_user_id === event.broadcaster_user_id) ||
    badgeIds.has("broadcaster") ||
    badgeIds.has("moderator")
  )
    return "moderator";
  return badgeIds.has("vip") ? "vip" : "viewer";
}

module.exports = { boundedText, roleFromEvent };
