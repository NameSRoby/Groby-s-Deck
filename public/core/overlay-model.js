/** Shared document validation for the designer, storage and OBS renderer. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OverlayModel = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  const presets = [
    ["1080p", 1920, 1080],
    ["720p", 1280, 720],
    ["1440p", 2560, 1440],
    ["4K", 3840, 2160],
    ["Portrait", 1080, 1920],
    ["Square", 1080, 1080],
  ];
  const definitions = [
    ["text", "Text", "Static", 480, 90],
    ["shape", "Shape / panel", "Static", 480, 270],
    ["image", "Image / GIF", "Static", 320, 180],
    ["video", "Video", "Static", 480, 270],
    ["custom", "Custom HTML / CSS / JS", "Custom", 480, 270],
    ["slideshow", "Media slideshow", "Static", 480, 270],
    ["rotating-text", "Rotating text", "Static", 480, 100],
    ["clock", "Clock", "Tools", 320, 90],
    ["countdown", "Countdown", "Tools", 320, 90],
    ["goal", "Goal", "Tools", 480, 120],
    ["now-playing", "Now playing", "Music", 520, 120],
    ["queue", "Song request queue", "Music", 480, 260],
    ["title", "Stream title", "Labels", 640, 90],
    ["category", "Stream category", "Labels", 480, 90],
    ["viewers", "Viewer count", "Labels", 320, 90],
    ["uptime", "Stream uptime", "Labels", 320, 90],
    ["followers", "Follower count", "Labels", 320, 90],
    ["latest-follower", "Latest follower", "Labels", 400, 90],
    ["subscribers", "Subscriber count", "Labels", 320, 90],
    ["sub-points", "Subscription points", "Labels", 320, 90],
    ["alerts", "Twitch alerts", "Alerts", 640, 180],
    ["activity", "Event history", "Alerts", 480, 300],
    ["chat", "Twitch chat", "Twitch", 480, 600],
    ["credits", "Supporter credits", "Tools", 480, 600],
    ["poll", "Twitch poll", "Twitch", 560, 300],
    ["prediction", "Twitch Predictions", "Twitch", 560, 300],
    ["redemptions", "Redemption queue", "Twitch", 480, 360],
    ["leaderboard", "Leaderboard", "Records", 480, 420],
    ["player-card", "Player card", "Records", 480, 360],
    ["counter", "Custom counter", "Records", 320, 100],
    ["schedule", "Stream schedule", "Tools", 640, 360],
    ["chat-vote", "Chat voting", "Games", 560, 320],
    ["wheel", "Wheel of names", "Games", 500, 560],
    ["bingo", "Bingo board", "Games", 600, 600],
    ["soundboard", "Soundboard indicator", "Tools", 480, 100],
    ["hype-train", "Hype Train", "Twitch", 480, 140],
  ].map(([type, name, group, width, height]) => ({ type, name, group, width, height }));
  const text = (v, n = 200) =>
    typeof v === "string" ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").slice(0, n) : "";
  const number = (v, min, max, fallback) =>
    Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : fallback;
  const color = (v, fallback) => (/^#[\da-f]{6}$/i.test(v || "") ? v.toLowerCase() : fallback);
  function mediaUrl(v) {
    const url = text(v, 2048);
    if (/^\/api\/stream-overlays\/media\/[a-f0-9-]{36}\.(png|jpg|webp|gif|mp4|webm)$/.test(url))
      return url;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password
        ? parsed.href
        : "";
    } catch {
      return "";
    }
  }
  function widget(raw = {}) {
    const definition = definitions.find((row) => row.type === raw.type);
    if (!definition) throw Error("Unsupported widget type.");
    return {
      id: text(raw.id, 80),
      type: definition.type,
      name: text(raw.name, 80) || definition.name,
      x: number(raw.x, 0, 8192, 80),
      y: number(raw.y, 0, 8192, 80),
      width: number(raw.width, 20, 8192, definition.width),
      height: number(raw.height, 20, 8192, definition.height),
      rotation: number(raw.rotation, -360, 360, 0),
      opacity: number(raw.opacity, 0, 100, 100),
      visible: raw.visible !== false,
      locked: raw.locked === true,
      group: text(raw.group, 80),
      lockRatio: raw.lockRatio === true,
      text:
        text(raw.text, 2000) ||
        (raw.type === "text" ? "Your text" : raw.type === "alerts" ? "${name} ${message}" : ""),
      color: color(raw.color, "#ffffff"),
      background: color(raw.background, "#17233b"),
      backgroundOpacity: number(raw.backgroundOpacity, 0, 100, raw.type === "shape" ? 100 : 0),
      radius: number(raw.radius, 0, 500, 12),
      fontSize: number(raw.fontSize, 8, 240, 32),
      font: ["system", "serif", "mono", "installed", "uploaded"].includes(raw.font)
        ? raw.font
        : "system",
      fontFamily: text(raw.fontFamily, 120)
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim(),
      fontAsset: /^\/api\/stream-overlays\/media\/[a-f0-9-]{36}\.(woff2?|otf|ttf)$/.test(
        raw.fontAsset || "",
      )
        ? raw.fontAsset
        : "",
      align: ["left", "center", "right"].includes(raw.align) ? raw.align : "left",
      bold: raw.bold === true,
      chatMode: raw.chatMode === "scroll" ? "scroll" : "expire",
      showChatColors: raw.showChatColors !== false,
      showChatBadges: raw.showChatBadges !== false,
      showTwitchEmotes: raw.showTwitchEmotes !== false,
      showSevenTvEmotes: raw.showSevenTvEmotes === true,
      showBetterTtvEmotes: raw.showBetterTtvEmotes === true,
      showFrankerFaceZEmotes: raw.showFrankerFaceZEmotes === true,
      hideBotMessages: raw.hideBotMessages === true,
      hiddenAccounts: [
        ...new Set(
          (Array.isArray(raw.hiddenAccounts) ? raw.hiddenAccounts : [])
            .map((name) => text(name, 26).trim().replace(/^@/, "").toLowerCase())
            .filter((name) => /^[a-z0-9_]{1,25}$/.test(name)),
        ),
      ].slice(0, 32),
      motionTarget: raw.motionTarget === "text" ? "text" : "box",
      exitAnimation: raw.exitAnimation === true,
      creditsSource: ["followers", "subscribers", "manual"].includes(raw.creditsSource)
        ? raw.creditsSource
        : "manual",
      creditsPeriod: ["day", "week", "month", "year", "all"].includes(raw.creditsPeriod)
        ? raw.creditsPeriod
        : "all",
      scrollDirection: raw.scrollDirection === "horizontal" ? "horizontal" : "vertical",
      scrollSeconds: number(raw.scrollSeconds, 5, 600, 30),
      entrance: ["none", "fade", "slide", "pop", "wipe"].includes(raw.entrance)
        ? raw.entrance
        : "none",
      ambient: ["none", "float", "breathe"].includes(raw.ambient) ? raw.ambient : "none",
      animationMs: number(raw.animationMs, 100, 2000, 350),
      ambientSeconds: number(raw.ambientSeconds, 2, 60, 6),
      itemBackground: color(raw.itemBackground, "#17233b"),
      itemOpacity: number(raw.itemOpacity, 0, 100, 0),
      itemRadius: number(raw.itemRadius, 0, 100, 0),
      itemPadding: number(raw.itemPadding, 0, 60, 0),
      itemGap: number(raw.itemGap, 0, 60, 0),
      rotateEvery: number(raw.rotateEvery, 2, 3600, 10),
      items: (Array.isArray(raw.items)
        ? raw.items
        : {
            wheel: ["Adventure", "Music", "Challenge"],
            "chat-vote": ["Adventure", "Music"],
            "player-card": ["xp", "wins", "losses", "rating"],
            bingo: Array.from({ length: 25 }, (_, i) => "Square " + (i + 1)),
          }[raw.type] || []
      )
        .slice(
          0,
          raw.type === "credits"
            ? 1000
            : raw.type === "wheel"
              ? 100
              : raw.type === "bingo"
                ? 100
                : 20,
        )
        .map((value) => (raw.type === "slideshow" ? mediaUrl(value) : text(value, 500)))
        .filter((value) => raw.type === "bingo" || Boolean(value)),
      palette: (Array.isArray(raw.palette) && raw.palette.length
        ? raw.palette
        : ["#8b5cf6", "#0891b2", "#d97706", "#be185d"]
      )
        .slice(0, 12)
        .map((v) => color(v, "#8b5cf6")),
      statSource: ["stats", "watchtime", "points"].includes(raw.statSource)
        ? raw.statSource
        : "stats",
      statField: /^[a-z][a-z0-9_]{0,23}$/i.test(raw.statField || "") ? raw.statField : "xp",
      player: text(raw.player, 26)
        .trim()
        .replace(/^@/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 25),
      counterName: text(raw.counterName, 80).trim() || "deaths",
      votePrefix: /^![a-z0-9_]{1,23}$/i.test(raw.votePrefix || "")
        ? raw.votePrefix.toLowerCase()
        : "!vote",
      entrySource: raw.entrySource === "chat" ? "chat" : "manual",
      joinCommand: /^![a-z0-9_]{1,23}$/i.test(raw.joinCommand || "")
        ? raw.joinCommand.toLowerCase()
        : "!join",
      spinSeconds: number(raw.spinSeconds, 1, 20, 5),
      removeWinner: raw.removeWinner === true,
      freeCenter: raw.freeCenter !== false,
      gridSize: Math.round(number(raw.gridSize, 1, 10, 5)),
      gridRows: Math.round(number(raw.gridRows, 0, 10, 0)),
      timezone: (() => {
        try {
          const zone = text(raw.timezone, 80) || "UTC";
          new Intl.DateTimeFormat("en", { timeZone: zone });
          return zone;
        } catch {
          return "UTC";
        }
      })(),
      schedule: (Array.isArray(raw.schedule)
        ? raw.schedule
        : raw.type === "schedule"
          ? [{ day: 0, time: "18:00", title: "Live stream" }]
          : []
      )
        .slice(0, 28)
        .map((row) => ({
          day: Math.round(number(row?.day, 0, 6, 0)),
          time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row?.time || "") ? row.time : "18:00",
          title: text(row?.title, 100).trim(),
        }))
        .filter((row) => row.title)
        .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)),
      url: mediaUrl(raw.url),
      fit: raw.fit === "cover" ? "cover" : "contain",
      loop: raw.loop !== false,
      duration: number(raw.duration, 1, 86400, 300),
      endsAt: number(raw.endsAt, 0, 9999999999999, 0),
      current: number(raw.current, 0, 1000000000, 0),
      target: number(raw.target, 0.01, 1000000000, 100),
      goalSource: raw.goalSource === "counter" ? "counter" : "manual",
      goalCounter: text(raw.goalCounter, 64).trim().toLowerCase(),
      goalTargetCounter: text(raw.goalTargetCounter, 64).trim().toLowerCase(),
      goalFormat: ["inline", "stacked", "amount", "title"].includes(raw.goalFormat)
        ? raw.goalFormat
        : "inline",
      goalCurrency: /^[A-Z]{3}$/.test(raw.goalCurrency || "") ? raw.goalCurrency : "",
      goalBar: raw.goalBar !== false,
      goalBarColor: color(raw.goalBarColor, "#c55ff4"),
      goalBarHeight: number(raw.goalBarHeight, 2, 80, 18),
      label: text(raw.label, 100),
      events: (Array.isArray(raw.events)
        ? raw.events
        : ["channel.follow", "channel.subscribe", "channel.raid", "channel.cheer"]
      ).filter((value) =>
        [
          "channel.follow",
          "channel.subscribe",
          "channel.subscription.message",
          "channel.subscription.gift",
          "channel.raid",
          "channel.cheer",
        ].includes(value),
      ),
      lingerSeconds: number(raw.lingerSeconds, 0, 60, 3),
      lifetime: number(raw.lifetime, 1, 300, 10),
      maxItems: Math.round(number(raw.maxItems, 1, 20, 6)),
      html: text(raw.html, 16000),
      css: text(raw.css, 16000),
      js: text(raw.js, 16000),
      fields: text(raw.fields, 16000) || "{}",
    };
  }
  function document(raw = {}) {
    if (raw.widgets && (!Array.isArray(raw.widgets) || raw.widgets.length > 64))
      throw Error("An overlay can contain up to 64 widgets.");
    const widgets = (raw.widgets || []).map(widget),
      ids = new Set();
    for (const row of widgets) {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(row.id) || ids.has(row.id))
        throw Error("Each layer needs a unique ID.");
      ids.add(row.id);
    }
    const width = Math.round(number(raw.width, 64, 8192, 1920)),
      height = Math.round(number(raw.height, 64, 8192, 1080));
    for (const row of widgets) {
      row.width = Math.min(row.width, width);
      row.height = Math.min(row.height, height);
      row.x = Math.min(row.x, width - row.width);
      row.y = Math.min(row.y, height - row.height);
    }
    return {
      id: text(raw.id, 80),
      name: text(raw.name, 80) || "Untitled overlay",
      width,
      height,
      widgets,
    };
  }
  const recordKey = (w) =>
    w.type === "goal"
      ? JSON.stringify(["goal", w.goalCounter, w.goalTargetCounter])
      : JSON.stringify([
          w.type,
          w.statSource,
          w.statField,
          w.player,
          w.counterName,
          w.maxItems,
          w.items,
        ]);
  const interest = (w) => ({
    id: w.id,
    type: w.type,
    visible: w.visible,
    events: w.events,
    creditsSource: w.creditsSource,
    creditsPeriod: w.creditsPeriod,
    maxItems: w.maxItems,
    statSource: w.statSource,
    statField: w.statField,
    player: w.player,
    counterName: w.counterName,
    ...(w.type === "goal"
      ? {
          goalSource: w.goalSource,
          goalCounter: w.goalCounter,
          goalTargetCounter: w.goalTargetCounter,
        }
      : {}),
    items: w.type === "player-card" ? w.items : undefined,
    entrySource: w.entrySource,
    ...(w.type === "chat"
      ? {
          showChatBadges: w.showChatBadges,
          showSevenTvEmotes: w.showSevenTvEmotes,
          showBetterTtvEmotes: w.showBetterTtvEmotes,
          showFrankerFaceZEmotes: w.showFrankerFaceZEmotes,
        }
      : {}),
  });
  return { presets, definitions, widget, document, mediaUrl, recordKey, interest };
});
