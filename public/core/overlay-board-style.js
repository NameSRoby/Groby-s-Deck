/** Appearance controls shared by the game board editors. */
/* global GrobyRandomId, OverlayModel */
globalThis.OverlayBoardStyle = (
  a,
  { host, num, select, field },
  { group, details, el, labeled },
) => {
  const presets = [
    ["\u2713", "Check"],
    ["\u2715", "Cross"],
    ["\u2717", "Heavy cross"],
    ["\u2605", "Star"],
    ["\u2665", "Heart"],
    ["\u25cf", "Circle"],
    ["\u25c6", "Diamond"],
    ["\u26a0", "Warning"],
    ["\u23f8", "Paused"],
    ["\u2606", "Outline star"],
    ["\u2691", "Flag"],
    ["\u2794", "Arrow"],
    ["\u2726", "Sparkle"],
    ["\u25a0", "Square"],
    ["\u2212", "Dash"],
  ];
  function editCondition(parent, condition, keys = {}) {
    const keyFor = (key) => keys[key] || key;
    const get = (key) => condition[keyFor(key)];
    const set = (key, value) => {
      condition[keyFor(key)] = value;
    };
    const field = (container, title, type, key) => {
      const input = labeled(title, el("input"), container);
      input.type = type;
      input.value = get(key);
      input.onchange = () => {
        if (!input.reportValidity()) return;
        a.change(() => set(key, type === "number" ? input.valueAsNumber : input.value), false);
      };
      return input;
    };
    const check = (title, container, modes) => {
      const input = el("input");
      input.type = "checkbox";
      input.checked = modes.includes(get("mode"));
      labeled(title, input, container).parentElement.className = "check";
      return input;
    };
    const overlay = check("Show color overlay", parent, ["color", "both"]);
    const values = el("div");
    values.className = "tileColorValues";
    parent.append(values);
    const color = field(values, "Overlay color", "color", "color");
    const opacity = field(values, "Opacity (%)", "number", "opacity");
    Object.assign(opacity, { min: 0, max: 100, required: true });
    choices(
      parent,
      "Apply color to",
      get("tintTarget"),
      [
        ["tile", "Whole tile"],
        ["image", "Image only"],
      ],
      (value) => a.change(() => set("tintTarget", value), false),
    );

    const symbol = check("Show symbol", parent, ["symbol", "both"]);
    const options = el("details");
    options.append(el("summary", "Symbol options"));
    parent.append(options);
    const text = field(options, "Symbol text", "text", "symbol");
    text.maxLength = 16;
    field(options, "Symbol color", "color", "symbolColor");
    const icons = el("div");
    icons.className = "tileSymbolLibrary";
    icons.setAttribute("role", "group");
    icons.setAttribute("aria-label", "Symbol library");
    options.append(icons);
    const syncMode = () =>
      set(
        "mode",
        overlay.checked ? (symbol.checked ? "both" : "color") : symbol.checked ? "symbol" : "none",
      );
    overlay.onchange = symbol.onchange = () => a.change(syncMode, false);
    color.onchange = () => {
      overlay.checked = true;
      a.change(() => {
        set("color", color.value);
        syncMode();
      }, false);
    };
    for (const [value, title] of presets) {
      const button = el("button", value);
      button.type = "button";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.onclick = () => {
        text.value = value;
        symbol.checked = true;
        a.change(() => {
          set("symbol", value);
          syncMode();
        }, false);
      };
      icons.append(button);
    }
  }
  function tileColors(w) {
    const match = w.type === "tile-match";
    const help = el(
      "p",
      "Pick a color to turn on the overlay. Use a color, a symbol, or both. Image only keeps transparent areas clear.",
    );
    help.className = "tileColorHelp";
    host.append(help);
    for (const [title, condition, keys] of [
      [
        match ? "Matched" : "Completed",
        w,
        {
          mode: "markMode",
          color: "markColor",
          opacity: "markOpacity",
          tintTarget: "markTintTarget",
          symbol: "markSymbol",
          symbolColor: "markSymbolColor",
        },
      ],
      [match ? "Mismatch" : "Failed", w.failureCondition],
    ]) {
      const group = el("fieldset");
      group.className = "tileOutcome";
      group.append(el("legend", title));
      host.append(group);
      editCondition(group, condition, keys);
    }
    const order = el("fieldset");
    order.className = "tileOutcome";
    order.append(
      el("legend", "Layer order"),
      field("Color above text", "tintAboveLabel", "checkbox").parentElement,
      field("Symbol above text", "symbolAboveLabel", "checkbox").parentElement,
    );
    host.append(order);
    if (match) return;
    const panel = details("Custom tile conditions");
    panel.className = "boardSettings";
    panel.dataset.customTileConditions = "";
    for (const condition of w.customConditions) {
      const row = el("details");
      const heading = el("summary", condition.name);
      row.append(heading);
      panel.append(row);
      const name = labeled("Condition name", el("input"), row);
      Object.assign(name, { value: condition.name, maxLength: 40, required: true });
      name.onchange = () => {
        if (!name.reportValidity() || !name.value.trim()) return;
        a.change(() => {
          condition.name = name.value.trim();
        }, false);
        heading.textContent = condition.name;
      };
      editCondition(row, condition);
      const remove = el("button", "Remove condition");
      remove.type = "button";
      remove.onclick = () =>
        a.change(() => {
          w.customConditions = w.customConditions.filter((item) => item !== condition);
        });
      row.append(remove);
    }
    const add = el("button", "Add condition");
    add.type = "button";
    add.disabled = w.customConditions.length >= OverlayModel.boardConditionLimit;
    add.onclick = () => {
      a.change(() =>
        w.customConditions.push({
          id: GrobyRandomId(),
          name: "Condition " + (w.customConditions.length + 1),
          mode: "both",
          color: "#1d4ed8",
          opacity: 60,
          tintTarget: "tile",
          symbol: "\u2605",
          symbolColor: "#ffffff",
        }),
      );
      const current = host.querySelector("[data-custom-tile-conditions]");
      current.open = true;
      const row = current.querySelector(":scope > details:last-of-type");
      row.open = true;
      row.querySelector("input").focus();
    };
    panel.append(add);
  }
  function setImage(image, url) {
    image.hidden = !url;
    if (url) image.src = url;
    else image.removeAttribute("src");
  }
  function imageControl(parent, w, title, read, write) {
    const box = el("div");
    box.className = "boardImageControl";
    parent.append(box);
    const upload = el("input"),
      url = el("input"),
      thumbnail = el("img"),
      remove = el("button", "Remove image");
    thumbnail.alt = "";
    upload.type = "file";
    upload.accept = "image/png,image/jpeg,image/webp,image/gif";
    remove.type = "button";
    box.append(thumbnail);
    labeled(title, upload, box);
    box.append(remove);
    const link = el("details");
    link.append(el("summary", "Use an image URL"));
    labeled(title + " URL", url, link);
    url.placeholder = "https://";
    box.append(link);
    const update = () => {
      const current = read() || "";
      url.value = current;
      thumbnail.hidden = remove.hidden = !current;
      if (current) thumbnail.src = current;
      else thumbnail.removeAttribute("src");
    };
    const set = (value) => {
      a.change(() => write(value), false);
      update();
    };
    url.oninput = () => url.setCustomValidity("");
    url.onchange = () => {
      const value = OverlayModel.imageUrl(url.value.trim());
      if (!value && url.value.trim()) {
        url.setCustomValidity("Enter an HTTPS image URL.");
        url.reportValidity();
      } else set(value);
    };
    remove.onclick = () => {
      url.setCustomValidity("");
      set("");
    };
    upload.onchange = async () => {
      if (!upload.files[0]) return;
      upload.disabled = true;
      try {
        const asset = await a.request("/media", "POST", upload.files[0], {
          "Content-Type": upload.files[0].type,
        });
        if (!a.doc.widgets.includes(w) || !box.isConnected)
          throw Error("Reopen the image picker for this square.");
        if (!OverlayModel.imageUrl(asset.url))
          throw Error("Choose a PNG, JPEG, WebP or GIF image.");
        set(asset.url);
      } catch (error) {
        a.notice(error.message);
      } finally {
        upload.disabled = false;
        upload.value = "";
      }
    };
    update();
    return upload;
  }
  function hideLabel(parent, item) {
    const input = el("input");
    input.type = "checkbox";
    input.checked = item.labelHidden === true;
    labeled("Hide label on board", input, parent).parentElement.className = "check";
    input.onchange = () =>
      a.change(() => {
        if (input.checked) item.labelHidden = true;
        else delete item.labelHidden;
      }, false);
    return input;
  }
  function choices(parent, title, selected, entries, change) {
    const group = el("fieldset");
    group.className = "boardChoices";
    group.dataset.boardChoice = title;
    group.append(el("legend", title));
    const name = "board-choice-" + GrobyRandomId();
    for (const [value, label] of entries) {
      const input = el("input");
      Object.assign(input, { type: "radio", name, value, checked: selected === value });
      labeled(label, input, group);
      input.onchange = () => change(input.value);
    }
    parent.append(group);
  }
  const labelPositions = [
    ["center", "Center"],
    ["top", "Inside top"],
    ["bottom", "Inside bottom"],
    ["above", "Above tile"],
    ["below", "Below tile"],
  ];
  function labelPosition(parent, name, position, save) {
    choices(parent, name, position || "", [["", "Use board setting"], ...labelPositions], (value) =>
      a.change(() => save(value), false),
    );
  }
  function style(w, looks) {
    const boardLooks = [
      [
        "Midnight grid",
        {
          cellBackground: "#15233b",
          cellOpacity: 90,
          cellBorderColor: "#63768f",
          cellBorder: 1,
          cellRadius: 10,
          cellGap: 6,
          color: "#ffffff",
          markColor: "#137252",
          markOpacity: 85,
        },
      ],
      [
        "Paper card",
        {
          cellBackground: "#fff4d9",
          cellOpacity: 100,
          cellBorderColor: "#a59172",
          cellBorder: 1,
          cellRadius: 5,
          cellGap: 4,
          color: "#252019",
          markColor: "#f7bf53",
          markOpacity: 85,
        },
      ],
      [
        "Photo tiles",
        {
          cellBackground: "#0f172a",
          cellOpacity: 80,
          cellBorderColor: "#475569",
          cellBorder: 0,
          cellRadius: 8,
          cellGap: 4,
          color: "#ffffff",
          markColor: "#065f46",
          markOpacity: 55,
          textEffect: "shadow",
        },
      ],
    ];
    looks.splice(0, looks.length, ...boardLooks);
    if (w.type === "tile-match") field("Tile back color", "matchBackColor", "color");
    group("Tile appearance", () => {
      const fitOptions = [
        ["cover", "Fill and crop"],
        ["contain", "Fit entire image"],
      ];
      for (const [title, key] of [
        ["Board image fit", "boardImageFit"],
        ["Tile image fit", "cellImageFit"],
      ])
        choices(host, title, w[key], fitOptions, (value) =>
          a.change(() => {
            w[key] = value;
          }, false),
        );
      field("Square background", "cellBackground", "color");
      num("Square background opacity (%)", "cellOpacity", 0, 100);
      field("Square border color", "cellBorderColor", "color");
      num("Square border (px)", "cellBorder", 0, 12);
      num("Square corner radius (px)", "cellRadius", 0, 120);
      field("Show tile borders", "showCellBorders", "checkbox");
      field("Hide completed tiles", "hideCompletedTiles", "checkbox");
      choices(host, "Tile label position", w.labelPosition, labelPositions, (value) =>
        a.change(() => {
          w.labelPosition = value;
        }, false),
      );
      if (w.type !== "challenge-board") num("Space between squares (px)", "cellGap", 0, 60);
    });
    if (w.type !== "bingo") return;
    const patterns = details("Winning patterns");
    for (const [key, name] of [
      ["rows", "Rows"],
      ["columns", "Columns"],
      ["diagonals", "Diagonals on square boards"],
      ["all", "Full board"],
    ]) {
      const input = el("input");
      input.type = "checkbox";
      input.checked = w.bingoPatterns.includes(key);
      labeled(name, input, patterns).parentElement.className = "check";
      input.onchange = () =>
        a.change(() => {
          if (input.checked) w.bingoPatterns.push(key);
          else w.bingoPatterns = w.bingoPatterns.filter((pattern) => pattern !== key);
        }, false);
    }
    group(
      "Announcements",
      () => {
        const mode = select("Bingo announcement", "bingoAnnouncement", [
          ["off", "Hidden"],
          ["always", "Show while board has a win"],
          ["timed", "Show briefly after completing a pattern"],
        ]);
        const settings = [
          field("Announcement text", "bingoMessage", "text", { maxLength: 200 }),
          select("Announcement placement", "bingoPlacement", [
            ["top", "Above the board"],
            ["bottom", "Below the board"],
            ["overlay", "Over the board"],
          ]),
          field("Announcement text color", "bingoColor", "color"),
          field("Announcement background", "bingoBackground", "color"),
          num("Announcement background opacity (%)", "bingoBackgroundOpacity", 0, 100),
          num("Announcement text size (px)", "bingoFontSize", 8, 240),
        ];
        const seconds = num("Timed announcement (seconds)", "bingoSeconds", 1, 120);
        const refresh = () => {
          for (const input of settings) input.parentElement.hidden = w.bingoAnnouncement === "off";
          seconds.parentElement.hidden = w.bingoAnnouncement !== "timed";
        };
        const change = mode.onchange;
        mode.onchange = () => {
          change();
          refresh();
        };
        refresh();
      },
      true,
    );
  }
  return { style, tileColors, hideLabel, labelPosition, choices, setImage, imageControl };
};
