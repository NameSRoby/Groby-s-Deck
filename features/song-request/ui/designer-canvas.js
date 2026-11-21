/**
 * Canvas geometry, selection, and direct manipulation.
 * Embedded after designer-controls.js: both share the editor configuration and
 * selection state. All measurements use overlay pixels, independent of zoom.
 */
/* exported setupCanvasControls, canvasSnap */
/* global setupLayerCrop, startCanvasGesture */
let selectedShapeId = "",
  canvasGesture = null,
  canvasSnap = true,
  canvasGuides = [],
  updatingCanvasInspector = false;
const bounded = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
/** Resize from an immutable baseline, never the previous pointer event. Otherwise
 * rounding errors accumulate and a drag out and back changes the original design.
 * Frames stretch along both axes; typography and decoration scale uniformly so
 * letters and circles retain their shapes. Container-only resizing is opt-in.
 */
function resizeCanvasTarget(target, next, baseline = structuredClone(target)) {
  if (target.lockSize) return;
  const before = baseline.frame;
  if (target.lockRatio) {
    const factor = Math.min(next.width / before.width, 960 / before.width, 600 / before.height);
    next.width = bounded(before.width * factor, 1, 960);
    next.height = bounded(before.height * factor, 1, 600);
  }
  Object.assign(target.frame, next);
  if (!target.blocks || target.scaleContents === false) return;
  const sx = next.width / before.width,
    sy = next.height / before.height;
  for (const block of target.blocks) {
    const original = baseline.blocks.find((b) => b.id === block.id);
    if (!original?.frame) continue;
    block.frame = {
      x: bounded(original.frame.x * sx, 0, 960),
      y: bounded(original.frame.y * sy, 0, 600),
      width: bounded(original.frame.width * sx, 1, 960),
      height: bounded(original.frame.height * sy, 1, 600),
    };
    block.contentScale = Math.max(
      0.05,
      Math.min(20, (original.contentScale || 1) * Math.min(sx, sy)),
    );
  }
  if (baseline.style?.radius != null)
    target.style.radius = bounded(baseline.style.radius * Math.min(sx, sy), 0, 48);
}
function canvasTarget() {
  const row = selectedPreviewPiece
    ? config.segments.find((s) => s.blocks.some((b) => b.id === selectedPreviewPiece))
    : config.segments.find((s) => s.id === selectedShapeId);
  return selectedPreviewPiece ? row?.blocks.find((b) => b.id === selectedPreviewPiece) : row;
}
function enableCanvas() {
  if (config.layoutMode === "canvas") return;
  const stage = $("preview"),
    ratio = stage.getBoundingClientRect().width / stage.offsetWidth;
  const origin = stage.getBoundingClientRect();
  for (const row of config.segments) {
    const el = [...stage.children].find((n) => n.dataset.segmentId === row.id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    row.frame = {
      x: bounded((r.left - origin.left) / ratio - stage.clientLeft, 0, 960),
      y: bounded((r.top - origin.top) / ratio - stage.clientTop, 0, 600),
      width: bounded(r.width / ratio, 1, 960),
      height: bounded(r.height / ratio, 1, 600),
    };
    row.shape = "rounded";
    for (const b of row.blocks) {
      const n = [...el.children].find((n) => n.dataset.blockId === b.id);
      if (!n) continue;
      const br = n.getBoundingClientRect();
      b.frame = {
        x: bounded((br.left - r.left) / ratio - el.clientLeft, 0, 960),
        y: bounded((br.top - r.top) / ratio - el.clientTop, 0, 600),
        width: bounded(br.width / ratio, 1, 960),
        height: bounded(br.height / ratio, 1, 600),
      };
    }
  }
  config.height = bounded(stage.offsetHeight, 32, 600);
  config.autoHeight = false;
  config.layoutMode = "canvas";
  changed(true);
  status(
    "Canvas editing enabled. Drag objects to move; use corner handles to resize. Save overlay to apply.",
  );
}
function setupCanvasControls() {
  const toolbar = node("div", "canvas-toolbar");
  toolbar.id = "canvas-toolbar";
  const edit = node("button", "", "Edit on canvas");
  edit.id = "edit-canvas";
  edit.onclick = enableCanvas;
  const width = node("input"),
    height = node("input");
  for (const [input, key, min, max] of [
    [width, "width", 240, 960],
    [height, "height", 32, 600],
  ]) {
    input.type = "number";
    input.id = "canvas-" + key;
    input.min = min;
    input.max = max;
    input.onchange = () => {
      if (!input.reportValidity()) return;
      enableCanvas();
      config[key] = Number(input.value);
      config.autoHeight = false;
      changed(true);
    };
  }
  const trim = node("button", "", "Fit to objects");
  trim.onclick = () => {
    enableCanvas();
    config.width = bounded(
      Math.max(
        ...config.segments
          .filter((s) => s.enabled)
          .map((s) => (s.frame?.x || 0) + (s.frame?.width || 0)),
      ) +
        config.borderWidth * 2,
      240,
      960,
    );
    config.height = bounded(
      Math.max(
        ...config.segments
          .filter((s) => s.enabled)
          .map((s) => (s.frame?.y || 0) + (s.frame?.height || 0)),
      ) +
        config.borderWidth * 2,
      32,
      600,
    );
    changed(true);
  };
  const shape = select(
    [
      "rectangle",
      "rounded",
      "ellipse",
      "triangle",
      "diamond",
      "hexagon",
      "chevron",
      "parallelogram",
      "star",
    ],
    "rounded",
    () => {},
  );
  shape.id = "new-shape";
  shape.setAttribute("aria-label", "New shape");
  const add = node("button", "", "Add shape");
  add.id = "add-shape";
  add.onclick = () => {
    if (config.segments.length >= 8) return status("Eight shape limit reached");
    enableCanvas();
    const row = {
      id: "shape-" + Date.now().toString(36),
      name: "Shape " + (config.segments.length + 1),
      enabled: true,
      direction: "column",
      align: "left",
      size: "wide",
      shape: shape.value,
      frame: {
        x: 12,
        y: 12,
        width: Math.min(180, config.width - 24),
        height: Math.min(80, config.height - 24),
      },
      style: {
        surface: config.surface,
        accent: "",
        opacity: config.opacity,
        padding: 0,
        radius: 16,
        accentWidth: 0,
      },
      blocks: [],
    };
    config.segments.push(row);
    selectedShapeId = row.id;
    selectedPreviewPiece = "";
    changed(true);
  };
  const snap = node("input");
  snap.type = "checkbox";
  snap.id = "canvas-snap";
  snap.checked = true;
  snap.onchange = () => (canvasSnap = snap.checked);
  const snapLabel = node("label", "switchLabel");
  snapLabel.append(snap, node("span", "", "Snap to guides"));
  const grid = node("input");
  grid.type = "checkbox";
  grid.id = "canvas-grid";
  grid.checked = true;
  grid.onchange = () => updateCanvasInspector();
  const gridLabel = node("label", "switchLabel");
  gridLabel.title =
    "Show the 24 px grid and shape labels while editing. These do not appear in OBS.";
  gridLabel.append(grid, node("span", "", "Grid & labels"));
  toolbar.append(
    edit,
    labeled("Width", width),
    labeled("Height", height),
    trim,
    shape,
    add,
    snapLabel,
    gridLabel,
  );
  document.querySelector(".preview-footer").after(toolbar);
  const help = node(
    "p",
    "canvas-help",
    "Drag to move; corners resize freely, side handles resize one axis. Shift keeps proportions. Alt+handle crops; C opens crop controls. Arrows nudge 1px, Shift moves 10px. Alt bypasses guides; Esc cancels a drag. Ctrl+D duplicates, Ctrl+Z undoes, Ctrl+Shift+Z redoes. Measurements use overlay pixels.",
  );
  toolbar.after(help);
  const library = node("section", "canvas-library");
  library.id = "canvas-library";
  document.querySelector(".content-panel").append(library);
  const info = select(KINDS, "title", () => {});
  info.id = "new-information";
  info.setAttribute("aria-label", "Information to add");
  for (const option of info.options) option.textContent = NAMES[option.value];
  const addInfo = node("button", "", "Add information");
  addInfo.id = "canvas-add-information";
  addInfo.onclick = () => {
    enableCanvas();
    const row = config.segments.find((s) => s.id === selectedShapeId) || config.segments[0];
    addBlock(info.value, config.segments.indexOf(row));
    const b = row.blocks.at(-1);
    selectedPreviewPiece = b.id;
    selectedShapeId = row.id;
    changed(true);
  };
  toolbar.append(info, addInfo);
  const inspector = node("section", "canvas-inspector");
  inspector.id = "canvas-inspector";
  inspector.hidden = true;
  document.querySelector(".left").append(inspector);
  const paletteClick = (event) => {
    const piece = event.target.closest(".piece");
    if (!piece || config.layoutMode !== "canvas") return;
    event.stopImmediatePropagation();
    const kind = KINDS.find((k) => NAMES[k] === piece.querySelector(".piece-name")?.textContent);
    if (!kind) return;
    const row = config.segments.find((s) => s.id === selectedShapeId) || config.segments[0];
    addBlock(kind, config.segments.indexOf(row));
    const block = row.blocks.at(-1);
    block.frame = {
      x: 8,
      y: 8,
      width: Math.max(1, Math.min(160, (row.frame?.width || 180) - 16)),
      height: kind === "progress" ? 7 : kind === "artwork" ? 60 : 28,
    };
    selectedPreviewPiece = block.id;
    selectedShapeId = row.id;
    changed(true);
  };
  $("palette").addEventListener("click", paletteClick, true);
  const addSection = $("addSegment").onclick;
  $("addSegment").onclick = () => {
    if (config.layoutMode === "canvas") add.click();
    else addSection();
  };
  $("preview").onpointerdown = startCanvasGesture;
  $("preview").onclick = (event) => {
    if (canvasGesture) return;
    const label = event.target.closest("[data-select-segment]");
    if (label) {
      selectedShapeId = label.dataset.selectSegment;
      selectedPreviewPiece = "";
      enableCanvas();
      updatePieceInspector();
      return;
    }
    const b = event.target.closest("[data-block-id]"),
      s = event.target.closest("[data-segment-id]");
    if (event.target.closest(".canvas-selection")) return;
    selectedPreviewPiece = b?.dataset.blockId || "";
    selectedShapeId = s?.dataset.segmentId || "";
    updatePieceInspector();
  };
  $("preview").onkeydown = (event) => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.target.click();
      return;
    }
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    const target = canvasTarget();
    if (!delta || !target?.frame || config.layoutMode !== "canvas") return;
    event.preventDefault();
    target.frame.x = bounded(target.frame.x + delta[0] * (event.shiftKey ? 10 : 1), 0, 960);
    target.frame.y = bounded(target.frame.y + delta[1] * (event.shiftKey ? 10 : 1), 0, 600);
    changed();
    focusCanvasTarget();
  };
}
function updateCanvasInspector() {
  if (updatingCanvasInspector) return;
  const refocus = rememberSelectionFocus();
  updatingCanvasInspector = true;
  try {
    if (!$("canvas-toolbar")) return;
    document.body.dataset.canvasEditing = String(config.layoutMode === "canvas");
    const library = $("canvas-library");
    const objectScroll = library.scrollTop;
    library.replaceChildren(node("h3", "", "Layers - front to back"));
    for (const row of [...config.segments].reverse()) {
      const selectObject = (text, id) => {
        const button = node("button", "canvas-object", text);
        button.type = "button";
        button.dataset.objectHidden = String(!row.enabled);
        button.setAttribute(
          "aria-pressed",
          String(
            id ? selectedPreviewPiece === id : !selectedPreviewPiece && selectedShapeId === row.id,
          ),
        );
        button.onclick = () => {
          selectedShapeId = row.id;
          selectedPreviewPiece = id || "";
          updatePieceInspector();
          library.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
        };
        return button;
      };
      const shapeButton = selectObject(row.name || "Shape");
      shapeButton.dataset.objectShape = row.id;
      library.append(shapeButton);
      for (const b of [...row.blocks].reverse()) {
        const button = selectObject(NAMES[b.kind], b.id);
        button.dataset.objectPiece = b.id;
        button.classList.add("canvas-object-child");
        library.append(button);
      }
    }
    library.scrollTop = objectScroll;
    for (const key of ["width", "height"])
      if (document.activeElement !== $("canvas-" + key)) $("canvas-" + key).value = config[key];
    $("edit-canvas").textContent =
      config.layoutMode === "canvas" ? "Canvas editing active" : "Edit on canvas";
    $("edit-canvas").disabled = config.layoutMode === "canvas";
    $("preview")
      .querySelectorAll(".canvas-selection,.canvas-guide,.canvas-segment-label,.canvas-grid")
      .forEach((n) => n.remove());
    if ($("canvas-grid").checked) {
      if (config.layoutMode === "canvas") $("preview").append(node("div", "canvas-grid"));
      const stage = $("preview"),
        origin = stage.getBoundingClientRect(),
        scale = origin.width / stage.offsetWidth;
      for (const row of config.segments.filter((s) => s.enabled)) {
        const element = [...stage.children].find((n) => n.dataset.segmentId === row.id);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        const label = node("button", "canvas-segment-label", row.name || "Segment");
        label.type = "button";
        label.dataset.selectSegment = row.id;
        label.setAttribute("aria-label", "Select segment " + row.name);
        label.style.left = (rect.left - origin.left) / scale + "px";
        label.style.top = Math.max(0, (rect.top - origin.top) / scale - 20) + "px";
        stage.append(label);
      }
    }
    const target = canvasTarget(),
      panel = $("canvas-inspector");
    panel.hidden = !target;
    if (!target) return;
    const row =
      config.segments.find((s) => s.id === selectedShapeId) ||
      config.segments.find((s) => s.blocks.includes(target));
    const title = node(
      "strong",
      "",
      selectedPreviewPiece ? NAMES[target.kind] : row.name || "Shape",
    );
    const done = node("button", "", "Deselect");
    done.onclick = () => {
      selectedPreviewPiece = "";
      selectedShapeId = "";
      updatePieceInspector();
    };
    const heading = node("div", "inspector-heading");
    heading.append(title, done);
    panel.replaceChildren(heading);
    addSelectionTools(panel, row);
    setupLayerCrop(panel, target);
    if (selectedPreviewPiece) {
      const parent = node("button", "", "Select segment");
      parent.id = "select-parent-segment";
      parent.onclick = () => {
        selectedShapeId = row.id;
        selectedPreviewPiece = "";
        enableCanvas();
        updatePieceInspector();
      };
      panel.append(parent);
    }
    if (config.layoutMode !== "canvas") {
      const edit = node("button", "", "Move and resize on canvas");
      edit.onclick = enableCanvas;
      panel.append(edit);
      return;
    }
    for (const el of $("preview").querySelectorAll("[data-segment-id]")) {
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute(
        "aria-label",
        "Select shape " + (config.segments.find((s) => s.id === el.dataset.segmentId)?.name || ""),
      );
    }
    const fields = node("div", "canvas-fields");
    for (const key of ["x", "y", "width", "height"]) {
      const input = node("input");
      input.type = "number";
      input.min = ["width", "height"].includes(key) ? 1 : 0;
      input.max = ["x", "width"].includes(key) ? 960 : 600;
      input.value = target.frame?.[key] || 0;
      input.dataset.geometry = key;
      input.disabled = target.lockSize && ["width", "height"].includes(key);
      input.onchange = () => {
        if (!input.reportValidity() || target.frame[key] === Number(input.value)) return;
        if (["width", "height"].includes(key)) {
          const next = { ...target.frame, [key]: Number(input.value) };
          if (key === "height" && target.lockRatio)
            next.width = (next.height * target.frame.width) / target.frame.height;
          resizeCanvasTarget(target, next);
        } else target.frame[key] = Number(input.value);
        queueMicrotask(() => changed());
      };
      fields.append(labeled(key[0].toUpperCase() + key.slice(1), input));
    }
    panel.append(fields);
    const locks = node("div", "canvas-actions");
    for (const [key, label] of [
      ["lockSize", "Lock size"],
      ["lockRatio", "Lock aspect ratio"],
      ...(!selectedPreviewPiece ? [["scaleContents", "Scale contents with segment"]] : []),
    ]) {
      const input = node("input");
      input.type = "checkbox";
      input.dataset.constraint = key;
      input.checked = key === "scaleContents" ? target[key] !== false : target[key] === true;
      input.onchange = () => {
        target[key] = input.checked;
        changed();
      };
      const control = node("label", "switchLabel");
      control.append(input, node("span", "", label));
      locks.append(control);
    }
    panel.append(locks);
    if (!selectedPreviewPiece) {
      const shape = select(
        [
          "rectangle",
          "rounded",
          "ellipse",
          "triangle",
          "diamond",
          "hexagon",
          "chevron",
          "parallelogram",
          "star",
        ],
        row.shape || "rectangle",
        (v) => {
          row.shape = v;
          changed();
        },
      );
      panel.append(labeled("Shape", shape));
      const tray = formatSegment(row);
      tray.hidden = false;
      panel.append(tray);
    }
    const alignment = node("div", "canvas-actions");
    alignment.setAttribute("aria-label", "Align selected object");
    for (const [label, axis, edge] of [
      ["Align left", "x", 0],
      ["Center horizontally", "x", 0.5],
      ["Align right", "x", 1],
      ["Align top", "y", 0],
      ["Center vertically", "y", 0.5],
      ["Align bottom", "y", 1],
    ]) {
      const button = node("button", "", label);
      button.onclick = () => {
        const limit = selectedPreviewPiece ? row.frame : config,
          size = axis === "x" ? "width" : "height";
        target.frame[axis] = bounded(
          (limit[size] - target.frame[size]) * edge,
          0,
          axis === "x" ? 960 : 600,
        );
        changed();
      };
      alignment.append(button);
    }
    panel.append(alignment);
    if (selectedPreviewPiece) {
      const text = select(["left", "center", "right"], target.style?.align || "left", (value) => {
        blockStyle(target).align = value;
        changed();
      });
      panel.append(labeled("Text alignment", text));
    }
    const actions = node("div", "canvas-actions");
    const layer = (label, delta) => {
      const button = node("button", "", label);
      button.onclick = () => {
        const list = selectedPreviewPiece ? row.blocks : config.segments,
          index = list.indexOf(target),
          next = bounded(index + delta, 0, list.length - 1);
        list.splice(index, 1);
        list.splice(next, 0, target);
        changed(true);
      };
      return button;
    };
    const remove = node("button", "", "Delete selected");
    remove.id = "canvas-delete";
    remove.onclick = () => {
      if (selectedPreviewPiece) row.blocks = row.blocks.filter((b) => b !== target);
      else {
        if (config.segments.length === 1) return status("Keep at least one shape.");
        config.segments = config.segments.filter((s) => s !== target);
      }
      selectedPreviewPiece = "";
      selectedShapeId = "";
      changed(true);
    };
    actions.append(layer("Send backward", -1), layer("Bring forward", 1), remove);
    panel.append(actions);
    if (selectedPreviewPiece) {
      const move = select(
        config.segments.map((s) => s.id),
        row.id,
        (id) => {
          const next = config.segments.find((s) => s.id === id);
          row.blocks = row.blocks.filter((b) => b !== target);
          next.blocks.push(target);
          selectedShapeId = next.id;
          target.frame.x = 0;
          target.frame.y = 0;
          changed(true);
        },
      );
      for (const option of move.options)
        option.textContent = config.segments.find((s) => s.id === option.value).name;
      panel.append(labeled("Move to shape", move));
    }
    $("preview").querySelector(".canvas-selection")?.remove();
    const el = selectedPreviewPiece
      ? [...$("preview").querySelectorAll("[data-block-id]")].find(
          (n) => n.dataset.blockId === selectedPreviewPiece,
        )
      : [...$("preview").children].find((n) => n.dataset.segmentId === row.id);
    if (!el) return;
    const frame = target.frame,
      overlay = node("div", "canvas-selection");
    const x =
        frame.x + (selectedPreviewPiece ? (row.frame?.x || 0) + el.parentElement.clientLeft : 0),
      y = frame.y + (selectedPreviewPiece ? (row.frame?.y || 0) + el.parentElement.clientTop : 0);
    Object.assign(overlay.style, {
      left: x + "px",
      top: y + "px",
      width: frame.width + "px",
      height: frame.height + "px",
    });
    const measurement = node(
      "span",
      "canvas-measurement",
      `${frame.width} × ${frame.height} px · X ${frame.x} · Y ${frame.y}`,
    );
    overlay.append(measurement);
    for (const corner of target.lockSize ? [] : ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const handle = node("span", "canvas-handle " + corner);
      handle.dataset.corner = corner;
      overlay.append(handle);
    }
    $("preview").append(overlay);
    for (const guide of canvasGuides) {
      const line = node("div", "canvas-guide " + guide.axis);
      Object.assign(
        line.style,
        guide.axis === "x"
          ? {
              left: guide.value + "px",
              top: guide.start + "px",
              height: guide.length + "px",
            }
          : {
              top: guide.value + "px",
              left: guide.start + "px",
              width: guide.length + "px",
            },
      );
      $("preview").append(line);
    }
  } finally {
    updatingCanvasInspector = false;
    refocus();
  }
}
function focusCanvasTarget() {
  const selector = selectedPreviewPiece ? "[data-block-id]" : "[data-segment-id]",
    id = selectedPreviewPiece || selectedShapeId;
  [...$("preview").querySelectorAll(selector)]
    .find((el) => (el.dataset.blockId || el.dataset.segmentId) === id)
    ?.focus({ preventScroll: true });
}
