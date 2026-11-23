/** Compact, editable controls for record, game and schedule widgets. */
/* global OverlayGameRules, OverlayRecordFormat */
globalThis.OverlayExtraControls = (a, { host, num, select, check, field }) => {
  const note = (text) => {
    const p = document.createElement("small");
    p.textContent = text;
    host.append(p);
  };
  function button(name, fn) {
    const b = document.createElement("button");
    b.textContent = name;
    b.type = "button";
    b.onclick = async () => {
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        a.notice(e.message);
      } finally {
        b.disabled = false;
      }
    };
    host.append(b);
    return b;
  }
  function entries(w, title, max) {
    const label = document.createElement("label"),
      input = document.createElement("input");
    input.id = "overlay-list-" + w.id;
    input.setAttribute("aria-label", title);
    label.textContent = title + " (Enter to add)";
    label.append(input);
    host.append(label);
    void import("/pill-input.js").then(({ createPillInput }) => {
      if (!host.contains(label)) return;
      let ready = false;
      const pills = createPillInput(input, {
        label: title,
        maxItems: max,
        maxLength: 200,
        onChange: (values) => {
          if (ready)
            a.change(() => {
              w.items = values;
            }, false);
        },
      });
      pills.set(w.items);
      ready = true;
    });
  }
  function schedule(w) {
    field("Schedule timezone (for example Europe/Lisbon)", "timezone");
    const table = document.createElement("div");
    table.className = "scheduleEntries";
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    w.schedule.forEach((row, index) => {
      const line = document.createElement("div"),
        day = document.createElement("select"),
        time = document.createElement("input"),
        title = document.createElement("input"),
        remove = document.createElement("button");
      days.forEach((name, i) => day.append(new Option(name, String(i))));
      day.value = String(row.day);
      day.setAttribute("aria-label", "Day " + (index + 1));
      time.type = "time";
      time.value = row.time;
      time.required = true;
      time.setAttribute("aria-label", "Time " + (index + 1));
      title.value = row.title;
      title.maxLength = 100;
      title.setAttribute("aria-label", "Stream title " + (index + 1));
      const update = () => {
        if (!time.reportValidity()) return;
        a.change(() => {
          w.schedule[index] = { day: Number(day.value), time: time.value, title: title.value };
        }, false);
      };
      day.onchange = time.onchange = title.onchange = update;
      remove.textContent = "Remove";
      remove.onclick = () => a.change(() => w.schedule.splice(index, 1));
      line.append(day, time, title, remove);
      table.append(line);
    });
    host.append(table);
    button("Add schedule entry", () =>
      a.change(() => {
        if (w.schedule.length >= 28) throw Error("Use up to 28 weekly entries.");
        w.schedule.push({ day: 0, time: "18:00", title: "Live stream" });
      }),
    );
    note(
      "An editable weekly schedule, independent of Twitch's schedule. Times use the timezone you choose.",
    );
  }
  function game(w) {
    const controls = document.createElement("div");
    controls.className = "gameControls";
    const run = async (operation, input) => a.gameControl(w, operation, input);
    const b = (name, operation, input) => {
      const node = button(name, () => run(operation, input));
      controls.append(node);
    };
    if (w.type === "wheel") {
      const source = select("Wheel entries from", "entrySource", [
        ["manual", "My editable list"],
        ["chat", "Viewers joining through chat"],
      ]);
      const sourceChange = source.onchange;
      source.onchange = () => {
        sourceChange();
        a.draw();
      };
      if (w.entrySource === "manual") entries(w, "Wheel entries", 100);
      else {
        field("Join command", "joinCommand");
        b("Open entries", "collect");
        b("Close entries", "close-entries");
        note(
          "One entry per Twitch user, up to 100. Viewers type " +
            w.joinCommand +
            " while entries are open. Spinning closes entries.",
        );
      }
      num("Spin duration (seconds)", "spinSeconds", 1, 20);
      check("Remove the selected entry before the next spin", "removeWinner");
      b("Spin wheel", "spin");
      const palette = document.createElement("details"),
        summary = document.createElement("summary");
      summary.textContent = "Wheel colors";
      palette.append(summary);
      w.palette.forEach((value, index) => {
        const input = document.createElement("input");
        input.type = "color";
        input.value = value;
        input.setAttribute("aria-label", "Wheel color " + (index + 1));
        input.onchange = () =>
          a.change(() => {
            w.palette[index] = input.value;
          }, false);
        palette.append(input);
      });
      host.append(palette);
    }
    if (w.type === "chat-vote") {
      field("Vote title", "text");
      entries(w, "Voting choices", 10);
      field("Chat vote command", "votePrefix");
      num("Voting duration (seconds)", "duration", 1, 86400);
      b("Start vote", "start");
      b("Close vote", "close");
      note(
        "Viewers type the command and a choice number, for example !vote 2. One vote per Twitch user, up to 20,000 voters. App-sent replies never vote.",
      );
    }
    if (w.type === "bingo") {
      const dimensions = [
        select(
          "Board size",
          "gridSize",
          Array.from({ length: 10 }, (_, i) => [i + 1, i + 1 + " columns"]),
        ),
        select("Rows", "gridRows", [
          [0, "Same as columns"],
          ...Array.from({ length: 10 }, (_, i) => [i + 1, String(i + 1)]),
        ]),
      ];
      for (const input of dimensions) {
        const change = input.onchange;
        input.onchange = () => {
          change();
          a.draw();
        };
      }
      const { count } = OverlayGameRules.bingoLayout(w);
      const free = check("Free center square (odd-sized boards)", "freeCenter");
      const grid = document.createElement("div");
      grid.className = "bingoEditor";
      grid.style.gridTemplateColumns = `repeat(${Math.min(w.gridSize, 3)},minmax(0,1fr))`;
      for (let i = 0; i < count; i++) {
        const cell = document.createElement("input");
        const isFree = () => i === OverlayGameRules.bingoLayout(w).center;
        cell.value = isFree() ? "FREE" : w.items[i] || "";
        cell.disabled = !!isFree();
        cell.placeholder = "Square " + (i + 1);
        cell.maxLength = 200;
        cell.setAttribute("aria-label", "Bingo text " + (i + 1));
        cell.onchange = () =>
          a.change(() => {
            while (w.items.length <= i) w.items.push("");
            w.items[i] = cell.value;
          }, false);
        grid.append(cell);
      }
      const freeChange = free.onchange;
      free.onchange = () => {
        freeChange();
        const i = Math.floor(count / 2),
          input = grid.children[i];
        input.disabled = OverlayGameRules.bingoLayout(w).center >= 0;
        input.value = input.disabled ? "FREE" : w.items[i] || "";
      };
      host.append(grid);
      const input = document.createElement("input");
      input.type = "number";
      input.min = 1;
      input.max = count;
      input.value = 1;
      input.setAttribute("aria-label", "Bingo square to mark");
      host.append(input);
      const toggle = button("Toggle square", () => run("mark", { cell: Number(input.value) }));
      controls.append(toggle);
      note(
        "Save the board to use it in the Button deck’s Bingo tab. You can also mark squares from the action builder. Changing the dimensions clears the current marks.",
      );
    }
    b("Reset game", "reset");
    host.append(controls);
    note(
      "Data: Sample tests locally. Data: Live controls the saved overlay. Save edited choices before running a live game. The same controls are available under Overlay games in the action builder.",
    );
  }
  return {
    content(w) {
      if (w.type === "schedule") schedule(w);
      if (["wheel", "chat-vote", "bingo"].includes(w.type)) game(w);
      if (w.type === "counter") {
        field("Saved counter name", "counterName");
        note("Reads the same named counter as your commands; displaying it does not increment it.");
      }
      if (w.type === "leaderboard") {
        select("Leaderboard source", "statSource", [
          ["stats", "Saved player stat"],
          ["watchtime", "Watchtime"],
          ["points", "Loyalty points"],
        ]);
        if (w.statSource === "stats")
          field("Saved stat name (for example xp or wins)", "statField");
        if (w.statSource === "watchtime")
          select("Watchtime display format", "watchtimeFormat", OverlayRecordFormat.formats);
        num("Maximum visible players", "maxItems", 1, 20);
        check("Show rank numbers", "showRank");
        note(
          w.statSource === "stats"
            ? "Shows existing player records. Use the same stat name as your command recipes."
            : w.statSource === "watchtime"
              ? "Shows recorded watchtime. Formatting only changes the display; months use 30 days and years use 365 days."
              : "Shows existing loyalty point balances in this channel.",
        );
      }
      if (w.type === "player-card") {
        field("Player Twitch username", "player");
        entries(w, "Saved stat names", 12);
        note(
          "Choose any saved numeric player fields. Viewing a new name does not create or change their record.",
        );
      }
      if (w.type === "redemptions") {
        num("Maximum visible redemptions", "maxItems", 1, 20);
        note(
          "Backfills pending rewards created through this app and receives new redemptions live. Twitch restricts reading older redemptions to rewards owned by this app. Viewer input is kept private.",
        );
      }
      if (w.type === "prediction")
        note(
          "Reads the current or latest Twitch prediction and its result. Enable Prediction widgets & events in Twitch Connection. This widget never opens or resolves a prediction.",
        );
      if (w.type === "soundboard") {
        num("Keep last played label (seconds, 0 = only while playing)", "lingerSeconds", 0, 60);
        note(
          "Shows native soundboard names. Last played stays for 3 seconds by default so short sounds remain visible. No extra audio player or output is started by the overlay.",
        );
      }
    },
  };
};
