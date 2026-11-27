/** Appearance controls shared by the game board editors. */
globalThis.OverlayBoardStyle = (
  a,
  { host, num, select, field },
  { group, details, el, labeled },
) => {
  return function style(w, looks) {
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
          ["color", "Color"],
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
      if (w.type !== "challenge-board") num("Space between squares (px)", "cellGap", 0, 60);
    });
    host.append(marks);
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
  };
};
