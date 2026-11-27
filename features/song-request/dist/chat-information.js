/** Read-only chat information. Native handoffs precede locally waiting requests;
 * queueOrder comes from the observed desktop queue, not receipt insertion order.
 * Unknown/pending deliveries cannot establish a reliable position. Never retry a
 * write or advance playback while answering these commands. Public replies include
 * only song metadata and request positions, never IDs, hashes or account details.
 */
const crypto = require("node:crypto");
const { songLabel } = require("./chat-public-song");
const { queueView, currentReceipt, managedCurrent, nativeReady } = require("./chat-queue-view");
const describe = (row, length = 180) => songLabel(row, length) || "Untitled song";
module.exports = async function chatInformation(
  { queue, preferences, tidal, spotify, youtubeBrowser },
  payload,
) {
  const reply = (message) => ({ ok: true, message });
  const selection = await preferences("status", null);
  if (!selection.ok) return { ok: false, message: "Song information is temporarily unavailable." };
  const provider = selection.player,
    native =
      ["tidal", "spotify"].includes(provider) ||
      (provider === "youtube" && selection.youtubePlayback === "browser");
  const playback = queue.playbackStatus();
  const state = native
    ? await (provider === "tidal" ? tidal : provider === "youtube" ? youtubeBrowser : spotify)(
        "status",
        null,
      )
    : null;
  const receipt = currentReceipt(state);
  const current = native
    ? state?.connected && state.current && { ...receipt, ...state.current }
    : managedCurrent(playback, provider);
  const observation =
    (playback.primary?.candidate?.provider || playback.primary?.provider) === provider
      ? playback.primary
      : null;
  if (payload.command === "song") {
    const candidate =
      (!native || state?.connected) && (current?.candidate?.title || current?.title)
        ? current
        : observation;
    if (native && !candidate && (!state?.connected || state?.current?.uid))
      return { ok: false, message: "Now-playing information is temporarily unavailable." };
    if (!candidate || (!native && !["playing", "paused"].includes(candidate.status)))
      return reply("No song is currently playing.");
    const paused =
      (native ? observation?.status : candidate.status) === "paused" ||
      current?.paused === true ||
      current?.status === "paused" ||
      (!native && playback.control?.paused);
    return reply(`${paused ? "Paused" : "Now playing"}: ${describe(candidate)}.`);
  }
  if (native && !nativeReady(state))
    return {
      ok: false,
      message: "The player queue is unavailable right now; request positions cannot be confirmed.",
    };
  const { rows, pending } = queueView(queue, provider, current?.entryId, state);
  const timing = require("./chat-queue-timing")({
    rows,
    current,
    observation,
    playback,
    state,
    native,
  });
  if (payload.command === "songqueue") {
    if (pending.length)
      return reply(
        (rows.length
          ? `Known requests: ${rows
              .slice(0, 5)
              .map((row) => describe(row, 48))
              .join(" | ")}. `
          : "") +
          `${pending.length} request${pending.length === 1 ? " is" : "s are"} awaiting player confirmation. Positions and ETAs are unavailable.`,
      );
    if (!rows.length) return reply("There are no pending song requests.");
    return reply(
      "Next requests: " +
        rows
          .slice(0, 5)
          .map((row, i) => `${i + 1}. ${describe(row, 48)} (${timing[i]})`)
          .join(" | "),
    );
  }
  const key = "req_" + crypto.createHash("sha256").update(payload.requesterId).digest("hex");
  const playing = current?.requesterKey === key;
  const currentNotice =
    observation?.status === "paused" ||
    current?.paused ||
    current?.status === "paused" ||
    (!native && playback.control?.paused)
      ? `Your requested song "${describe(current, 90)}" is paused.`
      : `Your requested song "${describe(current, 90)}" is playing now.`;
  const owned = rows
    .map((row, i) => ({ row, position: i + 1 }))
    .filter((x) => x.row.requesterKey === key);
  const next = owned[0]?.row || pending.find((row) => row.requesterKey === key);
  if (pending.length && next)
    return reply(
      `${playing ? currentNotice + " " : ""}Your request "${describe(next, 90)}" is ${owned.length ? "in the request queue" : "awaiting player confirmation"}. Its position is not confirmed yet.`,
    );
  if (playing && !owned.length) return reply(currentNotice);
  if (!owned.length) return reply("You have no pending song requests.");
  return reply(
    `${playing ? currentNotice + " " : ""}Your next request "${describe(owned[0].row, 90)}" is #${owned[0].position} in the request queue (${owned[0].position - 1} ahead; ${timing[owned[0].position - 1]})${owned.length > 1 ? `; ${owned.length - 1} more queued` : ""}.`,
  );
};
