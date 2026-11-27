/** Contextual controls: content, appearance and placement are separate views. */
/* exported setupOverlayInspector */
/* global OverlayWidgetControls, OverlayFonts, OverlayGoalSources, OverlayTextStyle, OverlayGameRules, setupOverlayAlertControls */
globalThis.setupOverlayInspector = function (a) {
  const $ = a.$,
    host = $("widgetFields");
  const sections = new Map();
  for (const [key, name] of [
    ["content", "Content"],
    ["style", "Style & text"],
    ["position", "Position, size & alignment"],
    ["animation", "Animation"],
  ]) {
    const section = document.createElement("details"),
      summary = document.createElement("summary");
    section.className = "widgetSection";
    summary.dataset.inspector = key;
    summary.textContent = name;
    summary.onclick = (event) => {
      event.preventDefault();
      if (section.open) {
        section.open = false;
        return;
      }
      tab = key;
      draw();
    };
    section.append(summary);
    $("widgetSettings").append(section);
    sections.set(key, section);
  }
  let drawing = false;
  let tab = "content",
    codeTab = "html";
  function field(name, key, type = "text", options = {}) {
    const row = document.createElement("label"),
      input = document.createElement(
        type === "select" ? "select" : type === "textarea" ? "textarea" : "input",
      );
    row.textContent = name;
    input.setAttribute("aria-label", name);
    if (type === "select")
      for (const [value, title] of options.choices) input.append(new Option(title, value));
    else if (type !== "textarea") input.type = type;
    if (type === "number" || key === "counterName") input.required = true;
    if (key === "counterName") input.maxLength = 80;
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    if (options.code) {
      input.className = "codeField";
      input.spellcheck = false;
    }
    input.dataset.field = key;
    const w = a.selected()[0],
      targetIds = a.selected().map((row) => row.id);
    if (type === "checkbox") {
      row.className = "check";
      input.checked = w[key];
    } else input.value = w[key];
    input.onchange = () => {
      if (key === "timezone") {
        try {
          new Intl.DateTimeFormat("en", { timeZone: input.value });
        } catch {
          input.setCustomValidity("Enter a timezone such as Europe/Lisbon or America/New_York.");
        }
      }
      if (["votePrefix", "joinCommand"].includes(key) && !/^![a-z0-9_]{1,23}$/i.test(input.value))
        input.setCustomValidity(
          "Use ! followed by letters, numbers or underscores, without spaces.",
        );
      if (key === "statField" && !/^[a-z][a-z0-9_]{0,23}$/i.test(input.value))
        input.setCustomValidity(
          "Use a stat name starting with a letter, with letters, numbers or underscores (up to 24 characters).",
        );
      if (key === "player" && input.value && !/^@?[a-z0-9_]{1,25}$/i.test(input.value))
        input.setCustomValidity("Enter a Twitch username, with or without @.");
      if (!input.reportValidity()) return;
      if (key === "fields")
        try {
          const parsed = JSON.parse(input.value);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error();
        } catch {
          input.setCustomValidity('Use a JSON object, such as {"name":"Hello"}.');
          input.reportValidity();
          return;
        }
      input.setCustomValidity("");
      const nextValue =
        type === "checkbox"
          ? input.checked
          : type === "number" || type === "range"
            ? Number(input.value)
            : input.value;
      const targets = a.doc.widgets.filter((row) => targetIds.includes(row.id));
      if (!targets.some((row) => row[key] !== nextValue)) return;
      a.change(() => {
        for (const target of targets)
          target[key] =
            type === "checkbox"
              ? input.checked
              : type === "number" || type === "range"
                ? Number(input.value)
                : input.value;
      }, ["font", "goalSource", "goalTracking", "goalTargetCounter", "goalBar", "statSource", "creditsSource", "chatMode", "textEffect", "accentStyle"].includes(key));
    };
    input.oninput = () => input.setCustomValidity("");
    row.append(input);
    host.append(row);
    return input;
  }
  const check = (name, key) => field(name, key, "checkbox");
  const num = (name, key, min, max) => field(name, key, "number", { min, max });
  const select = (name, key, choices) => field(name, key, "select", { choices });
  const widgetTools = OverlayWidgetControls(a, { host, num, select, check, field });
  function content(w) {
    widgetTools.content(w);
    if (w.type === "now-playing") {
      check("Show album artwork", "showArtwork");
      check("Show artist", "showArtist");
      check("Show requester", "showRequester");
      check("Show playback progress", "showProgress");
    }
    if (["text", "goal", "alerts"].includes(w.type))
      field(
        w.type === "goal"
          ? "Goal title"
          : w.type === "alerts"
            ? "Alert message (${name}, ${message}, ${amount})"
            : "Text",
        "text",
        "textarea",
      );
    if (["image", "video"].includes(w.type)) {
      field("HTTPS media URL or uploaded file", "url");
      const label = document.createElement("label"),
        upload = document.createElement("input");
      label.textContent = "Upload from this computer";
      upload.type = "file";
      upload.accept =
        w.type === "image" ? "image/png,image/jpeg,image/gif,image/webp" : "video/mp4,video/webm";
      upload.onchange = async () => {
        const file = upload.files?.[0];
        if (!file) return;
        try {
          const result = await a.request("/media", "POST", file, { "Content-Type": file.type });
          if (!a.doc.widgets.includes(w)) return;
          a.change(() => {
            w.url = result.url;
          });
        } catch (error) {
          a.notice(error.message);
        }
      };
      label.append(upload);
      host.append(label);
      widgetTools.mediaFit(w);
      if (w.type === "video") check("Loop video (muted)", "loop");
    }
    if (w.type === "countdown") {
      num("Duration (seconds)", "duration", 1, 86400);
      const finish = select("When time runs out", "countdownFinish", [
        ["zero", "Keep showing zero"],
        ["message", "Show a message"],
        ["hide", "Hide the timer"],
      ]);
      const message = field("Finished message", "countdownMessage", "text", { maxLength: 200 });
      const sync = () => {
        message.parentElement.hidden = w.countdownFinish !== "message";
      };
      const change = finish.onchange;
      finish.onchange = () => {
        change();
        sync();
      };
      sync();
      const button = document.createElement("button");
      button.textContent = "Start / restart countdown";
      button.onclick = () =>
        a.change(() => {
          w.endsAt = Date.now() + w.duration * 1000;
          w.countdownPaused = false;
        });
      host.append(button);
      const pause = document.createElement("button");
      pause.textContent = w.countdownPaused ? "Resume countdown" : "Pause countdown";
      pause.disabled = !w.countdownPaused && w.endsAt <= Date.now();
      pause.onclick = () =>
        a.change(() => {
          if (w.countdownPaused) {
            w.endsAt = Date.now() + w.pausedSeconds * 1000;
            w.countdownPaused = false;
          } else {
            w.pausedSeconds = Math.max(0, (w.endsAt - Date.now()) / 1000);
            w.countdownPaused = true;
          }
        });
      host.append(pause);
      const reset = document.createElement("button");
      reset.textContent = "Reset to duration";
      reset.onclick = () =>
        a.change(() => {
          w.endsAt = 0;
          w.countdownPaused = false;
        });
      host.append(reset);
    }
    if (w.type === "clock") field("Clock timezone", "timezone");
    if (["poll", "prediction", "hype-train"].includes(w.type))
      num("Show final result for (seconds)", "lingerSeconds", 0, 60);
    if (w.type === "goal") {
      const setups = OverlayGoalSources.sources.map((s) => [s.id, s.name, s.target, ""]);
      const setup = document.createElement("select");
      setup.setAttribute("aria-label", "Goal setup");
      setup.append(new Option("Choose a goal setup", ""));
      for (const [id, title] of setups) setup.append(new Option(title, id));
      setup.onchange = () => {
        const chosen = setups.find(([id]) => id === setup.value);
        if (!chosen) return;
        const [id, title, target, currency] = chosen;
        a.change(() =>
          Object.assign(w, {
            text: title,
            target,
            goalSource: "events",
            goalName: id,
            goalTracking: id,
            goalCounter: "goal-" + id,
            goalTargetCounter: "goal-" + id + "-target",
            goalCurrency: currency,
          }),
        );
      };
      const row = document.createElement("label");
      row.append("Goal setup", setup);
      host.append(row);
      select("Progress source", "goalSource", [
        ["events", "Named Twitch goal (events & timer)"],
        ["manual", "Edit in this overlay"],
        ["counter", "Automation counters"],
      ]);
      if (w.goalSource === "events") {
        field("Goal name", "goalName", "text", { maxLength: 64 });
        select(
          "Track",
          "goalTracking",
          OverlayGoalSources.sources.map((s) => [s.id, s.name]),
        );
        const source = OverlayGoalSources.find(w.goalTracking);
        const note = document.createElement("p");
        note.textContent =
          "Save this overlay to create or update its named goal. " +
          (source?.scope ? "Twitch access required: " + source.scope + ". " : "") +
          (source?.currency
            ? "Tracks Twitch charity donations, not third-party tips. Currency is taken from Twitch; different currencies are never combined."
            : source?.mode === "current"
              ? "Shows Twitch's current reading."
              : "Counts new events after the goal is created.");
        const end = document.createElement("input"),
          label = document.createElement("label");
        end.type = "datetime-local";
        label.textContent = "Goal end time (optional)";
        end.value = w.endsAt
          ? new Date(w.endsAt - new Date(w.endsAt).getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16)
          : "";
        end.onchange = () =>
          a.change(() => {
            w.endsAt = end.value ? new Date(end.value).getTime() : 0;
          }, false);
        label.append(end);
        const reset = document.createElement("button");
        reset.textContent = "Reset named goal progress";
        reset.onclick = async () => {
          try {
            const result = await a.request("/goals", "POST", {
              operation: "reset",
              name: w.goalName,
            });
            a.notice(result.message);
          } catch (error) {
            a.notice(error.message);
          }
        };
        host.append(note, label, reset);
      }
      if (w.goalSource === "counter") {
        field("Progress counter", "goalCounter", "text", { maxLength: 64 });
        field("Target counter (optional)", "goalTargetCounter", "text", { maxLength: 64 });
      }
      if (w.goalSource !== "events") {
        select("Amount format", "goalCurrency", [
          ["", "Number"],
          ["USD", "USD"],
          ["EUR", "EUR"],
          ["GBP", "GBP"],
          ["CAD", "CAD"],
          ["AUD", "AUD"],
          ["JPY", "JPY"],
          ["BRL", "BRL"],
          ...(!["", "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "BRL"].includes(w.goalCurrency)
            ? [[w.goalCurrency, w.goalCurrency]]
            : []),
        ]);
      }
      if (w.goalSource === "manual") num("Current amount", "current", 0, 1000000000).step = "any";
      num(
        w.goalSource === "counter" && w.goalTargetCounter ? "Starting target" : "Target amount",
        "target",
        0.01,
        1000000000,
      ).step = "any";
    }
    if (
      !["shape", "text", "image", "video", "custom", "goal"].includes(w.type) &&
      !OverlayGameRules.boardTypes.includes(w.type)
    )
      field("Optional label", "label");
    if (w.type === "alerts") num("Alert duration (seconds)", "lifetime", 1, 300);
    if (w.type === "alerts") setupOverlayAlertControls(a, host, w);
    if (["queue", "activity", "chat"].includes(w.type))
      num("Maximum visible items", "maxItems", 1, 20);
    if (["alerts", "activity"].includes(w.type)) {
      const title = document.createElement("h3");
      title.textContent = "Events to display";
      host.append(title);
      for (const [type, name] of [
        ["channel.follow", "Follows"],
        ["channel.subscribe", "Subscriptions"],
        ["channel.subscription.message", "Resubscriptions"],
        ["channel.subscription.gift", "Gift subscriptions"],
        ["channel.raid", "Raids"],
        ["channel.cheer", "Bits"],
        ["channel.charity_campaign.donate", "Twitch charity donations"],
      ]) {
        const label = document.createElement("label"),
          input = document.createElement("input");
        label.className = "check";
        input.type = "checkbox";
        input.checked = w.events.includes(type);
        input.onchange = () =>
          a.change(() => {
            w.events = input.checked ? [...w.events, type] : w.events.filter((row) => row !== type);
          });
        label.append(input, document.createTextNode(name));
        host.append(label);
      }
    }
    if (w.type === "custom") {
      const tabs = document.createElement("div");
      tabs.className = "codeTabs";
      for (const [key, name] of [
        ["html", "HTML"],
        ["css", "CSS"],
        ["js", "JS"],
        ["fields", "Fields"],
      ]) {
        const button = document.createElement("button");
        button.textContent = name;
        button.setAttribute("aria-pressed", String(codeTab === key));
        button.onclick = () => {
          codeTab = key;
          draw();
        };
        tabs.append(button);
      }
      host.append(tabs);
      field(codeTab.toUpperCase(), codeTab, "textarea", { code: true });
      const help = document.createElement("p");
      help.textContent =
        "Custom code runs in an isolated frame. Use GrobyDeckOverlay.fields and the overlay-data event for read-only data. Network requests and Core controls are unavailable.";
      host.append(help);
    }
    const info = a.catalog.find((row) => row.type === w.type);
    if (info?.requirement) {
      const note = document.createElement("p");
      note.textContent = info.requirement;
      host.append(note);
    }
    widgetTools.preview(w);
  }
  function draw() {
    if (drawing) return;
    drawing = true;
    try {
      renderFields();
    } finally {
      drawing = false;
    }
  }
  function renderFields() {
    const rows = a.selected(),
      w = rows[0];
    host.replaceChildren();
    for (const [key, section] of sections) section.open = key === tab;
    sections.get(tab).append(host);
    $("selectedName").textContent = w
      ? rows.length > 1
        ? rows.length + " layers selected"
        : w.name
      : "Widget settings";
    $("selectionHelp").textContent = w
      ? rows.length > 1
        ? "Style and position changes apply to the selection."
        : ""
      : "Select a layer on the canvas or in the list.";
    for (const button of document.querySelectorAll("[data-inspector]"))
      button.setAttribute("aria-selected", String(button.dataset.inspector === tab));
    if (!w) return;
    if (tab === "content") {
      if (rows.length === 1) content(w);
      else
        $("selectionHelp").textContent =
          "Select one layer to edit its content, or use Style and Position for the selection.";
    }
    if (tab === "animation") widgetTools.style(w);
    if (tab === "style") {
      const looks = [
        [
          "Clear",
          {
            backgroundOpacity: 0,
            color: "#ffffff",
            fontSize: 28,
            radius: 0,
            bold: false,
            font: "system",
          },
        ],
        [
          "Midnight panel",
          {
            background: "#101827",
            backgroundOpacity: 90,
            color: "#edf4ff",
            fontSize: 28,
            radius: 16,
            bold: false,
            font: "system",
          },
        ],
        [
          "Paper",
          {
            background: "#f4efe5",
            backgroundOpacity: 96,
            color: "#202733",
            fontSize: 26,
            radius: 12,
            bold: false,
            font: "serif",
          },
        ],
        [
          "Arcade",
          {
            background: "#18112d",
            backgroundOpacity: 92,
            color: "#7fffd4",
            fontSize: 28,
            radius: 4,
            bold: true,
            font: "mono",
          },
        ],
        [
          "Broadcast",
          {
            background: "#111111",
            backgroundOpacity: 85,
            color: "#ffffff",
            fontSize: 36,
            radius: 0,
            bold: true,
            font: "system",
          },
        ],
      ].map(([name, values]) => [name, { ...OverlayTextStyle.defaults, ...values }]);
      if (w.type === "goal") {
        looks.unshift(
          ["Inline text", { goalFormat: "inline", goalBar: false, backgroundOpacity: 0 }],
          ["Stacked text", { goalFormat: "stacked", goalBar: false, backgroundOpacity: 0 }],
          [
            "Progress card",
            {
              goalFormat: "stacked",
              goalBar: true,
              goalBarColor: "#c55ff4",
              background: "#101827",
              backgroundOpacity: 90,
              color: "#edf4ff",
              radius: 16,
            },
          ],
        );
        select("Goal text layout", "goalFormat", [
          ["inline", "Title and number on one line"],
          ["stacked", "Title above number"],
          ["amount", "Number only"],
          ["title", "Title only"],
        ]);
        check("Show progress bar", "goalBar");
        if (w.goalBar) {
          field("Progress bar color", "goalBarColor", "color");
          num("Progress bar height", "goalBarHeight", 2, 80);
        }
      }
      if (OverlayTextStyle.simple.has(w.type)) looks.unshift(...OverlayTextStyle.looks);
      const board = OverlayGameRules.boardTypes.includes(w.type) && rows.length === 1;
      const firstBoardField = host.children.length;
      if (board) widgetTools.boardStyle(w, looks);
      if (w.type === "chat")
        looks.unshift(
          [
            "Chat bubbles",
            {
              backgroundOpacity: 0,
              color: "#f8fafc",
              fontSize: 25,
              bold: false,
              lineHeight: 1.4,
              chatLayout: "stacked",
              itemBackground: "#111827",
              itemOpacity: 92,
              itemRadius: 14,
              itemPadding: 14,
              itemGap: 10,
              entrance: "slide",
              animationMs: 280,
              exitAnimation: true,
              textEffect: "none",
            },
          ],
          [
            "Broadcast chat",
            {
              backgroundOpacity: 0,
              color: "#f8fafc",
              fontSize: 26,
              bold: false,
              lineHeight: 1.35,
              chatLayout: "inline",
              itemBackground: "#101827",
              itemOpacity: 85,
              itemRadius: 4,
              itemPadding: 10,
              itemGap: 6,
              entrance: "slide-left",
              animationMs: 300,
              exitAnimation: true,
              textEffect: "none",
            },
          ],
          [
            "Minimal chat",
            {
              backgroundOpacity: 0,
              color: "#ffffff",
              fontSize: 26,
              bold: false,
              lineHeight: 1.4,
              chatLayout: "inline",
              itemOpacity: 0,
              itemPadding: 4,
              itemGap: 8,
              entrance: "fade",
              animationMs: 220,
              exitAnimation: true,
              textEffect: "shadow",
            },
          ],
        );
      if (!["image", "video", "custom"].includes(w.type)) {
        const label = document.createElement("label"),
          picker = document.createElement("select");
        label.textContent = "Design preset";
        picker.setAttribute("aria-label", "Design preset");
        picker.append(
          new Option("Custom style", ""),
          ...looks.map(([name]) => new Option(name, name)),
        );
        picker.value =
          looks.find(([, values]) =>
            Object.entries(values).every(([key, value]) => w[key] === value),
          )?.[0] || "";
        picker.onchange = () => {
          const look = looks.find(([name]) => name === picker.value);
          if (look)
            a.change(() => {
              for (const row of a.selected()) Object.assign(row, look[1]);
            });
        };
        label.append(picker);
        host.insertBefore(label, host.children[firstBoardField] || null);
      }

      field("Text color", "color", "color");
      num("Font size", "fontSize", 8, 240);
      select("Font", "font", [
        ["system", "System"],
        ["serif", "Serif"],
        ["mono", "Monospace"],
        ["installed", "Installed font"],
        ["uploaded", "Uploaded font"],
      ]);
      OverlayFonts.controls(a, host, w, field);
      select("Text alignment", "align", [
        ["left", "Left"],
        ["center", "Center"],
        ["right", "Right"],
      ]);
      check("Bold", "bold");
      num("Line height", "lineHeight", 1, 2.5).step = "0.05";
      num("Letter spacing (px)", "letterSpacing", -2, 20).step = "0.1";
      select("Text effect", "textEffect", [
        ["none", "None"],
        ["shadow", "Readable shadow"],
        ["outline", "Dark outline"],
        ["glow", "Soft glow"],
      ]);
      OverlayTextStyle.controls(a, w, { num, select, field });
      field("Background color", "background", "color");
      num("Background opacity (%)", "backgroundOpacity", 0, 100);
      num("Corner radius", "radius", 0, 500);
      num("Layer opacity (%)", "opacity", 0, 100);
    }
    if (tab === "position") {
      if (rows.length === 1) field("Layer name", "name");
      num("X", "x", 0, a.doc.width);
      num("Y", "y", 0, a.doc.height);
      num("Width", "width", 20, a.doc.width);
      num("Height", "height", 20, a.doc.height);
      num("Rotation (degrees)", "rotation", -360, 360);
      check("Keep aspect ratio when resizing", "lockRatio");
      check("Lock layer", "locked");
      const tools = document.createElement("div");
      tools.className = "alignTools";
      for (const [key, name] of [
        ["left", "Align left"],
        ["center", "Center horizontally"],
        ["right", "Align right"],
        ["top", "Align top"],
        ["middle", "Center vertically"],
        ["bottom", "Align bottom"],
      ]) {
        const button = document.createElement("button");
        button.textContent = name;
        button.onclick = () =>
          a.change(() => {
            for (const target of a.selected()) {
              if (["left", "center", "right"].includes(key))
                target.x =
                  key === "left"
                    ? 0
                    : key === "right"
                      ? a.doc.width - target.width
                      : (a.doc.width - target.width) / 2;
              else
                target.y =
                  key === "top"
                    ? 0
                    : key === "bottom"
                      ? a.doc.height - target.height
                      : (a.doc.height - target.height) / 2;
            }
          });
        tools.append(button);
      }
      host.append(tools);
    }
  }
  return {
    draw,
    show(name, refresh = true) {
      if (!sections.has(name)) return;
      tab = name;
      if (refresh) draw();
    },
  };
};
