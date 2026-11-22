/** Short-lived, on-demand chat catalogs. Third-party requests carry only the channel ID. */
const providers = {
  sevenTv: {
    global: "https://7tv.io/v3/emote-sets/global",
    room: "https://7tv.io/v3/users/twitch/",
    field: "showSevenTvEmotes",
    read(body, room) {
      return (room ? body.emote_set?.emotes : body.emotes)?.map((entry) => {
        const id = entry.data?.id || entry.id;
        if (!/^[a-z0-9]{24,32}$/i.test(id || "")) return null;
        return [entry.name, `https://cdn.7tv.app/emote/${id}/2x.webp`];
      });
    },
  },
  betterTtv: {
    global: "https://api.betterttv.net/3/cached/emotes/global",
    room: "https://api.betterttv.net/3/cached/users/twitch/",
    field: "showBetterTtvEmotes",
    read(body, room) {
      const rows = room ? (body.channelEmotes || []).concat(body.sharedEmotes || []) : body;
      return rows.map((entry) =>
        /^[a-f0-9]{24}$/i.test(entry.id || "")
          ? [entry.code, `https://cdn.betterttv.net/emote/${entry.id}/2x`]
          : null,
      );
    },
  },
  frankerFaceZ: {
    global: "https://api.frankerfacez.com/v1/set/global",
    room: "https://api.frankerfacez.com/v1/room/id/",
    field: "showFrankerFaceZEmotes",
    read(body, room) {
      const sets = room ? [body.room?.set] : body.default_sets || [];
      return sets.flatMap((id) =>
        (body.sets?.[id]?.emoticons || []).map((entry) => {
          const url =
            entry.animated?.["2"] ||
            entry.animated?.["1"] ||
            entry.urls?.["2"] ||
            entry.urls?.["1"];
          const safe =
            typeof url === "string" &&
            /^(?:https:)?\/\/cdn\.frankerfacez\.com\/emote\/\d+\/(?:animated\/)?[a-z\d.]+$/i.test(
              url,
            );
          return safe ? [entry.name, url.startsWith("//") ? "https:" + url : url] : null;
        }),
      );
    },
  },
};

function catalog(entries) {
  const result = new Map();
  for (const entry of (entries || []).slice(0, 2500)) {
    if (entry && typeof entry[0] === "string" && /^\S{1,80}$/.test(entry[0])) result.set(...entry);
  }
  return result;
}

function candidates(code, catalogs) {
  const matches = [];
  for (const scope of ["room", "global"]) {
    for (const name of Object.keys(providers)) {
      const url = catalogs.get(name + ":" + scope)?.values?.get(code);
      if (url && !matches.some((match) => match.provider === name))
        matches.push({ provider: name, url });
    }
  }
  return matches;
}

module.exports = ({ now, fetch, changed }) => {
  const catalogs = new Map();
  let account = "";
  let decorated = new WeakMap();
  function update(key, load) {
    const current = catalogs.get(key);
    if (current?.pending || current?.until > now()) return;
    const entry = { values: current?.values, pending: true };
    catalogs.set(key, entry);
    void Promise.resolve()
      .then(load)
      .then(
        (values) => {
          if (catalogs.get(key) !== entry) return;
          Object.assign(entry, { values, pending: false, until: now() + 900000 });
          decorated = new WeakMap();
          changed();
        },
        () => {
          Object.assign(entry, { pending: false, until: now() + 60000 });
        },
      );
  }
  async function read(provider, url, room) {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: "error" });
    if (room && response.status === 404) return new Map();
    if (!response.ok) throw Error("Chat emote catalog unavailable");
    return catalog(provider.read(await response.json(), room));
  }
  return {
    reset(userId) {
      account = userId;
      catalogs.clear();
      decorated = new WeakMap();
    },
    refresh(status, widgets) {
      const chat = widgets.filter((widget) => widget.visible && widget.type === "chat");
      if (!status.connected || !status.scopes.includes("user:read:chat") || !chat.length) return;
      if (!/^\d{1,30}$/.test(account)) return;
      if (status.provider.overlayChatBadges && chat.some((widget) => widget.showChatBadges))
        update("badges", async () => {
          const result = await status.provider.overlayChatBadges();
          if (!result.ok) throw Error("Chat badge catalog unavailable");
          return new Map(result.badges.map((row) => [row.key, row]));
        });
      for (const [name, provider] of Object.entries(providers)) {
        if (!chat.some((widget) => widget[provider.field])) continue;
        update(name + ":global", () => read(provider, provider.global, false));
        const room = provider.room + account;
        update(name + ":room", () => read(provider, room, true));
      }
    },
    decorate(row) {
      if (decorated.has(row)) return decorated.get(row);
      const { badges, fragments, ...message } = row;
      delete message.userId;
      const badgeCatalog = catalogs.get("badges")?.values;
      const native =
        fragments?.map((part) => part.text).join("") === row.message
          ? fragments
          : [{ text: row.message }];
      const parts = native.flatMap((part) => {
        if (part.emote || !part.text) return [part];
        const tokens = part.text.match(/\s+|\S+/g) || [];
        const resolved = [];
        let plain = "";
        for (const token of tokens) {
          const emotes = /^\S{1,80}$/.test(token) ? candidates(token, catalogs) : [];
          if (emotes.length) {
            if (plain) resolved.push({ text: plain });
            plain = "";
            resolved.push({ text: token, emotes });
          } else plain += token;
        }
        if (plain) resolved.push({ text: plain });
        return resolved;
      });
      const result = {
        ...message,
        fragments: parts,
        badges: badgeCatalog ? badges.map((key) => badgeCatalog.get(key)).filter(Boolean) : [],
      };
      decorated.set(row, result);
      return result;
    },
  };
};
