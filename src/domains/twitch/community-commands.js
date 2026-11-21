/** Bounded bot commands and one five-minute presence sampler. No per-viewer timers. */
module.exports = ({ file, getProvider, manageCommand, now = Date.now }) => {
  const store = require("./community-store")(file),
    cooldowns = new Map(),
    seen = new Set(),
    cache = new Map();
  const tracking = require("./watchtime-policy")({ store, getProvider, now });
  let active = false,
    timer = null,
    busy = false,
    last = null,
    chain = Promise.resolve(),
    queued = 0,
    generation = 0;
  const duration = require("./watchtime-duration");
  async function tick() {
    if (!active || busy) return;
    busy = true;
    try {
      const provider = getProvider(),
        status = provider.status();
      if (!status.connected) {
        last = null;
        return;
      }
      tracking.maintenance();
      const live = await provider.dashboardStream();
      if (!live?.ok || !live.live) {
        last = null;
        return;
      }
      if (!status.scopes.includes("moderator:read:chatters")) {
        last = null;
        return;
      }
      const presence = await provider.listChatters();
      if (!presence?.ok) {
        last = null;
        return;
      }
      if (!active || getProvider().status().userId !== status.userId) {
        last = null;
        return;
      }
      const current = await tracking.sample(
        presence.users.map((row) => ({ ...row, login: row.login.toLowerCase() })),
        () => active && getProvider().status().userId === status.userId,
      );
      if (last?.owner === status.userId && now() - last.at <= 360000) {
        const elapsed = Math.min(5, Math.max(0, (now() - last.at) / 60000));
        for (const login of current)
          if (last.users.has(login)) store.credit(status.userId, login, elapsed);
        store.flush();
      }
      last = { owner: status.userId, at: now(), users: current };
    } catch {
      last = null;
    } finally {
      busy = false;
    }
  }
  async function category(query) {
    const key = query.toLowerCase(),
      cached = cache.get(key);
    if (cached && cached.until > now()) return cached.value;
    const result = await getProvider().searchCategories({ query });
    if (!result.ok) throw Error(result.error);
    const value = require("./category-match")(query, result.categories);
    cache.set(key, { until: now() + 600000, value });
    while (cache.size > 128) cache.delete(cache.keys().next().value);
    return value;
  }
  async function perform(command, args, event, owner, moderator, current) {
    if (command === "command") {
      if (!moderator) throw Error("Only moderators and the broadcaster can manage commands.");
      if (!current() || getProvider().status().userId !== owner)
        throw Error("Twitch account changed.");
      if (!manageCommand) throw Error("Command management is unavailable.");
      return manageCommand({
        text: event.message.text,
        broadcaster: event.chatter_user_id === owner,
      });
    }
    const provider = getProvider(),
      login = (args[0] || event.chatter_user_login || "").replace(/^@/, "").toLowerCase();
    if (["title", "category", "setgame"].includes(command)) {
      if (!moderator) throw Error("Only moderators and the broadcaster can change the stream.");
      const text = args.join(" ").trim();
      if (!text || text.length > 140)
        throw Error(
          command === "title"
            ? "Use !title followed by the new title (up to 140 characters)."
            : "Use !category followed by a category name.",
        );
      const match = command === "title" ? null : await category(text);
      if (match && !match.ok) throw Error(match.error);
      if (!current() || getProvider().status().userId !== owner)
        throw Error("Twitch account changed.");
      const result = await provider.runAction({
        kind: "channel-info",
        params: match ? { gameId: match.id } : { title: text },
      });
      if (!result.ok)
        throw Error(
          "Could not update the stream. Check Stream title & category access in Connection.",
        );
      return match ? "Category changed to " + match.name + "." : "Stream title updated.";
    }
    if (command === "followage") {
      if (!/^[a-z0-9_]{1,25}$/.test(login)) throw Error("Use !followage or !followage @name.");
      const result = await provider.followAge({ login });
      if (!result.ok) throw Error(result.error);
      return result.followedAt
        ? `${login} has followed for ${duration(Math.max(0, (now() - Date.parse(result.followedAt)) / 60000))}.`
        : `${login} is not currently following this channel.`;
    }
    if (command === "watchtime" || command === "points") {
      if (!(await tracking.eligible(login)))
        return `${login}: watchtime is tracked only for eligible followers in this channel.`;
      const row = store.peek(owner, login) || {
        minutes: 0,
        importedMinutes: 0,
        points: 0,
        importedPoints: 0,
      };
      return command === "watchtime"
        ? `${login}: ${duration(row.minutes + row.importedMinutes)} estimated watchtime.`
        : `${login}: ${row.points + row.importedPoints} loyalty points.`;
    }
    const operation =
      command === "deletequote" ? "delete" : args[0]?.toLowerCase() === "add" ? "add" : "read";
    if (operation !== "read" && !moderator)
      throw Error("Only moderators and the broadcaster can add or delete quotes.");
    return store.quote(
      owner,
      operation,
      (operation === "add" ? args.slice(1) : args).join(" "),
      event.chatter_user_login,
      now(),
    );
  }
  return {
    store,
    tracking: tracking.settings,
    observeChat: tracking.observeChat,
    observeEvent: tracking.observeEvent,
    events: () => ["channel.subscribe", "channel.subscription.message"],
    tick,
    chat(event) {
      tracking.observeChat(event);
      const [word, ...args] = String(event.message?.text || "")
          .trim()
          .split(/\s+/),
        command = word.toLowerCase().replace(/^!/, "");
      if (
        !word.startsWith("!") ||
        ![
          "title",
          "category",
          "setgame",
          "followage",
          "watchtime",
          "points",
          "quote",
          "deletequote",
          "command",
        ].includes(command)
      )
        return { handled: false };
      const owner = getProvider().status().userId;
      if (
        !owner ||
        event.broadcaster_user_id !== owner ||
        !event.chatter_user_id ||
        !event.message_id
      )
        return { handled: false };
      const id = owner + ":" + event.message_id,
        key = owner + ":" + event.chatter_user_id;
      if (seen.has(id) || queued >= 32 || (cooldowns.get(key) || 0) > now())
        return { handled: true, accepted: false };
      seen.add(id);
      while (seen.size > 2048) seen.delete(seen.values().next().value);
      cooldowns.set(key, now() + 5000);
      while (cooldowns.size > 2048) cooldowns.delete(cooldowns.keys().next().value);
      const moderator =
        event.chatter_user_id === owner || event.badges?.some((row) => row.set_id === "moderator");
      queued++;
      const epoch = generation;
      const task = async () => {
        try {
          if (epoch !== generation) return;
          let message;
          try {
            message = await perform(
              command,
              args,
              event,
              owner,
              moderator,
              () => epoch === generation,
            );
          } catch (error) {
            message = error.message;
          }
          if (epoch === generation && getProvider().status().userId === owner)
            await getProvider().sendChat({ message: String(message).slice(0, 500) });
        } finally {
          queued--;
        }
      };
      chain = chain.then(task).catch(() => {});
      return { handled: true, accepted: true };
    },
    idle: () => chain,
    setActive(value) {
      active = value;
      if (!value) generation++;
      if (active && !timer) {
        void tick();
        timer = setInterval(() => void tick(), 300000);
        timer.unref?.();
      }
      if (!active) {
        clearInterval(timer);
        timer = null;
        last = null;
      }
    },
    shutdown() {
      generation++;
      active = false;
      clearInterval(timer);
      last = null;
      try {
        store.flush();
      } catch {}
    },
  };
};
