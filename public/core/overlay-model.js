/** Shared document validation for the designer, storage and OBS renderer. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./overlay-alert-rules"));
  else root.OverlayModel = factory(root.OverlayAlertRules);
})(typeof globalThis === "object" ? globalThis : this, function (alerts) {
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
    ["challenge-board", "Challenge board", "Games", 720, 480],
    ["tile-match", "Tile Match", "Games", 600, 500],
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
  const boardLimit = 10000;
  const imageUrl = (value) =>
    typeof value === "string" && !/\.(mp4|webm)(?:[?#]|$)/i.test(value) ? mediaUrl(value) : "";
  function fillChallengeGrid(w, makeId) {
    const count = w.gridSize * w.gridRows;
    if (w.tiles.length >= count) return;
    const ids = new Set(w.tiles.map((tile) => tile.id));
    let nextId = w.tiles.length + 1;
    while (w.tiles.length < count) {
      let id;
      do id = makeId ? makeId() : "grid-tile-" + nextId++;
      while (ids.has(id));
      ids.add(id);
      const index = w.tiles.length;
      w.tiles.push({
        id,
        text: "",
        image: "",
        x: ((index % w.gridSize) * 100) / w.gridSize,
        y: (Math.floor(index / w.gridSize) * 100) / w.gridRows,
        width: Math.max(0.1, 90 / w.gridSize),
        height: Math.max(0.1, 90 / w.gridRows),
        rotation: 0,
      });
    }
  }
  const matchPairLimit = 24;
  const boardLabelPositions = ["center", "top", "bottom", "above", "below"];
  const boardConditionLimit = 8;
  function boardCondition(raw = {}) {
    return {
      mode: ["none", "color", "symbol", "both"].includes(raw.mode) ? raw.mode : "both",
      color: color(raw.color, "#b91c1c"),
      opacity: number(raw.opacity, 0, 100, 65),
      tintTarget: raw.tintTarget === "image" ? "image" : "tile",
      symbol: typeof raw.symbol === "string" ? text(raw.symbol, 16) : "\u2715",
      symbolColor: color(raw.symbolColor, "#ffffff"),
    };
  }
  function matchOptions(raw) {
    const initial = ["Moon", "Star", "Cloud", "Lightning", "Sun", "Comet"].map((text, index) => ({
      id: "pair-" + index,
      text,
    }));
    const pairs = (
      Array.isArray(raw.matchPairs) && raw.matchPairs.length >= 2 ? raw.matchPairs : initial
    )
      .slice(0, matchPairLimit)
      .map((pair, index) => ({
        id: /^[a-zA-Z0-9-]{1,80}$/.test(pair?.id || "") ? pair.id : "pair-" + index,
        text: text(pair?.text, 80),
        image: imageUrl(pair?.image),
        ...(pair?.labelHidden === true ? { labelHidden: true } : {}),
        ...(boardLabelPositions.includes(pair?.labelPosition)
          ? { labelPosition: pair.labelPosition }
          : {}),
      }));
    if (new Set(pairs.map((pair) => pair.id)).size !== pairs.length)
      throw Error("Each matching pair needs a unique ID.");
    return {
      matchPairs: pairs,
      matchColumns: Math.round(number(raw.matchColumns, 2, 12, 4)),
      matchRevealSeconds: number(raw.matchRevealSeconds, 0.5, 10, 2),
      matchBack: typeof raw.matchBack === "string" ? text(raw.matchBack, 16) : "◇",
      matchBackColor: color(raw.matchBackColor, "#203354"),
      matchProgress: raw.matchProgress !== false,
    };
  }
  function boardOptions(raw) {
    const challenge = raw.type === "challenge-board";
    const columns = Math.round(number(raw.gridSize, 1, boardLimit, challenge ? 4 : 5));
    const rows = Math.round(number(raw.gridRows, 0, Math.floor(boardLimit / columns), 0));
    const images = {};
    const hiddenLabels = {};
    const labelPositions = {};
    for (const [index, value] of Object.entries(raw.boardImages || {})) {
      if (!/^(0|[1-9]\d*)$/.test(index) || Number(index) >= boardLimit) continue;
      const url = imageUrl(value);
      if (url) images[index] = url;
    }
    for (const [index, value] of Object.entries(raw.boardHiddenLabels || {})) {
      if (/^(0|[1-9]\d*)$/.test(index) && Number(index) < boardLimit && value === true)
        hiddenLabels[index] = true;
    }
    for (const [index, value] of Object.entries(raw.boardLabelPositions || {})) {
      if (
        /^(0|[1-9]\d*)$/.test(index) &&
        Number(index) < boardLimit &&
        boardLabelPositions.includes(value)
      )
        labelPositions[index] = value;
    }
    const conditionIds = new Set(["pending", "completed", "failed"]);
    const customConditions = [];
    if (raw.type !== "tile-match" && Array.isArray(raw.customConditions))
      for (const entry of raw.customConditions.slice(0, boardConditionLimit)) {
        if (
          typeof entry?.id !== "string" ||
          !/^[a-z0-9-]{1,80}$/i.test(entry.id) ||
          conditionIds.has(entry.id)
        )
          continue;
        conditionIds.add(entry.id);
        customConditions.push({
          id: entry.id,
          name: text(entry.name, 40).trim() || "Condition " + (customConditions.length + 1),
          ...boardCondition(entry),
        });
      }
    const tiles = [];
    const seen = new Set();
    for (const [index, tile] of (Array.isArray(raw.tiles) ? raw.tiles : [])
      .slice(0, boardLimit)
      .entries()) {
      const id = /^[a-zA-Z0-9-]{1,80}$/.test(tile?.id || "") ? tile.id : "tile-" + (index + 1);
      if (seen.has(id)) throw Error("Each challenge tile needs a unique ID.");
      seen.add(id);
      tiles.push({
        id,
        text: text(tile?.text, 200),
        image: imageUrl(tile?.image),
        ...(tile?.labelHidden === true ? { labelHidden: true } : {}),
        ...(tile?.borderHidden === true ? { borderHidden: true } : {}),
        ...(boardLabelPositions.includes(tile?.labelPosition)
          ? { labelPosition: tile.labelPosition }
          : {}),
        x: number(tile?.x, 0, 100, 0),
        y: number(tile?.y, 0, 100, 0),
        width: number(tile?.width, 0.1, 100, 25),
        height: number(tile?.height, 0.1, 100, 25),
        rotation: number(tile?.rotation, -360, 360, 0),
        ...(tile?.gridWidth != null ? { gridWidth: number(tile.gridWidth, 1, 100, 90) } : {}),
        ...(tile?.gridHeight != null ? { gridHeight: number(tile.gridHeight, 1, 100, 90) } : {}),
      });
    }
    const challengeLayout = raw.challengeLayout === "grid" ? "grid" : "freeform";
    const gridRows = challenge
      ? rows ||
        Math.max(1, Math.min(Math.floor(boardLimit / columns), Math.ceil(tiles.length / columns)))
      : rows || (columns * columns > boardLimit ? Math.floor(boardLimit / columns) : 0);
    if (challenge && challengeLayout === "grid")
      fillChallengeGrid({ tiles, gridSize: columns, gridRows });
    return {
      gridSize: columns,
      gridRows,
      ...(challenge
        ? {
            challengeLayout,
            challengeTileWidth: number(raw.challengeTileWidth, 1, 100, 90),
            challengeTileHeight: number(raw.challengeTileHeight, 1, 100, 90),
          }
        : {}),
      freeCenter: raw.freeCenter !== false,
      boardImage: imageUrl(raw.boardImage),
      boardImageFit: raw.boardImageFit === "contain" ? "contain" : "cover",
      boardImages: images,
      ...(raw.type === "bingo"
        ? { boardHiddenLabels: hiddenLabels, boardLabelPositions: labelPositions }
        : {}),
      tiles,
      cellImageFit: raw.cellImageFit === "contain" ? "contain" : "cover",
      showCellLabels: raw.showCellLabels !== false,
      showCellBorders: raw.showCellBorders !== false,
      hideCompletedTiles: raw.hideCompletedTiles === true,
      labelPosition: boardLabelPositions.includes(raw.labelPosition) ? raw.labelPosition : "center",
      cellBackground: color(raw.cellBackground, "#111827"),
      cellOpacity: number(raw.cellOpacity, 0, 100, 0),
      cellBorderColor: color(raw.cellBorderColor, "#ffffff"),
      cellBorder: number(raw.cellBorder, 0, 12, 1),
      cellRadius: number(raw.cellRadius, 0, 120, 0),
      cellGap: number(raw.cellGap, 0, 60, 4),
      markMode: ["color", "symbol", "both"].includes(raw.markMode)
        ? raw.markMode
        : raw.type === "challenge-board"
          ? "symbol"
          : "color",
      markColor: color(raw.markColor, color(raw.palette?.[0], "#8b5cf6")),
      markOpacity: number(raw.markOpacity, 0, 100, 100),
      markTintTarget: raw.markTintTarget === "image" ? "image" : "tile",
      markSymbol: typeof raw.markSymbol === "string" ? text(raw.markSymbol, 16) : "✓",
      markSymbolColor: color(raw.markSymbolColor, "#ffffff"),
      failureCondition: boardCondition(
        raw.failureCondition && typeof raw.failureCondition === "object"
          ? raw.failureCondition
          : raw.type === "tile-match"
            ? { mode: "none" }
            : {},
      ),
      customConditions,
      bingoPatterns: Array.isArray(raw.bingoPatterns)
        ? [
            ...new Set(
              raw.bingoPatterns.filter((v) => ["rows", "columns", "diagonals", "all"].includes(v)),
            ),
          ]
        : ["rows", "columns", "diagonals"],
      bingoAnnouncement: ["off", "timed", "always"].includes(raw.bingoAnnouncement)
        ? raw.bingoAnnouncement
        : "always",
      bingoMessage: typeof raw.bingoMessage === "string" ? text(raw.bingoMessage, 200) : "BINGO!",
      bingoPlacement: ["top", "overlay"].includes(raw.bingoPlacement)
        ? raw.bingoPlacement
        : "bottom",
      bingoSeconds: number(raw.bingoSeconds, 1, 120, 5),
      bingoColor: color(raw.bingoColor, color(raw.color, "#ffffff")),
      bingoBackground: color(raw.bingoBackground, "#111827"),
      bingoBackgroundOpacity: number(raw.bingoBackgroundOpacity, 0, 100, 0),
      bingoFontSize: number(raw.bingoFontSize, 8, 240, number(raw.fontSize, 8, 240, 32)),
    };
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
      frameWidth: number(raw.frameWidth, 0, 32, 0),
      frameColor: color(raw.frameColor, "#ffffff"),
      frameOpacity: number(raw.frameOpacity, 0, 100, 100),
      frameStyle: ["dashed", "dotted"].includes(raw.frameStyle) ? raw.frameStyle : "solid",
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
      lineHeight: number(raw.lineHeight, 1, 2.5, 1.35),
      letterSpacing: number(raw.letterSpacing, -2, 20, 0),
      paddingX: number(raw.paddingX, 0, 120, 8),
      paddingY: number(raw.paddingY, 0, 120, 8),
      verticalAlign: ["top", "middle", "bottom"].includes(raw.verticalAlign)
        ? raw.verticalAlign
        : "top",
      textCase: ["none", "uppercase", "lowercase", "capitalize"].includes(raw.textCase)
        ? raw.textCase
        : "none",
      textFit: ["wrap", "shrink", "ellipsis"].includes(raw.textFit) ? raw.textFit : "wrap",
      shadowColor: color(raw.shadowColor, "#000000"),
      shadowOpacity: number(raw.shadowOpacity, 0, 100, 75),
      shadowBlur: number(raw.shadowBlur, 0, 40, 6),
      shadowX: number(raw.shadowX, -20, 20, 0),
      shadowY: number(raw.shadowY, -20, 20, 2),
      outlineColor: color(raw.outlineColor, "#000000"),
      outlineWidth: number(raw.outlineWidth, 0.5, 6, 1),
      accentStyle: ["none", "left", "bottom"].includes(raw.accentStyle) ? raw.accentStyle : "none",
      accentColor: color(raw.accentColor, "#38bdf8"),
      accentWidth: number(raw.accentWidth, 1, 16, 4),
      rowGap: number(raw.rowGap, 0, 80, 8),
      valueSize: number(raw.valueSize, 40, 100, 65),
      listLayout: raw.listLayout === "inline" ? "inline" : "stacked",
      showRank: raw.showRank !== false,
      textEffect: ["none", "shadow", "outline", "glow"].includes(raw.textEffect)
        ? raw.textEffect
        : "none",
      chatLayout: raw.chatLayout === "stacked" ? "stacked" : "inline",
      hideCommands: raw.hideCommands === true,
      showTimestamps: raw.showTimestamps === true,
      showArtwork: raw.showArtwork !== false,
      showArtist: raw.showArtist !== false,
      showRequester: raw.showRequester !== false,
      showProgress: raw.showProgress !== false,
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
      creditGap: number(raw.creditGap, 0, 240, 16),
      creditSeparator: text(raw.creditSeparator, 8),
      scrollReverse: raw.scrollReverse === true,
      scrollPaused: raw.scrollPaused === true,
      entrance: [
        "none",
        "fade",
        "slide",
        "slide-left",
        "slide-right",
        "pop",
        "wipe",
        "blur",
      ].includes(raw.entrance)
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
                ? boardLimit
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
      watchtimeFormat: [
        "compact",
        "seconds",
        "minutes",
        "hours",
        "days",
        "months",
        "years",
      ].includes(raw.watchtimeFormat)
        ? raw.watchtimeFormat
        : "compact",
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
      ...(["bingo", "challenge-board", "tile-match"].includes(raw.type) ? boardOptions(raw) : {}),
      ...(raw.type === "tile-match" ? matchOptions(raw) : {}),
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
      ...(["image", "video", "slideshow"].includes(raw.type)
        ? {
            mediaFocusX: number(raw.mediaFocusX, 0, 100, 50),
            mediaFocusY: number(raw.mediaFocusY, 0, 100, 50),
          }
        : {}),
      loop: raw.loop !== false,
      duration: number(raw.duration, 1, 86400, 300),
      endsAt: number(raw.endsAt, 0, 9999999999999, 0),
      countdownPaused: raw.countdownPaused === true,
      ...(raw.type === "countdown"
        ? {
            countdownFinish: ["message", "hide"].includes(raw.countdownFinish)
              ? raw.countdownFinish
              : "zero",
            countdownMessage:
              typeof raw.countdownMessage === "string"
                ? text(raw.countdownMessage, 200)
                : "Time’s up!",
          }
        : {}),
      pausedSeconds: number(raw.pausedSeconds, 0, 86400, 0),
      current: number(raw.current, 0, 1000000000, 0),
      target: number(raw.target, 0.01, 1000000000, 100),
      goalSource: ["counter", "events"].includes(raw.goalSource) ? raw.goalSource : "manual",
      goalName: text(raw.goalName, 64).trim().toLowerCase() || "community",
      goalTracking: text(raw.goalTracking, 40) || "followers",
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
          "channel.charity_campaign.donate",
        ].includes(value),
      ),
      lingerSeconds: number(raw.lingerSeconds, 0, 60, 3),
      lifetime: number(raw.lifetime, 1, 300, 10),
      alert: alerts.settings(raw.alert),
      alertVariants: alerts.variants(raw.alertVariants),
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
      motion: ["full", "system", "reduced"].includes(raw.motion) ? raw.motion : "full",
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
  const localTypes = new Set([
    "text",
    "shape",
    "image",
    "video",
    "slideshow",
    "rotating-text",
    "clock",
    "countdown",
    "schedule",
  ]);
  const usesLiveData = (w) => w.visible && !localTypes.has(w.type);
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
          goalName: w.goalName,
          goalTracking: w.goalTracking,
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
  return {
    presets,
    definitions,
    widget,
    document,
    mediaUrl,
    imageUrl,
    boardLimit,
    boardConditionLimit,
    boardLabelPositions,
    fillChallengeGrid,
    matchPairLimit,
    recordKey,
    usesLiveData,
    interest,
  };
});
