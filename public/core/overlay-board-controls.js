/** Board editing shares the stored layout and game controls used by the deck. */
/* global OverlayModel, OverlayGameRules, GrobyRandomId */
globalThis.OverlayBoardControls = (a, { host, num, select, check, field }, button, note) => {
  const selected = new WeakMap();
  const pageSize = 24;
  const percent = (value, min = 0) => Math.round(Math.max(min, Math.min(100, value)) * 10) / 10;
  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  function labeled(name, input, parent = host) {
    const label = el("label", name);
    input.setAttribute("aria-label", name);
    label.append(input);
    parent.append(label);
    return input;
  }
  function details(title) {
    const panel = el("details");
    panel.append(el("summary", title));
    host.append(panel);
    return panel;
  }
  function group(title, draw, open = false) {
    const panel = details(title);
    panel.className = "boardSettings";
    panel.open = open;
    const index = host.children.length;
    draw();
    panel.append(...Array.from(host.children).slice(index));
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
  }
  function play(w, run, count) {
    if (!count) return;
    const input = labeled(
      w.type === "bingo" ? "Bingo square to mark" : "Challenge tile to mark",
      el("input"),
    );
    input.type = "number";
    input.min = 1;
    input.max = count;
    input.value = selected.get(w) || 1;
    button("Toggle square", () => {
      if (input.reportValidity()) return run("mark", { cell: Number(input.value) });
    });
  }
  function bingo(w, run) {
    const max = OverlayModel.boardLimit;
    const columns = labeled("Board size", el("select"));
    const sizes = [...new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, w.gridSize])].sort((a, b) => a - b);
    for (const size of sizes) columns.add(new Option(size + " columns", size));
    columns.add(new Option("Custom columns…", "custom"));
    columns.value = w.gridSize;
    const custom = labeled("Columns", el("input"));
    custom.type = "number";
    custom.min = 1;
    custom.max = max;
    custom.required = true;
    custom.value = w.gridSize;
    custom.parentElement.hidden = true;
    const rows = labeled("Rows", el("input"));
    rows.type = "number";
    rows.min = 1;
    rows.placeholder = "Same as columns";
    rows.value = w.gridRows || "";
    const dimensions = (width) => {
      const height = Number(rows.value);
      const limit = Math.floor(max / width);
      a.change(() => {
        w.gridSize = width;
        w.gridRows = height ? Math.min(height, limit) : width > limit ? limit : 0;
      });
    };
    columns.onchange = () => {
      if (columns.value === "custom") {
        custom.parentElement.hidden = false;
        custom.focus();
      } else dimensions(Number(columns.value));
    };
    custom.onchange = () => {
      if (custom.reportValidity()) dimensions(Number(custom.value));
    };
    rows.max = Math.floor(max / w.gridSize);
    rows.onchange = () => {
      if (rows.reportValidity()) dimensions(w.gridSize);
    };
    const { count } = OverlayGameRules.bingoLayout(w);
    const free = check("Free center square (odd-sized boards)", "freeCenter");
    const grid = el("div");
    grid.className = "bingoEditor";
    const nav = el("div");
    nav.className = "boardEditorTools";
    const previous = el("button", "Previous squares"),
      next = el("button", "Next squares");
    previous.type = next.type = "button";
    const range = el("span");
    nav.append(previous, range, next);
    host.append(nav, grid);
    let active = Math.min(selected.get(w) || 1, count),
      start = Math.floor((active - 1) / pageSize) * pageSize;
    function labels() {
      const end = Math.min(count, start + pageSize);
      const center = OverlayGameRules.bingoLayout(w).center;
      grid.replaceChildren();
      for (let i = start; i < end; i++) {
        const line = el("div"),
          cell = el("input"),
          pick = el("button", "Image"),
          mark = el("button", "✓");
        cell.value = i === center ? "FREE" : w.items[i] || "";
        cell.disabled = i === center;
        cell.placeholder = "Square " + (i + 1);
        cell.maxLength = 200;
        cell.setAttribute("aria-label", "Bingo text " + (i + 1));
        cell.onchange = () =>
          a.change(() => {
            while (w.items.length <= i) w.items.push("");
            w.items[i] = cell.value;
          }, false);
        pick.type = "button";
        pick.setAttribute("aria-label", "Image for square " + (i + 1));
        pick.onclick = () => openImage(i + 1, true);
        mark.type = "button";
        mark.disabled = i === center;
        mark.title = "Toggle square " + (i + 1);
        mark.setAttribute("aria-label", mark.title);
        mark.onclick = () =>
          void run("mark", { cell: i + 1 }).catch((error) => a.notice(error.message));
        line.append(cell, pick, mark);
        grid.append(line);
      }
      previous.disabled = !start;
      next.disabled = end === count;
      range.textContent = start + 1 + "–" + end + " of " + count;
    }
    previous.onclick = () => {
      start -= pageSize;
      labels();
    };
    next.onclick = () => {
      start += pageSize;
      labels();
    };
    nav.hidden = count <= pageSize;
    const freeChange = free.onchange;
    free.onchange = () => {
      freeChange();
      labels();
    };
    const squareImage = details("Square image");
    const imageNumber = labeled("Square number for image", el("input"), squareImage);
    imageNumber.type = "number";
    imageNumber.min = 1;
    imageNumber.max = count;
    imageNumber.required = true;
    const picker = el("div");
    squareImage.append(picker);
    function openImage(value, reveal) {
      active = value;
      selected.set(w, active);
      imageNumber.value = active;
      picker.replaceChildren();
      const index = active - 1;
      imageControl(
        picker,
        w,
        "Square " + active + " image",
        () => w.boardImages[index],
        (url) => {
          if (url) w.boardImages[index] = url;
          else delete w.boardImages[index];
        },
      );
      if (reveal) {
        squareImage.open = true;
        picker.querySelector('input[type="file"]').click();
      }
    }
    imageNumber.onchange = () => {
      if (imageNumber.reportValidity()) openImage(Number(imageNumber.value));
    };
    labels();
    openImage(active);
    const bulk = details("Paste square labels");
    const lines = labeled("Labels in board order, one per line", el("textarea"), bulk);
    const apply = el("button", "Replace square labels");
    apply.type = "button";
    apply.onclick = () => {
      if (!lines.value) return;
      const values = lines.value.replace(/\r/g, "").split("\n");
      if (values.at(-1) === "") values.pop();
      if (values.length > count)
        return a.notice("Increase the board dimensions to fit the pasted labels.");
      a.change(() => {
        w.items = values.map((value) => value.slice(0, 200));
      }, false);
      labels();
    };
    bulk.append(apply);
    play(w, run, count);
    note(
      "Changing Bingo dimensions starts a fresh round. Open saved boards from Game boards in the Button Deck.",
    );
  }
  const tileGeometry = [
    ["x", "Left (%)", 0, 100],
    ["y", "Top (%)", 0, 100],
    ["width", "Width (%)", 0.1, 100],
    ["height", "Height (%)", 0.1, 100],
    ["rotation", "Rotation (°)", -360, 360],
  ];
  function challenge(w, run) {
    const visual = el("div");
    visual.className = "challengeEditor";
    visual.style.aspectRatio = w.width + " / " + w.height;
    const tile = w.tiles[Math.min(selected.get(w) || 1, w.tiles.length) - 1];
    const background = el("img");
    background.alt = "";
    background.style.objectFit = w.boardImageFit;
    setImage(background, w.boardImage);
    visual.append(background);
    const tools = el("div");
    tools.className = "boardEditorTools";
    host.append(tools, visual);
    tools.append(
      button("Add tile", () => {
        if (w.tiles.length >= OverlayModel.boardLimit) throw Error("This board is full.");
        const i = w.tiles.length;
        selected.set(w, i + 1);
        a.change(() =>
          w.tiles.push({
            id: GrobyRandomId(),
            text: "",
            image: "",
            width: 22,
            height: 22,
            rotation: 0,
            x: (i % 4) * 25 + 2,
            y: (Math.floor(i / 4) % 4) * 25 + 2,
          }),
        );
      }),
    );
    for (const [index, item] of w.tiles.entries()) {
      const node = el("button"),
        image = el("img");
      const caption = el("span", item.text || "Tile " + (index + 1));
      caption.className = "challengeCaption";
      image.alt = "";
      image.style.objectFit = w.cellImageFit;
      setImage(image, item.image);
      node.append(image, caption);
      if (item === tile) {
        const grip = el("span");
        grip.className = "challengeResize";
        grip.setAttribute("aria-hidden", "true");
        node.append(grip);
      }
      node.type = "button";
      node.setAttribute("aria-pressed", String(item === tile));
      const position = (x, y, width, height) =>
        Object.assign(node.style, {
          left: x + "%",
          top: y + "%",
          width: width + "%",
          height: height + "%",
          transform: `rotate(${item.rotation}deg)`,
        });
      position(item.x, item.y, item.width, item.height);
      node.onclick = () => {
        if (item !== tile) {
          selected.set(w, index + 1);
          a.draw();
        }
      };
      node.onpointerdown = (event) => {
        if (event.button !== 0) return;
        const bounds = visual.getBoundingClientRect();
        const start = [event.clientX, event.clientY];
        const resizing = event.target.classList.contains("challengeResize"),
          angle = (item.rotation * Math.PI) / 180;
        let change;
        node.setPointerCapture(event.pointerId);
        node.onpointermove = (move) => {
          if (move.pointerId !== event.pointerId) return;
          const dx = move.clientX - start[0],
            dy = move.clientY - start[1];
          if (!change && Math.hypot(dx, dy) < 3) return;
          change = resizing
            ? {
                width: percent(
                  item.width + (100 * (dx * Math.cos(angle) + dy * Math.sin(angle))) / bounds.width,
                  0.1,
                ),
                height: percent(
                  item.height +
                    (100 * (dy * Math.cos(angle) - dx * Math.sin(angle))) / bounds.height,
                  0.1,
                ),
              }
            : {
                x: percent(item.x + (100 * dx) / bounds.width),
                y: percent(item.y + (100 * dy) / bounds.height),
              };
          const moved = { ...item, ...change };
          position(moved.x, moved.y, moved.width, moved.height);
        };
        node.onpointerup = () => {
          node.onpointermove = null;
          if (!change) return;
          selected.set(w, index + 1);
          a.change(() => Object.assign(item, change));
        };
        node.onpointercancel = () => {
          node.onpointermove = null;
          position(item.x, item.y, item.width, item.height);
        };
      };
      visual.append(node);
    }
    if (!tile) {
      note("Add a tile to start building your board.");
      return background;
    }
    const tiles = labeled("Selected tile", el("select"));
    w.tiles.forEach((item, i) => tiles.add(new Option(item.text || "Tile " + (i + 1), i + 1)));
    tiles.value = w.tiles.indexOf(tile) + 1;
    tiles.onchange = () => {
      selected.set(w, Number(tiles.value));
      a.draw();
    };
    const name = labeled("Tile label", el("input"));
    name.maxLength = 200;
    name.value = tile.text;
    name.onchange = () => {
      const index = w.tiles.indexOf(tile);
      a.change(() => {
        tile.text = name.value;
      }, false);
      tiles.options[index].text = tile.text || "Tile " + (index + 1);
      visual.querySelector('[aria-pressed="true"] .challengeCaption').textContent =
        tiles.options[index].text;
    };
    const geometry = el("div");
    geometry.className = "tileGeometry";
    host.append(geometry);
    for (const [key, title, min, max] of tileGeometry) {
      const input = labeled(title, el("input"), geometry);
      input.type = "number";
      input.min = min;
      input.max = max;
      input.step = 0.1;
      input.required = true;
      input.value = tile[key];
      input.onchange = () => {
        if (input.reportValidity()) {
          a.change(() => {
            tile[key] = Number(input.value);
          }, false);
          const node = visual.querySelector('[aria-pressed="true"]');
          if (key === "rotation") node.style.transform = `rotate(${tile.rotation}deg)`;
          else node.style[{ x: "left", y: "top" }[key] || key] = tile[key] + "%";
        }
      };
    }
    imageControl(
      host,
      w,
      "Tile image",
      () => tile.image,
      (url) => {
        tile.image = url;
        setImage(visual.querySelector('[aria-pressed="true"] img'), url);
      },
    );
    button("Remove selected tile", () => a.change(() => w.tiles.splice(w.tiles.indexOf(tile), 1)));
    play(w, run, w.tiles.length);
    note("Drag a tile to move it. Drag its corner to resize it.");
    return background;
  }
  function setImage(image, url) {
    image.hidden = !url;
    if (url) image.src = url;
    else image.removeAttribute("src");
  }
  function match(w, run) {
    num("Columns", "matchColumns", 2, 12);
    num("Mismatch reveal time (seconds)", "matchRevealSeconds", 0.5, 10).step = 0.5;
    field("Tile back symbol", "matchBack", "text", { maxLength: 16 });
    check("Show matching progress", "matchProgress");
    const pairs = details("Edit pairs");
    pairs.open = true;
    for (const [index, pair] of w.matchPairs.entries()) {
      const entry = el("details");
      const summary = el("summary", pair.text || "Pair " + (index + 1));
      entry.append(summary);
      const name = labeled("Pair " + (index + 1) + " label", el("input"), entry);
      name.maxLength = 80;
      name.value = pair.text;
      name.onchange = () => {
        a.change(() => {
          pair.text = name.value;
        }, false);
        summary.textContent = pair.text || "Pair " + (index + 1);
      };
      imageControl(
        entry,
        w,
        "Pair " + (index + 1) + " image",
        () => pair.image,
        (url) => {
          pair.image = url;
        },
      );
      const remove = el("button", "Remove pair");
      remove.type = "button";
      remove.disabled = w.matchPairs.length <= 2;
      remove.onclick = () => a.change(() => w.matchPairs.splice(index, 1));
      entry.append(remove);
      pairs.append(entry);
    }
    const add = button("Add pair", () =>
      a.change(() =>
        w.matchPairs.push({
          id: GrobyRandomId(),
          text: "Pair " + (w.matchPairs.length + 1),
          image: "",
        }),
      ),
    );
    add.disabled = w.matchPairs.length >= OverlayModel.matchPairLimit;
    const tiles = el("div");
    tiles.className = "matchPlayControls";
    tiles.setAttribute("role", "group");
    tiles.setAttribute("aria-label", "Flip tiles");
    for (let i = 1; i <= w.matchPairs.length * 2; i++) {
      const flip = button(String(i), () => run("flip", { cell: i }));
      flip.setAttribute("aria-label", "Flip tile " + i);
      tiles.append(flip);
    }
    host.append(tiles);
    note(
      "Try the numbered tiles with Sample data, or open saved games from Game boards in the Button Deck.",
    );
  }
  function content(w, run) {
    const background = details("Board background image");
    let thumbnail;
    imageControl(
      background,
      w,
      "Board image",
      () => w.boardImage,
      (url) => {
        w.boardImage = url;
        if (thumbnail) setImage(thumbnail, url);
      },
    );
    field("Board title", "label", "text", { maxLength: 100 });
    check("Show tile labels", "showCellLabels");
    if (w.type === "bingo") bingo(w, run);
    else if (w.type === "tile-match") match(w, run);
    else thumbnail = challenge(w, run);
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
  return { content, style };
};
