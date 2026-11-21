/** One lazy Core timer. Missed intervals never produce a catch-up burst. */
const {
  EVENTS,
} = require("../../capabilities/feature-platform/providers/twitch-automation-events");
const { fromEvent } = require("./twitch-automation-context");
module.exports = ({
  rows,
  account,
  getProvider,
  launch,
  receipt,
  advanceCalendar = async () => {},
  now = Date.now,
}) => {
  let active = false,
    timer = null,
    ticking = false,
    live = null,
    owner = "",
    liveEpoch = 0,
    liveAfter = 0;
  const timers = new Map(),
    eventAfter = new Map(),
    chatSeen = new Map();
  function current() {
    try {
      return account();
    } catch {
      return "";
    }
  }
  function sync() {
    const eligible = active && rows().some((row) => row.enabled && row.trigger.type === "timer");
    if (eligible && !timer) {
      timer = setInterval(() => {
        void tick().catch(() => {});
      }, 1000);
      timer.unref?.();
    }
    if (!eligible && timer) {
      clearInterval(timer);
      timer = null;
    }
    for (const [id, state] of timers) {
      const row = rows().find((row) => row.id === id);
      if (!row || row.trigger.type !== "timer") timers.delete(id);
      else if (!row.enabled && state.last !== null) state.last = null;
    }
  }
  function state(row) {
    const signature = JSON.stringify({ ...row.trigger, nextAt: undefined });
    let value = timers.get(row.id);
    if (!value || value.signature !== signature) {
      value = {
        signature,
        remaining: row.trigger.calendarMonths
          ? Math.max(0, row.trigger.nextAt - now())
          : row.trigger.intervalMs,
        messages: 0,
        count: 0,
        last: null,
        phase: "paused",
      };
      timers.set(row.id, value);
    }
    return value;
  }
  async function tick() {
    if (!active || ticking) return;
    ticking = true;
    try {
      const nextOwner = current();
      if (owner !== nextOwner) {
        owner = nextOwner;
        live = null;
        liveAfter = 0;
        liveEpoch++;
        for (const item of timers.values()) item.last = null;
      }
      const selected = rows().filter(
        (row) => row.trigger.type === "timer" && row.accountId === owner,
      );
      if (!owner) {
        for (const item of timers.values()) item.last = null;
        return;
      }
      if (selected.some((row) => row.enabled && row.trigger.onlyLive) && now() >= liveAfter) {
        liveAfter = now() + 30000;
        const epoch = liveEpoch;
        const status = await getProvider().dashboardStream();
        if (epoch === liveEpoch) live = status?.ok ? status.live === true : null;
      }
      for (const row of selected) {
        if (!active || current() !== owner) return;
        if (!rows().includes(row)) continue;
        const item = state(row),
          trigger = row.trigger;
        if (!row.enabled) {
          item.last = null;
          item.phase = "paused";
          continue;
        }
        if (trigger.repeatLimit && item.count >= trigger.repeatLimit) {
          item.last = null;
          item.phase = "completed";
          continue;
        }
        if (trigger.onlyLive && live !== true) {
          item.last = null;
          item.phase = live === false ? "waiting_live" : "live_unknown";
          continue;
        }
        const elapsed = item.last === null ? 0 : Math.max(0, now() - item.last);
        item.last = now();
        item.remaining = trigger.calendarMonths
          ? Math.max(0, trigger.nextAt - now())
          : Math.max(0, item.remaining - elapsed);
        item.phase = "counting";
        if (item.remaining > 0) continue;
        if (item.messages < trigger.minMessages) {
          item.phase = "waiting_chat";
          continue;
        }
        const started = launch(row, null, fromEvent("timer"));
        if (started.accepted) {
          if (trigger.calendarMonths) {
            const nextAt = require("./calendar-schedule").future(
              trigger.nextAt,
              trigger.calendarMonths,
              now(),
              trigger.calendarDay,
            );
            await advanceCalendar(row, nextAt);
          }
          item.count++;
          item.messages = 0;
          item.remaining = trigger.calendarMonths
            ? Math.max(0, row.trigger.nextAt - now())
            : trigger.intervalMs;
          item.phase = "counting";
        } else item.phase = "waiting_runner";
      }
    } finally {
      ticking = false;
    }
  }
  function chat(event) {
    if (
      !active ||
      event?.broadcaster_user_id !== current() ||
      !event.message_id ||
      !event.chatter_user_id ||
      event.chatter_user_id === event.broadcaster_user_id
    )
      return;
    const id = String(event.message_id).slice(0, 160);
    if (chatSeen.has(id)) return;
    chatSeen.set(id, now());
    while (chatSeen.size > 2048) chatSeen.delete(chatSeen.keys().next().value);
    for (const row of rows().filter(
      (row) =>
        row.accountId === event.broadcaster_user_id && row.enabled && row.trigger.type === "timer",
    )) {
      if (row.trigger.onlyLive && live !== true) continue;
      const item = state(row);
      item.messages = Math.min(100000, item.messages + 1);
    }
    void tick().catch(() => {});
  }
  async function event(type, event, metadata) {
    if (!active || !EVENTS.some((row) => row[0] === type)) return;
    const id = current(),
      target = type === "channel.raid" ? event.to_broadcaster_user_id : event.broadcaster_user_id;
    if (!id || target !== id || !metadata?.message_id) return;
    if (!receipt(id, "event:" + metadata.message_id)) return;
    if (type === "stream.online" || type === "stream.offline") {
      liveEpoch++;
      live = type === "stream.online";
      liveAfter = now() + 30000;
    }
    for (const row of rows().filter(
      (row) =>
        row.accountId === id &&
        row.enabled &&
        row.trigger.type === "event" &&
        row.trigger.event === type,
    )) {
      if ((eventAfter.get(row.id) || 0) > now()) continue;
      if (launch(row, null, fromEvent(type, event)).accepted)
        eventAfter.set(row.id, now() + row.cooldownSeconds * 1000);
    }
    await tick();
  }
  return {
    sync,
    tick,
    chat,
    event,
    setActive(value) {
      if (active === (value === true)) {
        sync();
        return;
      }
      active = value === true;
      for (const state of timers.values()) state.last = null;
      sync();
    },
    reset(id) {
      timers.delete(id);
    },
    snapshot() {
      return rows()
        .filter((row) => row.trigger.type === "timer")
        .map((row) => ({ id: row.id, ...state(row), signature: undefined, last: undefined }));
    },
    close() {
      active = false;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
};
