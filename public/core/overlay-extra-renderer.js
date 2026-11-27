/** Additional widgets render the same public document/feed in the editor and OBS. */
/* global OverlayModel, OverlayGameRules, OverlayRecordFormat, boardImageTint */
(() => {
  const types = new Set([
    "prediction",
    "redemptions",
    "leaderboard",
    "player-card",
    "counter",
    "schedule",
    "chat-vote",
    "wheel",
    "bingo",
    "challenge-board",
    "tile-match",
    "soundboard",
  ]);
  const boardKeys = new WeakMap();
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svg = (tag, attrs, text) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  function goal(w, data) {
    const body = el("div");
    body.className = "goalWidget";
    const tracked = w.goalSource === "events" && data.goals?.[w.goalName];
    const record = tracked
      ? { value: tracked.current, target: tracked.target }
      : w.goalSource === "counter" && data.records?.[OverlayModel.recordKey(w)];
    if (["counter", "events"].includes(w.goalSource) && !record && !data.sample) return body;
    const currency = tracked?.currency || w.goalCurrency;
    const money = Boolean(currency);
    const formatter = money
      ? new Intl.NumberFormat(undefined, { style: "currency", currency })
      : new Intl.NumberFormat();
    const scale =
      money && w.goalSource === "counter"
        ? 10 ** formatter.resolvedOptions().maximumFractionDigits
        : 1;
    const target = record?.target > 0 ? record.target / scale : w.target;
    const current = Math.max(
      0,
      record
        ? record.value / scale
        : data.sample && ["counter", "events"].includes(w.goalSource)
          ? target * 0.35
          : w.current,
    );
    const amount = formatter.format(current) + "/" + formatter.format(target);
    const title = w.text || "Goal";
    if (w.goalFormat === "stacked") {
      const heading = el("div", title),
        value = el("div", amount);
      heading.className = "goalTitle";
      value.className = "goalAmount";
      body.append(heading, value);
    } else
      body.append(
        el(
          "span",
          w.goalFormat === "amount"
            ? amount
            : w.goalFormat === "title"
              ? title
              : title + ": " + amount,
        ),
      );
    if (w.goalBar) {
      const progress = el("progress");
      progress.max = target;
      progress.value = current;
      progress.setAttribute("aria-label", title);
      progress.style.height = w.goalBarHeight + "px";
      progress.style.accentColor = w.goalBarColor;
      progress.style.setProperty("--goal-accent", w.goalBarColor);
      body.append(progress);
    }
    const endsAt = tracked?.endsAt || w.endsAt;
    if (endsAt) body.append(el("small", nowLabel(endsAt, data.at || Date.now())));
    return body;
  }
  function nowLabel(endsAt, now) {
    const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
    if (!seconds) return "Goal ended";
    const days = Math.floor(seconds / 86400),
      hours = Math.floor(seconds / 3600) % 24;
    return (
      "Ends in " +
      (days ? days + "d " : "") +
      hours +
      "h " +
      (Math.floor(seconds / 60) % 60) +
      "m " +
      (seconds % 60) +
      "s"
    );
  }
  function music(w, data, now) {
    const body = el("div");
    body.className = "musicWidget";
    const track = data.music?.current;
    if (!track) return body;
    if (w.showArtwork) {
      const art = el(track.artwork ? "img" : "span", track.artwork ? undefined : "♪");
      art.className = "musicArtwork";
      if (track.artwork) {
        art.src = track.artwork;
        art.alt = "";
        art.referrerPolicy = "no-referrer";
      }
      body.append(art);
    }
    const words = el("div");
    words.className = "musicWords";
    const title = el("strong", track.title);
    title.className = "musicTitle";
    words.append(title);
    if (w.showArtist && track.artists?.length) words.append(el("small", track.artists.join(", ")));
    if (w.showRequester && track.requester)
      words.append(el("small", "Requested by " + track.requester));
    if (w.showProgress && track.durationMs > 0) {
      const position = Math.min(
        track.durationMs,
        Math.max(0, track.positionMs || 0) +
          (track.status === "playing" && track.observedAt
            ? Math.min(15000, Math.max(0, now - track.observedAt))
            : 0),
      );
      const bar = el("progress");
      bar.max = track.durationMs;
      bar.value = position;
      bar.className = "musicProgress";
      bar.setAttribute("aria-label", "Track progress");
      const duration = (ms) =>
        Math.floor(ms / 60000) + ":" + String(Math.floor(ms / 1000) % 60).padStart(2, "0");
      const time = el("small", duration(position) + " / " + duration(track.durationMs));
      time.className = "musicTime";
      words.append(bar, time);
    }
    body.append(words);
    return body;
  }
  const state = (w, data) =>
    data.game ||
    (data.sample && w.type !== "tile-match"
      ? {
          counts: w.items.map((_, i) => i * 3 + 2),
          open: true,
          endsAt: (data.sampleAt || Date.now()) + 60000,
          entries: w.items,
          marks:
            w.type === "challenge-board"
              ? [w.tiles[0]?.id, w.tiles[3]?.id].filter(Boolean)
              : [0, 3],
          winner: "",
          spunAt: 0,
          turns: 0,
        }
      : {});
  function item(body, title, detail) {
    const row = el("div"),
      words = el("span", title);
    words.className = "itemText";
    row.className = "overlayItem";
    row.append(words);
    if (detail !== undefined) row.append(el("small", detail));
    body.append(row);
    return row;
  }
  function wheel(body, w, s, now) {
    const entries = s.entries || w.items;
    if (!entries.length) {
      item(
        body,
        w.entrySource === "chat"
          ? s.collecting
            ? "Entries open: type " + w.joinCommand
            : "Open entries to let viewers join"
          : "No entries remaining",
        w.entrySource === "chat" ? "0 entries" : "Reset the wheel to restore the list.",
      );
      return;
    }
    const picture = svg("svg", {
      viewBox: "0 0 400 410",
      role: "img",
      "aria-label": "Wheel of names",
    });
    const disc = svg("g", { class: "wheelDisc" }),
      slice = 360 / entries.length;
    const point = (angle) => [
      200 + 188 * Math.cos((angle * Math.PI) / 180),
      200 + 188 * Math.sin((angle * Math.PI) / 180),
    ];
    entries.forEach((name, i) => {
      const a = i * slice - 90,
        b = (i + 1) * slice - 90,
        p = point(a),
        q = point(b);
      disc.append(
        svg(
          entries.length === 1 ? "circle" : "path",
          entries.length === 1
            ? { cx: 200, cy: 200, r: 188, fill: w.palette[0] }
            : {
                d: `M200 200 L${p[0]} ${p[1]} A188 188 0 ${slice > 180 ? 1 : 0} 1 ${q[0]} ${q[1]} Z`,
                fill: w.palette[i % w.palette.length],
                stroke: w.background,
                "stroke-width": 2,
              },
        ),
      );
      if (entries.length <= 40)
        disc.append(
          svg(
            "text",
            {
              x: 200,
              y: 200,
              transform: `rotate(${a + slice / 2} 200 200) translate(175 0)`,
              fill: w.color,
              "font-size": Math.min(18, Math.max(9, 200 / entries.length)),
              "text-anchor": "end",
              "dominant-baseline": "middle",
            },
            name.slice(0, 24),
          ),
        );
    });
    picture.append(disc, svg("path", { d: "M185 3 L215 3 L200 30 Z", fill: w.color }));
    body.append(picture);
    const spinning = s.spunAt && now < s.spunAt + s.spinSeconds * 1000;
    item(body, spinning ? "Spinning..." : s.winner ? "Selected: " + s.winner : "Ready to spin");
    if (entries.length > 40) body.append(el("small", entries.length + " entries"));
  }
  function render(w, data, now) {
    if (w.type === "goal") return goal(w, data);
    if (w.type === "now-playing") return music(w, data, now);
    if (!types.has(w.type)) return null;
    const body = el("div");
    body.className = "extraWidget extra-" + w.type;
    const s = state(w, data),
      r = data.records?.[OverlayModel.recordKey(w)];
    if (w.label) body.append(el("strong", w.label));
    if (w.type === "counter")
      item(body, r?.value ?? (data.sample ? 12 : "Waiting for saved counter"));
    if (w.type === "leaderboard") {
      const entries =
        r?.entries ||
        (data.sample
          ? [
              { player: "DemoViewer", value: 120 },
              { player: "AnotherViewer", value: 80 },
            ]
          : []);
      entries
        .slice(0, w.maxItems)
        .forEach((row, i) =>
          item(
            body,
            `${w.showRank ? i + 1 + ". " : ""}${row.player}`,
            w.statSource === "watchtime"
              ? OverlayRecordFormat.watchtime(row.value, w.watchtimeFormat)
              : new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(row.value) +
                  (w.statSource === "points" ? " points" : " " + w.statField),
          ),
        );
    }
    if (w.type === "player-card") {
      const row =
        r ||
        (data.sample
          ? {
              player: w.player || "DemoViewer",
              entries: w.items.map((field, i) => ({ field, value: (i + 1) * 10 })),
            }
          : null);
      if (row) {
        body.append(el("strong", row.player));
        row.entries.forEach((entry) => item(body, entry.field, entry.value));
      }
    }
    if (w.type === "redemptions") {
      const entries =
        data.redemptions?.entries ||
        (data.sample ? [{ name: "DemoViewer", reward: "Choose the next game", cost: 2500 }] : []);
      entries
        .slice(0, w.maxItems)
        .forEach((row) => item(body, row.name + " - " + row.reward, row.cost + " Channel Points"));
      if (!entries.length) item(body, "No pending redemptions");
    }
    if (w.type === "schedule") {
      const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      [...w.schedule]
        .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
        .forEach((row) => item(body, days[row.day] + " " + row.time, row.title));
      if (w.schedule.length) body.append(el("small", "Times in " + w.timezone));
    }
    if (w.type === "soundboard")
      (data.soundboard || (data.sample ? [{ name: "Dramatic entrance", playing: true }] : []))
        .filter((row) => row.playing || now - row.at < w.lingerSeconds * 1000)
        .slice(-w.maxItems)
        .forEach((row) => item(body, row.name, row.playing ? "Now playing" : "Last played"));
    if (w.type === "prediction") {
      const p =
        (data.prediction && data.prediction.at >= (data.twitch?.prediction?.at || 0)
          ? data.prediction
          : data.twitch?.prediction?.prediction) ||
        (data.sample
          ? {
              title: "Will we win?",
              status: "ACTIVE",
              outcomes: [
                { id: "a", title: "Yes", points: 800, users: 8 },
                { id: "b", title: "No", points: 200, users: 2 },
              ],
            }
          : null);
      if (p) {
        body.append(el("strong", p.title), el("small", p.status));
        const total = p.outcomes.reduce((n, o) => n + o.points, 0);
        p.outcomes.forEach((o) => {
          item(
            body,
            (o.id === p.winningId ? "Winner: " : "") + o.title,
            o.points + " points / " + o.users + " viewers",
          );
          const bar = el("progress");
          bar.max = total || 1;
          bar.value = o.points;
          body.append(bar);
        });
      }
    }
    if (w.type === "chat-vote") {
      body.append(
        el("strong", w.text || "Chat vote"),
        el(
          "small",
          s.open
            ? `Vote: ${w.votePrefix} 1-${w.items.length} | ${Math.max(0, Math.ceil((s.endsAt - now) / 1000))}s remaining`
            : "Voting closed",
        ),
      );
      const counts = s.counts || [],
        total = counts.reduce((a, b) => a + b, 0);
      w.items.slice(0, 10).forEach((name, i) => {
        item(body, `${i + 1}. ${name}`, String(counts[i] || 0) + " votes");
        const bar = el("progress");
        bar.max = total || 1;
        bar.value = counts[i] || 0;
        body.append(bar);
      });
    }
    if (w.type === "wheel") wheel(body, w, s, now);
    if (OverlayGameRules.boardTypes.includes(w.type)) renderBoard(body, w, s, now);
    return body;
  }
  function announcementActive(w, state, now) {
    return (
      w.bingoAnnouncement === "always" ||
      (w.bingoAnnouncement === "timed" && now < (state?.bingoAt || 0) + w.bingoSeconds * 1000)
    );
  }
  function boardUnchanged(node, w, data, now) {
    if (!OverlayGameRules.boardTypes.includes(w.type)) {
      boardKeys.delete(node);
      return false;
    }
    const game = state(w, data);
    const key = JSON.stringify([
      w,
      game.marks,
      game.tileConditions,
      announcementActive(w, game, now),
      w.type === "tile-match"
        ? [
            game.matchFaces || OverlayGameRules.matchFaces(game, now),
            game.matchUntil > now,
            game.turns,
          ]
        : undefined,
    ]);
    if (boardKeys.get(node) === key && node.firstElementChild.classList.contains("extra-" + w.type))
      return true;
    boardKeys.set(node, key);
    return false;
  }
  function renderBoard(body, w, s, now) {
    const board = OverlayGameRules.board(w, s, now),
      grid = el("div"),
      conditions = new Map(OverlayGameRules.conditions(w).map((style) => [style.id, style]));
    const alpha = (color, opacity) =>
      color +
      Math.round((opacity / 100) * 255)
        .toString(16)
        .padStart(2, "0");
    const image = (url, fit, className) => {
      const img = el("img");
      img.className = className;
      img.alt = "";
      img.src = url;
      img.style.objectFit = fit;
      return img;
    };
    grid.className = board.freeform ? "bingoGrid freeform" : "bingoGrid";
    for (const position of ["above", "below"])
      grid.classList.toggle(
        "labels-" + position,
        board.cells.some(
          (cell) =>
            cell.labelPosition === position &&
            !cell.covered &&
            OverlayGameRules.showLabel(cell, w.showCellLabels, board.operation === "flip"),
        ),
      );
    if (!board.freeform) {
      grid.style.gridTemplateColumns = `repeat(${board.columns},minmax(0,1fr))`;
      grid.style.gridTemplateRows = `repeat(${board.rows},minmax(0,1fr))`;
      grid.style.columnGap = Math.min(w.cellGap, w.width / board.columns / 4) + "px";
      const labelGap =
        (Number(grid.classList.contains("labels-above")) +
          Number(grid.classList.contains("labels-below"))) *
        w.fontSize *
        0.65;
      grid.style.rowGap = Math.min(Math.max(w.cellGap, labelGap), w.height / board.rows / 2) + "px";
    }
    for (const [name, value] of Object.entries({
      "--cell-fill": alpha(w.cellBackground, w.cellOpacity),
      "--cell-line": w.cellBorderColor,
      "--cell-border": w.cellBorder + "px",
      "--cell-radius": w.cellRadius + "px",
      "--cell-gap": w.cellGap + "px",
      "--tile-back": w.matchBackColor || "",
    }))
      grid.style.setProperty(name, value);
    if (w.boardImage) grid.append(image(w.boardImage, w.boardImageFit, "bingoImage"));
    for (const [index, item] of board.cells.entries()) {
      const cell = el("div");
      if (board.operation !== "flip") cell.dataset.boardTile = index + 1;
      cell.className =
        "bingoCell" + (item.marked ? " marked" : "") + (item.covered ? " covered" : "");
      const style = conditions.get(item.condition);
      cell.dataset.condition = item.condition;
      cell.dataset.labelPosition = item.covered ? "center" : item.labelPosition;
      cell.classList.toggle(
        "border-hidden",
        w.showCellBorders === false || item.borderHidden === true,
      );
      cell.classList.toggle(
        "completed-hidden",
        w.hideCompletedTiles && item.marked && (board.operation === "flip" || !item.free),
      );
      if (style && style.tintTarget !== "image" && ["color", "both"].includes(style.mode))
        cell.style.setProperty("--cell-mark", alpha(style.color, style.opacity));
      if (board.freeform)
        Object.assign(cell.style, {
          left: item.x + "%",
          top: item.y + "%",
          width: item.width + "%",
          height: item.height + "%",
          transform: `rotate(${item.rotation}deg)`,
        });
      if (item.image) {
        const photo = image(item.image, w.cellImageFit, "bingoImage");
        photo.style.filter = boardImageTint(style);
        cell.append(photo);
      }
      if (OverlayGameRules.showLabel(item, w.showCellLabels, board.operation === "flip")) {
        const label = el("span", item.covered ? w.matchBack : item.text);
        label.className = "bingoLabel";
        cell.append(label);
      }
      if (style?.symbol && ["symbol", "both"].includes(style.mode)) {
        const symbol = el("span", style.symbol);
        symbol.className = "bingoSymbol";
        symbol.style.color = style.symbolColor;
        symbol.setAttribute("aria-hidden", "true");
        cell.append(symbol);
      }
      grid.append(cell);
    }
    body.append(grid);
    if (board.operation === "flip") {
      if (w.matchProgress)
        body.append(
          el(
            "small",
            board.won
              ? "All pairs matched in " + board.attempts + " attempts"
              : board.matched + " / " + w.matchPairs.length + " pairs matched",
          ),
        );
      return;
    }
    if (!board.won || !w.bingoMessage || !announcementActive(w, s, now)) return;
    const banner = el("strong", w.bingoMessage);
    banner.className = "bingoAnnouncement";
    banner.style.color = w.bingoColor;
    banner.style.backgroundColor = alpha(w.bingoBackground, w.bingoBackgroundOpacity);
    banner.style.fontSize = w.bingoFontSize + "px";
    if (w.bingoPlacement === "overlay") grid.append(banner);
    else if (w.bingoPlacement === "top") body.insertBefore(banner, grid);
    else body.append(banner);
  }
  function motion(node, w, data, now) {
    if (w.type !== "wheel") return;
    const s = state(w, data),
      disc = node.querySelector(".wheelDisc");
    if (!disc || !s.spunAt) return;
    const angle = s.angle || 0,
      reduced = globalThis.OverlayMotion.reduced(node);
    const signature = s.spunAt + ":" + angle + ":" + reduced;
    if (disc.dataset.spin === signature) return;
    disc.dataset.spin = signature;
    for (const animation of disc.getAnimations()) animation.cancel();
    disc.style.transformOrigin = "200px 200px";
    disc.style.transform = `rotate(${angle}deg)`;
    const elapsed = Math.max(0, now - s.spunAt);
    if (elapsed < s.spinSeconds * 1000 && !reduced)
      disc.animate(
        [{ transform: `rotate(${s.startAngle || 0}deg)` }, { transform: `rotate(${angle}deg)` }],
        {
          duration: s.spinSeconds * 1000,
          delay: -elapsed,
          fill: "forwards",
          easing: "cubic-bezier(.14,.7,.1,1)",
        },
      );
  }
  globalThis.OverlayExtraRenderer = { render, motion, boardUnchanged };
})();
