/** Announce actual selected-player track changes independently of request intake. */
const crypto = require("node:crypto");

module.exports = function createNowPlayingChat({
  context,
  queue,
  preferences,
  send,
  now = Date.now,
}) {
  const key = "now-playing-chat-v1";
  let last = "",
    ready = false,
    pending = Promise.resolve();
  const clean = (value) =>
    String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
  async function load() {
    try {
      const saved = await context.callCapability(
        "ravelink.storage.v1",
        "get",
        { key },
        { timeoutMs: 1000 },
      );
      if (!saved?.ok) return;
      if (/^[a-f0-9]{64}$/.test(saved.value?.signature)) last = saved.value.signature;
      ready = true;
    } catch {}
  }
  function announce(candidate, requesterLabel = "") {
    const operation = pending.then(async () => {
      if (!ready || queue.status().responses?.now_playing !== true) return;
      const selected = await preferences("status", null);
      if (!selected?.ok || selected.player !== candidate?.provider || !clean(candidate.title))
        return;
      const signature = crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            candidate.provider,
            clean(candidate.title).toLowerCase(),
            (candidate.artists || []).map((artist) => clean(artist).toLowerCase()),
          ]),
        )
        .digest("hex");
      if (signature === last) return;
      // Claim before sending: a restart or an ambiguous send must not repeat chat.
      const stored = await context.callCapability(
        "ravelink.storage.v1",
        "set",
        { key, value: { signature } },
        { timeoutMs: 1000 },
      );
      if (!stored?.ok) return;
      last = signature;
      // Chat delivery is tracked by the feature lifecycle, independently of the
      // playback observer's shorter IPC deadline.
      send(
        { method: "acknowledge", payload: {} },
        {
          ok: true,
          code: "started",
          notifyChat: true,
          entry: { candidate, requesterLabel },
        },
      );
    });
    pending = operation.catch(() => {});
    return pending;
  }
  function observe(observation, entry) {
    const age = Number(now()) - Number(observation?.observedAt ?? now());
    if (
      observation?.available === false ||
      observation?.status !== "playing" ||
      !Number.isFinite(age) ||
      age < -5000 ||
      age >= 15000
    )
      return;
    return announce(
      entry?.candidate || {
        provider: observation.provider,
        title: observation.title,
        artists: Array.isArray(observation.artists) ? observation.artists : [],
      },
      entry?.requesterLabel,
    );
  }
  function managed() {
    const current = queue.playbackStatus().managed;
    if (current?.status !== "playing") return;
    return announce(current.candidate, current.origin === "queue" ? current.requesterLabel : "");
  }
  return { load, observe, managed };
};
