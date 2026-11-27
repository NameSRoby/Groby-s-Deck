/** Board editing shares the stored layout and game controls used by the deck. */
/* global OverlayModel, OverlayGameRules, OverlayBoardStyle, GrobyRandomId */
globalThis.OverlayBoardControls = (a, { host, num, select, check, field }, button, note) => {
  const selected = new WeakMap();
  let highlightedTile;
  a.selectChallengeTile = (id, tile) => {
    const board = a.doc.widgets.find((w) => w.id === id);
    if (!board) return;
    selected.set(board, tile);
    a.selection.clear();
    a.selection.add(id);
    a.showSelection();
    a.showInspectorSection("content", false);
    a.draw();
    host.querySelector("#selectedChallengeTile")?.scrollIntoView({ block: "center" });
  };
  a.renderTileSelection = () => {
    const board = a.selection.size === 1 && a.selected()[0];
    const tile =
      board?.type === "challenge-board" &&
      Math.min(selected.get(board) || 1, OverlayGameRules.challengeCount(board));
    const next =
      !a.previewing && tile
        ? a
            .$("canvas")
            .querySelector(
              '[data-widget-id="' +
                CSS.escape(board.id) +
                '"] [data-challenge-tile="' +
                tile +
                '"]',
            )
        : null;
    if (highlightedTile === next) return;
    highlightedTile?.classList.remove("selectedChallengeTile");
    next?.classList.add("selectedChallengeTile");
    highlightedTile = next;
  };
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
  function section(title, start) {
    const block = el("section");
    block.className = "boardSettings";
    block.append(el("h3", title), ...Array.from(host.children).slice(start));
    host.append(block);
  }
  const { style, hideLabel, labelPosition } = OverlayBoardStyle(
    a,
    { host, num, select, field },
    { group, details, el, labeled },
  );
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
    input.value = Math.min(selected.get(w) || 1, count);
    const condition = labeled("Mark as", el("select"));
    condition.add(new Option("Toggle completion", ""));
    for (const item of OverlayGameRules.conditions(w))
      condition.add(new Option(item.name, item.id));
    const apply = button("Toggle square", () => {
      if (input.reportValidity())
        return run(condition.value ? "condition" : "mark", {
          cell: Number(input.value),
          ...(condition.value ? { condition: condition.value } : {}),
        });
    });
    condition.onchange = () => {
      apply.textContent = condition.value ? "Set condition" : "Toggle square";
    };
  }
  function bingo(w, run, setupStart) {
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
    section("Board setup", setupStart);
    const squaresStart = host.children.length;
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
          visibility = el("button"),
          mark = el("button", "✓");
        cell.value = i === center ? "FREE" : w.items[i] || "";
        cell.disabled = i === center;
        cell.placeholder = "Square " + (i + 1);
        cell.maxLength = 200;
        cell.setAttribute("aria-label", "Bingo text " + (i + 1));
        const updateVisibility = () => {
          const hidden = Boolean(w.boardHiddenLabels[i]);
          visibility.textContent = hidden ? "Show" : "Hide";
          visibility.setAttribute(
            "aria-label",
            (hidden ? "Show" : "Hide") + " label for square " + (i + 1),
          );
        };
        cell.onchange = () => {
          a.change(() => {
            while (w.items.length <= i) w.items.push("");
            w.items[i] = cell.value;
            if (!cell.value.trim()) w.boardHiddenLabels[i] = true;
          }, false);
          updateVisibility();
        };
        pick.type = "button";
        pick.setAttribute("aria-label", "Image for square " + (i + 1));
        pick.onclick = () => openImage(i + 1, true);
        visibility.type = "button";
        visibility.disabled = i === center;
        visibility.onclick = () => {
          a.change(() => {
            if (w.boardHiddenLabels[i]) delete w.boardHiddenLabels[i];
            else w.boardHiddenLabels[i] = true;
          }, false);
          updateVisibility();
        };
        updateVisibility();
        mark.type = "button";
        mark.disabled = i === center;
        mark.title = "Toggle square " + (i + 1);
        mark.setAttribute("aria-label", mark.title);
        mark.onclick = () =>
          void run("mark", { cell: i + 1 }).catch((error) => a.notice(error.message));
        line.append(cell, pick, visibility, mark);
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
      labelPosition(picker, "Square label position", w.boardLabelPositions[index], (value) => {
        if (value) w.boardLabelPositions[index] = value;
        else delete w.boardLabelPositions[index];
      });
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
        for (const [i, value] of values.entries()) if (!value.trim()) w.boardHiddenLabels[i] = true;
      }, false);
      labels();
    };
    bulk.append(apply);
    section("Edit squares", squaresStart);
  }
  function numberInput(parent, name, value, min, max, step = 1) {
    const input = labeled(name, el("input"), parent);
    Object.assign(input, { type: "number", min, max, step, required: true, value });
    return input;
  }
  function challenge(w, setupStart) {
    const grid = w.challengeLayout === "grid";
    const count = OverlayGameRules.challengeCount(w);
    const active = Math.min(selected.get(w) || 1, count);
    const tile = w.tiles[active - 1];
    const layout = labeled("Tile layout", el("select"));
    layout.add(new Option("Grid", "grid"));
    layout.add(new Option("Freeform", "freeform"));
    layout.value = w.challengeLayout;
    function setGrid(columns, rows) {
      w.challengeLayout = "grid";
      w.gridSize = columns;
      w.gridRows = rows;
      OverlayModel.fillChallengeGrid(w, GrobyRandomId);
    }
    layout.onchange = () => {
      a.change(() => {
        if (layout.value === "grid") setGrid(w.gridSize, w.gridRows);
        else w.challengeLayout = "freeform";
      });
      host.querySelector('[aria-label="Tile layout"]').focus();
    };
    if (grid) {
      const fields = el("div");
      fields.className = "tileGeometry";
      host.append(fields);
      const columns = numberInput(fields, "Tiles per row", w.gridSize, 1, OverlayModel.boardLimit);
      const rows = numberInput(fields, "Rows", w.gridRows, 1, OverlayModel.boardLimit);
      button("Apply grid size", () => {
        if (!columns.reportValidity() || !rows.reportValidity()) return;
        if (columns.valueAsNumber * rows.valueAsNumber > OverlayModel.boardLimit)
          throw Error("Use up to " + OverlayModel.boardLimit.toLocaleString() + " tiles.");
        if (columns.valueAsNumber === w.gridSize && rows.valueAsNumber === w.gridRows) return;
        selected.set(w, Math.min(active, columns.valueAsNumber * rows.valueAsNumber));
        a.change(() => setGrid(columns.valueAsNumber, rows.valueAsNumber));
        host.querySelector('[aria-label="Tiles per row"]').focus();
      });
      if (w.tiles.length > count) {
        const extra = w.tiles.length - count;
        note(
          extra + (extra === 1 ? " tile is" : " tiles are") + " kept for when you expand the grid.",
        );
      }
    } else {
      const add = button("Add tile", () => {
        const index = w.tiles.length;
        const columns = Math.max(4, Math.ceil(Math.sqrt(index + 1)));
        selected.set(w, index + 1);
        a.change(() => {
          w.tiles.push({
            id: GrobyRandomId(),
            text: "",
            image: "",
            width: percent(90 / columns, 0.1),
            height: percent(90 / columns, 0.1),
            rotation: 0,
            x: percent((((index % columns) + 0.05) * 100) / columns),
            y: percent(((Math.floor(index / columns) + 0.05) * 100) / columns),
          });
        });
      });
      add.disabled = w.tiles.length >= OverlayModel.boardLimit;
    }
    section("Board setup", setupStart);
    const tilesStart = host.children.length;

    const visual = el("div");
    visual.className = "challengeEditor";
    visual.style.aspectRatio = w.width + " / " + w.height;
    if (grid) {
      const slots = Math.max(w.gridSize, (w.gridRows * w.width) / w.height);
      visual.style.minWidth = Math.min(12000, Math.ceil(36 * slots)) + "px";
    }
    const background = el("img");
    background.alt = "";
    background.style.objectFit = w.boardImageFit;
    setImage(background, w.boardImage);
    visual.append(background);
    const preview = el("div");
    preview.className = "challengePreview";
    preview.append(visual);
    if (tile) host.append(el("p", "Click a tile on the canvas to edit it."));
    host.append(preview);
    const shown = w.tiles.slice(0, count);
    const title = (item, index) => item.text || "Tile " + (index + 1);
    function position(node, item, index) {
      const { x, y, width, height, rotation } = OverlayGameRules.challengeGeometry(w, item, index);
      Object.assign(node.style, {
        left: x + "%",
        top: y + "%",
        width: width + "%",
        height: height + "%",
        transform: "rotate(" + rotation + "deg)",
      });
    }
    function choose(index, focusTile) {
      selected.set(w, index + 1);
      a.draw();
      host
        .querySelector(
          focusTile ? '.challengeEditor [aria-pressed="true"]' : '[aria-label="Selected tile"]',
        )
        .focus();
    }
    const nodes = shown.map((item, index) => {
      const node = el("button");
      const image = el("img");
      const caption = el("span", title(item, index));
      caption.className = "challengeCaption";
      image.alt = "";
      image.style.objectFit = w.cellImageFit;
      setImage(image, item.image);
      node.append(image, caption);
      node.type = "button";
      node.title = caption.textContent;
      node.setAttribute("aria-pressed", String(item === tile));
      if (item === tile) {
        const grip = el("span");
        grip.className = "challengeResize";
        grip.setAttribute("aria-hidden", "true");
        node.append(grip);
      }
      position(node, item, index);
      visual.append(node);
      node.onclick = () => {
        if (item !== tile) choose(index, true);
      };
      node.onpointerdown = (event) => {
        const resizing = event.target.classList.contains("challengeResize");
        if (event.button !== 0 || (grid && !resizing)) return;
        const bounds = visual.getBoundingClientRect();
        const angle = (item.rotation * Math.PI) / 180;
        let change;
        node.setPointerCapture(event.pointerId);
        node.onpointermove = (move) => {
          if (move.pointerId !== event.pointerId) return;
          const dx = move.clientX - event.clientX;
          const dy = move.clientY - event.clientY;
          if (!change && Math.hypot(dx, dy) < 3) return;
          if (grid) {
            change = {
              gridWidth: percent(
                (item.gridWidth ?? w.challengeTileWidth) + (200 * dx * w.gridSize) / bounds.width,
                1,
              ),
              gridHeight: percent(
                (item.gridHeight ?? w.challengeTileHeight) +
                  (200 * dy * w.gridRows) / bounds.height,
                1,
              ),
            };
          } else if (resizing) {
            change = {
              width: percent(
                item.width + (100 * (dx * Math.cos(angle) + dy * Math.sin(angle))) / bounds.width,
                0.1,
              ),
              height: percent(
                item.height + (100 * (dy * Math.cos(angle) - dx * Math.sin(angle))) / bounds.height,
                0.1,
              ),
            };
          } else {
            change = {
              x: percent(item.x + (100 * dx) / bounds.width),
              y: percent(item.y + (100 * dy) / bounds.height),
            };
          }
          position(node, { ...item, ...change }, index);
        };
        node.onpointerup = (up) => {
          if (up.pointerId !== event.pointerId) return;
          node.onpointermove = null;
          if (!change) return;
          if (item === tile) {
            a.change(() => Object.assign(item, change), false);
            updateSizeFields();
          } else {
            selected.set(w, index + 1);
            a.change(() => Object.assign(item, change));
          }
        };
        node.onpointercancel = () => {
          node.onpointermove = null;
          position(node, item, index);
        };
      };
      return node;
    });
    visual.classList.toggle("gridLayout", grid);
    if (!tile) {
      note("Add a tile to start building your board.");
      section("Edit tiles", tilesStart);
      return background;
    }

    const node = nodes[active - 1];
    const tiles = labeled("Selected tile", el("select"));
    tiles.id = "selectedChallengeTile";
    shown.forEach((item, index) => tiles.add(new Option(title(item, index), index + 1)));
    tiles.value = active;
    tiles.onchange = () => choose(tiles.selectedIndex, false);
    const name = labeled("Tile label", el("input"));
    name.maxLength = 200;
    name.value = tile.text;
    name.placeholder = "Tile " + active;
    const hidden = hideLabel(host, tile);
    labelPosition(host, "Selected tile label position", tile.labelPosition, (value) => {
      if (value) tile.labelPosition = value;
      else delete tile.labelPosition;
    });
    const border = labeled("Hide border on this tile", el("input"));
    border.type = "checkbox";
    border.checked = tile.borderHidden === true;
    border.parentElement.className = "check";
    border.onchange = () =>
      a.change(() => {
        if (border.checked) tile.borderHidden = true;
        else delete tile.borderHidden;
      }, false);
    name.onchange = () => {
      a.change(() => {
        tile.text = name.value;
        if (!name.value.trim()) tile.labelHidden = true;
      }, false);
      hidden.checked = tile.labelHidden === true;
      const label = title(tile, active - 1);
      tiles.options[active - 1].text =
        node.title =
        node.querySelector(".challengeCaption").textContent =
          label;
    };
    imageControl(
      host,
      w,
      "Tile image",
      () => tile.image,
      (url) => {
        tile.image = url;
        setImage(node.querySelector("img"), url);
      },
    );

    const sizes = el("div");
    sizes.className = "tileGeometry";
    host.append(sizes);
    const widthKey = grid ? "gridWidth" : "width";
    const heightKey = grid ? "gridHeight" : "height";
    const width = () => tile[widthKey] ?? w.challengeTileWidth;
    const height = () => tile[heightKey] ?? w.challengeTileHeight;
    const suffix = grid ? " (% of slot)" : " (%)";
    const min = grid ? 1 : 0.1;
    const tileWidth = numberInput(sizes, "Width" + suffix, width(), min, 100, 0.1);
    const tileHeight = numberInput(sizes, "Height" + suffix, height(), min, 100, 0.1);
    function updateSizeFields() {
      tileWidth.value = width();
      tileHeight.value = height();
      for (const [key, input] of placement) input.value = tile[key];
    }
    const placement = [];
    function edit(input, key) {
      input.onchange = () => {
        if (!input.reportValidity()) return;
        a.change(() => {
          tile[key] = input.valueAsNumber;
        }, false);
        position(node, tile, active - 1);
      };
    }
    edit(tileWidth, widthKey);
    edit(tileHeight, heightKey);
    button("Apply this size to all tiles", () => {
      if (!tileWidth.reportValidity() || !tileHeight.reportValidity()) return;
      const nextWidth = tileWidth.valueAsNumber;
      const nextHeight = tileHeight.valueAsNumber;
      a.change(() => {
        if (grid) {
          w.challengeTileWidth = nextWidth;
          w.challengeTileHeight = nextHeight;
          for (const item of w.tiles) {
            delete item.gridWidth;
            delete item.gridHeight;
          }
        } else {
          for (const item of shown) {
            item.width = nextWidth;
            item.height = nextHeight;
          }
        }
      }, false);
      shown.forEach((item, index) => position(nodes[index], item, index));
      a.notice("Tile size applied to all tiles.");
    });
    if (!grid) {
      const options = details("Tile placement");
      options.className = "boardSettings";
      const geometry = el("div");
      geometry.className = "tileGeometry";
      options.append(geometry);
      for (const [key, label, min, max] of [
        ["x", "Left (%)", 0, 100],
        ["y", "Top (%)", 0, 100],
        ["rotation", "Rotation (\u00b0)", -360, 360],
      ]) {
        const input = numberInput(geometry, label, tile[key], min, max, 0.1);
        placement.push([key, input]);
        edit(input, key);
      }
      button("Remove selected tile", () => a.change(() => w.tiles.splice(active - 1, 1)));
    }
    note(
      grid
        ? "Drag the selected tile’s corner to resize it."
        : "Drag tiles to move them. Drag the selected tile’s corner to resize it.",
    );
    section("Edit tiles", tilesStart);
    return background;
  }
  function setImage(image, url) {
    image.hidden = !url;
    if (url) image.src = url;
    else image.removeAttribute("src");
  }
  function match(w, setupStart) {
    num("Columns", "matchColumns", 2, 12);
    num("Mismatch reveal time (seconds)", "matchRevealSeconds", 0.5, 10).step = 0.5;
    field("Tile back symbol", "matchBack", "text", { maxLength: 16 });
    check("Show matching progress", "matchProgress");
    section("Board setup", setupStart);
    const pairs = details("Edit pairs");
    pairs.open = true;
    for (const [index, pair] of w.matchPairs.entries()) {
      const entry = el("details");
      const summary = el("summary", pair.text || "Pair " + (index + 1));
      entry.append(summary);
      const name = labeled("Pair " + (index + 1) + " label", el("input"), entry);
      name.maxLength = 80;
      name.value = pair.text;
      name.placeholder = "Pair " + (index + 1);
      const hidden = hideLabel(entry, pair);
      labelPosition(
        entry,
        "Pair " + (index + 1) + " label position",
        pair.labelPosition,
        (value) => {
          if (value) pair.labelPosition = value;
          else delete pair.labelPosition;
        },
      );
      name.onchange = () => {
        a.change(() => {
          pair.text = name.value;
          if (!name.value.trim()) pair.labelHidden = true;
        }, false);
        hidden.checked = pair.labelHidden === true;
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
  }
  function matchPlay(w, run) {
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
  }
  function content(w, run, finish) {
    const setupStart = host.children.length;
    field("Board title", "label", "text", { maxLength: 100 });
    check("Show tile labels", "showCellLabels");
    let thumbnail;
    if (w.type === "challenge-board") thumbnail = challenge(w, setupStart);
    else if (w.type === "bingo") bingo(w, run, setupStart);
    else match(w, setupStart);
    const background = details("Board background image");
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
    group(
      "Play or test",
      () => {
        if (w.type === "tile-match") matchPlay(w, run);
        else
          play(
            w,
            run,
            w.type === "bingo"
              ? OverlayGameRules.bingoLayout(w).count
              : OverlayGameRules.challengeCount(w),
          );
        finish();
      },
      true,
    );
  }
  return {
    content,
    style,
  };
};
