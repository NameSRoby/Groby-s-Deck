/** Presets set public fields; content, cards and motion remain independently editable. */
/* global OverlayModel, OverlayExtraControls */
globalThis.OverlayWidgetControls = function (a, tools) {
  const { host, num, select, check, field } = tools;
  const extra = OverlayExtraControls(a, tools);
  function mediaFit(w, label = "Fit") {
    const fit = select(label, "fit", [
      ["contain", "Fit inside"],
      ["cover", "Fill and crop"],
    ]);
    const focus = [
      num("Horizontal crop focus (%)", "mediaFocusX", 0, 100),
      num("Vertical crop focus (%)", "mediaFocusY", 0, 100),
    ];
    const sync = () => {
      for (const input of focus) input.parentElement.hidden = w.fit !== "cover";
    };
    const change = fit.onchange;
    fit.onchange = () => {
      change();
      sync();
    };
    sync();
  }
  function preview(w) {
    if (
      ![
        "shape",
        "text",
        "image",
        "video",
        "custom",
        "clock",
        "countdown",
        "goal",
        "slideshow",
        "rotating-text",
      ].includes(w.type)
    ) {
      const test = document.createElement("button");
      test.textContent = w.type === "chat" ? "Preview a chat message" : "Test this widget";
      test.onclick = () => a.testWidget(w);
      host.append(test);
    }
  }
  function content(w) {
    extra.content(w);
    if (w.type === "chat") {
      const removal = select("Message removal", "chatMode", [
        ["expire", "Disappear after a set time"],
        ["scroll", "Keep until pushed out by newer messages"],
      ]);
      const time = num("Message lifetime (seconds)", "lifetime", 1, 300);
      const note = document.createElement("small");
      const sync = () => {
        time.disabled = w.chatMode === "scroll";
        time.parentElement.hidden = w.chatMode === "scroll";
        note.textContent =
          w.chatMode === "scroll"
            ? "Messages stay until newer ones fill the box."
            : "Each message stays for 10 seconds by default. Change this to set its display time.";
      };
      const changeRemoval = removal.onchange;
      removal.onchange = () => {
        changeRemoval();
        sync();
      };
      sync();
      host.append(note);
      const appearance = document.createElement("fieldset");
      appearance.className = "chatDisplayOptions";
      const heading = document.createElement("legend");
      heading.textContent = "Show in chat";
      appearance.append(heading);
      for (const [label, field] of [
        ["Twitch username colors", "showChatColors"],
        ["Twitch chat badges", "showChatBadges"],
        ["Twitch emotes", "showTwitchEmotes"],
        ["7TV emotes", "showSevenTvEmotes"],
        ["BetterTTV emotes", "showBetterTtvEmotes"],
        ["FrankerFaceZ emotes", "showFrankerFaceZEmotes"],
      ]) {
        appearance.append(check(label, field).parentElement);
      }
      host.append(appearance);
      check("Hide app-sent bot messages", "hideBotMessages");
      check("Hide chat commands", "hideCommands");
      check("Show message timestamps", "showTimestamps");
      select("Username layout", "chatLayout", [
        ["inline", "Username beside message"],
        ["stacked", "Username above message"],
      ]);
      const label = document.createElement("label"),
        input = document.createElement("input");
      label.textContent = "Other accounts to hide (press Enter to add)";
      input.id = "hiddenChatAccounts";
      label.append(input);
      host.append(label);
      void import("/pill-input.js").then(({ createPillInput }) => {
        if (!host.contains(label)) return;
        let ready = false;
        const pills = createPillInput(input, {
          label: "Hidden chat accounts",
          maxItems: 32,
          maxLength: 26,
          normalize: (value) => value.trim().replace(/^@/, "").toLowerCase(),
          validate: (value) => (/^[a-z0-9_]{1,25}$/.test(value) ? "" : "Enter a Twitch username."),
          onChange: (values) => {
            if (ready)
              a.change(() => {
                w.hiddenAccounts = values;
              }, false);
          },
        });
        pills.set(w.hiddenAccounts || []);
        ready = true;
      });
      const help = document.createElement("small");
      help.textContent =
        "App-sent replies are identified automatically. Add other bot accounts here. Messages you type manually as the broadcaster stay visible.";
      host.append(help);
    }
    if (!["slideshow", "rotating-text", "credits"].includes(w.type)) return;
    const label = document.createElement("label"),
      input = document.createElement("textarea");
    label.textContent =
      w.type === "slideshow"
        ? "Media URLs (one per line, up to 20; images or muted MP4/WebM)"
        : "Names or messages (one per line)";
    input.value = (w.items || []).join("\n");
    input.dataset.field = "items";
    input.oninput = () => input.setCustomValidity("");
    input.onchange = () => {
      const items = input.value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      input.setCustomValidity(
        items.length > (w.type === "credits" ? 1000 : 20)
          ? "Too many entries (credits: 1,000; other lists: 20)."
          : w.type === "slideshow" && items.some((s) => !OverlayModel.mediaUrl(s))
            ? "Use an HTTPS media URL or an uploaded Groby’s Deck media URL."
            : items.some((s) => s.length > (w.type === "slideshow" ? 2048 : 500))
              ? "An entry is too long."
              : "",
      );
      if (!input.reportValidity()) return;
      a.change(() => {
        w.items = items;
      });
    };
    label.append(input);
    label.hidden = w.type === "credits" && w.creditsSource !== "manual";
    host.append(label);
    if (w.type === "slideshow") {
      const uploadLabel = document.createElement("label"),
        upload = document.createElement("input");
      uploadLabel.textContent = "Add media from this computer";
      upload.type = "file";
      upload.multiple = true;
      upload.accept = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm";
      upload.onchange = async () => {
        const files = [...upload.files];
        if (files.length + (w.items?.length || 0) > 20)
          return a.notice("A slideshow can contain up to 20 media entries.");
        upload.disabled = true;
        try {
          const urls = [];
          for (const file of files) {
            const result = await a.request("/media", "POST", file, { "Content-Type": file.type });
            urls.push(result.url);
          }
          a.change(() => {
            w.items = [...(w.items || []), ...urls];
          });
        } catch (error) {
          a.notice(error.message);
        } finally {
          upload.disabled = false;
        }
      };
      uploadLabel.append(upload);
      host.append(uploadLabel);
    }

    if (w.type !== "credits") num("Time per entry (seconds)", "rotateEvery", 2, 3600);
    if (w.type === "slideshow") mediaFit(w, "Media fit");
    if (w.type === "credits") {
      const presetLabel = document.createElement("label"),
        preset = document.createElement("select");
      presetLabel.textContent = "Credit roll preset";
      preset.setAttribute("aria-label", "Credit roll preset");
      preset.append(new Option("Choose a starting credit roll", ""));
      for (const source of ["followers", "subscribers"])
        for (const [period, title] of [
          ["day", "Past day"],
          ["week", "Past week"],
          ["month", "Past month"],
          ["year", "Past year"],
          ["all", "All available"],
        ])
          preset.append(new Option(source + " - " + title, source + ":" + period));
      preset.onchange = () => {
        if (!preset.value) return;
        const [source, period] = preset.value.split(":");
        a.change(() => {
          w.creditsSource = source;
          w.creditsPeriod = period;
          w.scrollDirection = "vertical";
          w.scrollSeconds = 30;
        });
      };
      presetLabel.append(preset);
      host.append(presetLabel);

      select("Credit names", "creditsSource", [
        ["manual", "My list"],
        ["followers", "Followers"],
        ["subscribers", "Subscribers"],
      ]);
      const period = select("Period", "creditsPeriod", [
        ["day", "Past day"],
        ["week", "Past 7 days"],
        ["month", "Past 30 days"],
        ["year", "Past 365 days"],
        ["all", "All available"],
      ]);
      period.parentElement.hidden = w.creditsSource === "manual";
      select("Scroll direction", "scrollDirection", [
        ["vertical", "Vertical"],
        ["horizontal", "Horizontal"],
      ]);
      num("Seconds per full scroll", "scrollSeconds", 5, 600);
      check("Reverse scroll direction", "scrollReverse");
      check("Pause credit scroll", "scrollPaused");
      num("Spacing between names (px)", "creditGap", 0, 240);
      field("Separator between names (optional)", "creditSeparator", "text", { maxLength: 8 });
      const note = document.createElement("p");
      note.textContent =
        "All available subscribers means current subscribers. Dated subscriber credits use events recorded by Core; Twitch does not provide historical subscription dates. Follower dates come from Twitch. Lists are cached and limited to 1,000 fetched names.";
      host.append(note);
    }
  }
  function style(w) {
    const label = document.createElement("label"),
      picker = document.createElement("select");
    label.textContent = "Animated preset";
    picker.setAttribute("aria-label", "Animated preset");
    const options = [
      [
        "Card stack",
        {
          entrance: "slide",
          exitAnimation: true,
          itemBackground: "#17233b",
          itemOpacity: 92,
          itemRadius: 14,
          itemPadding: 12,
          itemGap: 8,
          motionTarget: "box",
          ambient: "none",
        },
      ],
      [
        "Soft reveal",
        { entrance: "fade", exitAnimation: true, motionTarget: "text", ambient: "none" },
      ],
      [
        "Arcade pop",
        {
          entrance: "pop",
          exitAnimation: true,
          motionTarget: "box",
          itemBackground: "#18112d",
          itemOpacity: 92,
          itemRadius: 6,
          itemPadding: 10,
          itemGap: 6,
          color: "#7fffd4",
          ambient: "none",
        },
      ],
      [
        "Broadcast reveal",
        { entrance: "wipe", exitAnimation: true, motionTarget: "box", ambient: "none" },
      ],
      ["Floating panel", { entrance: "none", ambient: "float" }],
      ["No movement", { entrance: "none", ambient: "none", exitAnimation: false }],
    ];
    picker.append(
      new Option("Choose a starting animation", ""),
      ...options
        .filter(
          ([name]) =>
            name !== "Card stack" || ["chat", "activity", "queue", "alerts"].includes(w.type),
        )
        .filter(
          ([name]) =>
            name !== "Floating panel" ||
            !["chat", "activity", "queue", "alerts", "credits"].includes(w.type),
        )
        .map(([name]) => new Option(name, name)),
    );
    picker.onchange = () => {
      const chosen = options.find(([name]) => name === picker.value);
      if (chosen)
        a.change(() => {
          for (const row of a.selected()) Object.assign(row, chosen[1]);
        });
    };
    label.append(picker);
    host.append(label);
    select("Entrance", "entrance", [
      ["none", "None"],
      ["fade", "Fade"],
      ["slide", "Slide up"],
      ["slide-left", "Slide from left"],
      ["slide-right", "Slide from right"],
      ["pop", "Pop in"],
      ["wipe", "Reveal from left"],
      ["blur", "Soft focus reveal"],
    ]);
    num("Transition duration (ms)", "animationMs", 100, 2000);
    if (["chat", "activity", "queue", "alerts"].includes(w.type)) {
      select("Animate", "motionTarget", [
        ["box", "Whole message card"],
        ["text", "Text only"],
      ]);
      check("Fade outgoing messages", "exitAnimation");
      field("Card color", "itemBackground", "color");
      num("Card opacity (%)", "itemOpacity", 0, 100);
      num("Card corners", "itemRadius", 0, 100);
      num("Card padding", "itemPadding", 0, 60);
      num("Space between cards", "itemGap", 0, 60);
    }
    if (w.type === "chat") {
      const shortcut = document.createElement("button");
      shortcut.textContent = "Message lifetime & filtering";
      shortcut.onclick = () => document.querySelector('[data-inspector="content"]').click();
      host.append(shortcut);
    }
    if (!["chat", "activity", "queue", "alerts", "credits"].includes(w.type)) {
      select("Continuous movement", "ambient", [
        ["none", "None"],
        ["float", "Gentle float"],
        ["breathe", "Soft opacity pulse"],
      ]);
      num("Movement cycle (seconds)", "ambientSeconds", 2, 60);
    }
    const replay = document.createElement("button");
    replay.textContent = "Replay animation";
    replay.onclick = () => {
      for (const row of a.$("canvas").children)
        if (a.selection.has(row.dataset.widgetId))
          for (const animation of row.getAnimations({ subtree: true })) {
            animation.currentTime = 0;
            animation.play();
          }
    };
    host.append(replay);
    const note = document.createElement("p");
    note.textContent = a.motionReady
      ? "Motion uses Canvas settings > Overlay animations, shared with OBS. Broadcast animations run even if Windows animations are disabled."
      : "Preview is available. Restart Core before saving animated styles or the new widgets.";
    host.append(note);
  }
  return { content, preview, style, mediaFit, boardStyle: extra.boardStyle };
};
