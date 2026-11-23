/** Additional widgets render the same public document/feed in the editor and OBS. */
/* global OverlayModel, OverlayGameRules, OverlayRecordFormat */
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
    "soundboard",
  ]);
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
    (data.sample
      ? {
          counts: w.items.map((_, i) => i * 3 + 2),
          open: true,
          endsAt: Date.now() + 60000,
          entries: w.items,
          marks: [0, 3],
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
    if (w.type === "bingo") {
      const board = OverlayGameRules.bingoBoard(w, s.marks),
        grid = el("div");
      grid.className = "bingoGrid";
      grid.style.gridTemplateColumns = `repeat(${board.columns},minmax(0,1fr))`;
      grid.style.gridTemplateRows = `repeat(${board.rows},minmax(0,1fr))`;
      for (const item of board.cells) {
        const cell = el("div", item.text);
        cell.className = "bingoCell" + (item.marked ? " marked" : "");
        cell.style.setProperty("--cell-accent", w.palette[0]);
        grid.append(cell);
      }
      body.append(grid);
      if (board.won) body.append(el("strong", "BINGO!"));
    }
    return body;
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
  globalThis.OverlayExtraRenderer = { render, motion };
})();
