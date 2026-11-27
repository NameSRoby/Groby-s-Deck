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
  function symbolPicker(parent, name, input) {
    const browser = labeled(name, el("select"), parent);
    browser.add(new Option("Choose a symbol", ""));
    for (const [symbol, title] of presets) browser.add(new Option(symbol + "  " + title, symbol));
    browser.onchange = () => {
      if (browser.value) {
        input.value = browser.value;
        input.dispatchEvent(new Event("change"));
      }
      browser.value = "";
    };
    return browser;
  }
  function editCondition(parent, condition, removing) {
    const field = (title, type, key) => {
      const input = labeled(title, el("input"), parent);
      input.type = type;
      input.value = condition[key];
      input.onchange = () =>
        a.change(() => {
          condition[key] = type === "number" ? input.valueAsNumber : input.value;
        }, false);
      return input;
    };
    if (removing) {
      const name = field("Condition name", "text", "name");
      name.maxLength = 40;
      name.required = true;
      const change = name.onchange;
      name.onchange = () => {
        if (!name.reportValidity() || !name.value.trim()) return;
        change();
        parent.querySelector("summary").textContent = name.value.trim();
      };
    }
    const mode = labeled("Condition appearance", el("select"), parent);
    for (const [key, title] of [
      ["none", "No mark"],
      ["color", "Color overlay"],
      ["symbol", "Symbol"],
      ["both", "Color and symbol"],
    ])
      mode.add(new Option(title, key));
    mode.value = condition.mode;
    const color = field("Overlay color", "color", "color");
    const opacity = field("Overlay opacity (%)", "number", "opacity");
    Object.assign(opacity, { min: 0, max: 100, required: true });
    const changeOpacity = opacity.onchange;
    opacity.onchange = () => {
      if (opacity.reportValidity()) changeOpacity();
    };
    const symbol = field("Condition symbol", "text", "symbol");
    symbol.maxLength = 16;
    const icons = symbolPicker(parent, "Condition symbol library", symbol);
    const symbolColor = field("Condition symbol color", "color", "symbolColor");
    const refresh = () => {
      for (const input of [color, opacity])
        input.parentElement.hidden = !["color", "both"].includes(mode.value);
      for (const input of [symbol, icons, symbolColor])
        input.parentElement.hidden = !["symbol", "both"].includes(mode.value);
    };
    mode.onchange = () => {
      a.change(() => {
        condition.mode = mode.value;
      }, false);
      refresh();
    };
    refresh();
    if (removing) {
      const remove = el("button", "Remove condition");
      remove.type = "button";
      remove.onclick = removing;
      parent.append(remove);
    }
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
  function labelPosition(parent, name, position, save) {
    const input = labeled(name, el("select"), parent);
    input.add(new Option("Use board setting", ""));
    for (const value of OverlayModel.boardLabelPositions)
      input.add(new Option(value[0].toUpperCase() + value.slice(1), value));
    input.value = position || "";
    input.onchange = () => a.change(() => save(input.value), false);
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
    const marksStart = host.children.length;
    group(
      "Completion marks",
      () => {
        const mode = select("Completed square", "markMode", [
          ["color", "Color overlay"],
          ["symbol", "Symbol"],
          ["both", "Color and symbol"],
        ]);
        const colors = [
          field("Completion color", "markColor", "color"),
          num("Completion color opacity (%)", "markOpacity", 0, 100),
        ];
        const symbols = [
          field("Completion symbol", "markSymbol", "text", { maxLength: 16 }),
          field("Symbol color", "markSymbolColor", "color"),
        ];
        symbols.push(symbolPicker(host, "Completion symbol library", symbols[0]));
        const refresh = () => {
          for (const input of colors) input.parentElement.hidden = w.markMode === "symbol";
          for (const input of symbols) input.parentElement.hidden = w.markMode === "color";
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
    const marks = host.children[marksStart];
    group("Tile appearance", () => {
      const fitOptions = [
        ["cover", "Fill and crop"],
        ["contain", "Fit entire image"],
      ];
      select("Board image fit", "boardImageFit", fitOptions);
      select("Tile image fit", "cellImageFit", fitOptions);
      field("Square background", "cellBackground", "color");
      num("Square background opacity (%)", "cellOpacity", 0, 100);
      field("Square border color", "cellBorderColor", "color");
      num("Square border (px)", "cellBorder", 0, 12);
      num("Square corner radius (px)", "cellRadius", 0, 120);
      field("Show tile borders", "showCellBorders", "checkbox");
      field("Hide completed tiles", "hideCompletedTiles", "checkbox");
      select("Tile label position", "labelPosition", [
        ["center", "Center of tile"],
        ["top", "Top inside tile"],
        ["bottom", "Bottom inside tile"],
        ["above", "Above tile"],
        ["below", "Below tile"],
      ]);
      if (w.type !== "challenge-board") num("Space between squares (px)", "cellGap", 0, 60);
    });
    host.append(marks);
    editCondition(
      details(w.type === "tile-match" ? "Mismatch mark" : "Failure mark"),
      w.failureCondition,
    );
    if (w.type !== "tile-match") {
      const panel = details("Custom tile conditions");
      for (const condition of w.customConditions) {
        const row = el("details");
        row.append(el("summary", condition.name));
        panel.append(row);
        editCondition(row, condition, () =>
          a.change(() => {
            w.customConditions = w.customConditions.filter((item) => item !== condition);
          }),
        );
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
            symbol: "\u2605",
            symbolColor: "#ffffff",
          }),
        );
        const current = host.querySelector("[data-custom-tile-conditions]");
        current.open = true;
        current.querySelector("details:last-of-type").open = true;
        current.querySelector("details:last-of-type input").focus();
      };
      panel.dataset.customTileConditions = "";
      panel.append(add);
    }
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
  return { style, hideLabel, labelPosition };
};
