/** Editor drafts and sample events are local; Save is the only live document write. */
/* global OverlayModel, OverlayRenderer, OverlayGameRules, setupOverlayInspector, setupOverlayInteractions, setupOverlayViewport, setupOverlayCommands, setupOverlayLivePreview, setupOverlayGameChatSettings */
(() => {
  const $ = (id) => document.getElementById(id),
    selection = new Set();
  let documents = [],
    revision = 0,
    saved = "",
    undo = [],
    redo = [],
    zoom = 1,
    previewing = false,
    drawing = false,
    redrawNeeded = false;
  let doc = OverlayModel.document(),
    catalog = [],
    catalogReady = false,
    feed;
  const serial = () => JSON.stringify(doc),
    dirty = () => serial() !== saved;
  const a = {
    $,
    selection,
    catalog,
    motionReady: false,
    livePreviewReady: false,
    previewing,
    doc,
    savedWidget: (id) =>
      documents.find((row) => row.id === doc.id)?.widgets.find((w) => w.id === id),
    revision: () => revision,
    selected: () => doc.widgets.filter((w) => selection.has(w.id)),
    showSelection: () => showSettings("widget"),
    notice: (message) => {
      $("notice").textContent = message;
      $("notice").title = message;
    },
    request,
    draw,
    renderContent,
    renderSelection,
    change,
    checkpoint,
    cancelCheckpoint: (previousRedo) => {
      undo.pop();
      redo = previousRedo;
    },
    history,
    select,
    scale: () => zoom,
    testWidget: (w) => feed.open(w),
  };
  const inspector = setupOverlayInspector(a);
  setupOverlayGameChatSettings(a);
  document.addEventListener("overlay-media-error", (event) => a.notice(event.detail));
  const commands = setupOverlayCommands(a);
  a.commands = commands;
  a.showInspectorSection = (name) => inspector.show(name);
  function checkpoint() {
    const previousRedo = redo;
    undo.push(JSON.stringify({ document: doc, selection: [...selection] }));
    redo = [];
    while (undo.length > 30 || undo.reduce((n, row) => n + row.length, 0) > 2000000) undo.shift();
    return previousRedo;
  }
  function change(fn, fields = true) {
    checkpoint();
    fn();
    for (const row of doc.widgets) {
      row.width = Math.max(20, Math.min(doc.width, row.width));
      row.height = Math.max(20, Math.min(doc.height, row.height));
      row.x = Math.max(0, Math.min(doc.width - row.width, row.x));
      row.y = Math.max(0, Math.min(doc.height - row.height, row.y));
    }
    draw(fields);
  }
  function history(direction) {
    const source = direction < 0 ? undo : redo,
      target = direction < 0 ? redo : undo;
    if (!source.length) return;
    target.push(JSON.stringify({ document: doc, selection: [...selection] }));
    const restored = JSON.parse(source.pop());
    doc = restored.document;
    a.doc = doc;
    selection.clear();
    restored.selection.forEach((id) => {
      if (doc.widgets.some((row) => row.id === id)) selection.add(id);
    });
    syncCanvasFields();
    draw();
  }
  function select(id, add = false) {
    if (!add) selection.clear();
    const w = doc.widgets.find((row) => row.id === id);
    const ids =
      !add && w?.group
        ? doc.widgets.filter((row) => row.group === w.group).map((row) => row.id)
        : [id];
    for (const key of ids)
      if (add && selection.has(key)) selection.delete(key);
      else selection.add(key);
    showSettings("widget");
    draw();
  }
  async function request(path = "", method = "GET", body, headers = {}) {
    const response = await fetch("/api/stream-overlays" + path, {
      method,
      cache: "no-store",
      headers: body instanceof File ? headers : { "Content-Type": "application/json", ...headers },
      ...(body !== undefined ? { body: body instanceof File ? body : JSON.stringify(body) } : {}),
    });
    if (response.status === 404)
      throw Error(
        "Restart Groby’s Deck to load the new overlay designer service. Your draft is still here.",
      );
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error || "Could not complete this request.");
    return result;
  }
  function fit() {
    const wrap = $("stageWrap"),
      value = $("zoom").value;
    zoom =
      previewing || value === "fit"
        ? Math.min((wrap.clientWidth - 32) / doc.width, (wrap.clientHeight - 32) / doc.height, 1)
        : Number(value);
    zoom = Math.max(0.03, zoom);
    $("stageFrame").style.width = doc.width * zoom + "px";
    $("stageFrame").style.height = doc.height * zoom + "px";
    $("canvas").style.transform = "scale(" + zoom + ")";
  }
  function drawLayers() {
    const oldRows = new Map([...$("layers").children].map((row) => [row.dataset.layerId, row]));
    const keep = new Set();
    let position = $("layers").firstElementChild;
    $("emptyLayers").hidden = doc.widgets.length > 0;
    for (const w of [...doc.widgets].reverse()) {
      const row = oldRows.get(w.id) || document.createElement("div");
      row.dataset.layerId = w.id;
      keep.add(w.id);
      row.className = "layerRow" + (selection.has(w.id) ? " selected" : "");
      const name = row.querySelector(".layerName") || document.createElement("button");
      name.className = "layerName";
      name.textContent = w.name;
      name.title = w.name;
      name.onclick = (event) => select(w.id, event.shiftKey || event.ctrlKey || event.metaKey);
      name.ondblclick = () => commands.rename(w.id);
      name.title = "Select " + w.name + ". Double-click to rename.";
      name.draggable = true;
      name.ondragstart = (event) => {
        event.dataTransfer.setData("application/x-groby-deck-layer", w.id);
        event.dataTransfer.effectAllowed = "move";
      };
      row.ondragover = (event) => {
        if (event.dataTransfer.types.includes("application/x-groby-deck-layer")) {
          event.preventDefault();
          row.classList.add("dropTarget");
        }
      };
      row.ondragleave = () => row.classList.remove("dropTarget");
      row.ondrop = (event) => {
        event.preventDefault();
        row.classList.remove("dropTarget");
        const id = event.dataTransfer.getData("application/x-groby-deck-layer");
        if (id)
          commands.move(
            id,
            w.id,
            event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2,
          );
      };
      if (!name.parentElement) row.append(name);
      for (const [key, on, off] of [
        ["visible", "◉", "○"],
        ["locked", "▣", "◇"],
      ]) {
        const button =
          row.querySelector('[data-control="' + key + '"]') || document.createElement("button");
        button.dataset.control = key;
        button.textContent = w[key] ? on : off;
        button.setAttribute(
          "aria-label",
          (key === "visible" ? (w.visible ? "Hide " : "Show ") : w.locked ? "Unlock " : "Lock ") +
            w.name,
        );
        button.setAttribute("aria-pressed", String(w[key]));
        button.onclick = () =>
          change(() => {
            w[key] = !w[key];
          });
        if (!button.parentElement) row.append(button);
      }
      const remove =
        row.querySelector('[data-control="delete"]') || document.createElement("button");
      remove.dataset.control = "delete";
      remove.textContent = "X";
      remove.setAttribute("aria-label", "Delete widget " + w.name);
      remove.title = w.locked
        ? "Unlock this widget before deleting it"
        : "Delete this widget. Undo restores it.";
      remove.disabled = w.locked;
      remove.onclick = () => commands.remove([w.id]);
      if (!remove.parentElement) row.append(remove);
      const query = $("layerSearch").value.trim().toLowerCase();
      row.hidden = !!query && !(w.name + " " + w.type).toLowerCase().includes(query);
      if (row === position) position = position.nextElementSibling;
      else $("layers").insertBefore(row, position);
    }
    for (const [id, row] of oldRows) if (!keep.has(id)) row.remove();
  }
  function draw(fields = true) {
    if (drawing) {
      redrawNeeded = true;
      return;
    }
    drawing = true;
    try {
      renderDraft(fields);
    } finally {
      drawing = false;
      if (redrawNeeded) {
        redrawNeeded = false;
        queueMicrotask(() => draw());
      }
    }
  }
  function renderContent() {
    OverlayRenderer.render($("canvas"), doc, feed?.data() || {}, {
      editor: !previewing,
      preview: true,
      audio: a.previewAudio === true,
    });
  }
  function renderSelection() {
    for (const layer of $("canvas").children) {
      const selected = selection.has(layer.dataset.widgetId);
      layer.classList.toggle("selected", selected);
      const resizable =
        selection.size === 1 && selected && layer.dataset.locked !== "true" && !previewing;
      const handles = layer.querySelectorAll(":scope > .resizeHandle");
      if (!resizable) handles.forEach((handle) => handle.remove());
      else if (!handles.length)
        for (const corner of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
          const handle = document.createElement("span");
          handle.className = "resizeHandle";
          handle.dataset.corner = corner;
          layer.append(handle);
        }
    }
  }
  function renderDraft(fields = true) {
    a.doc = doc;
    a.previewing = previewing;
    feed?.interestChanged();
    renderContent();
    $("canvas").classList.toggle("showGrid", $("grid").checked);
    renderSelection();
    $("canvasSize").textContent = doc.width + " × " + doc.height;
    $("saveState").textContent = !doc.id
      ? "New overlay - save to create its OBS link"
      : dirty()
        ? "Unsaved changes"
        : "Saved";
    $("undo").disabled = !undo.length;
    $("redo").disabled = !redo.length;
    const selected = a.selected();
    for (const id of ["duplicate", "remove", "front", "back", "ungroup"])
      $(id).disabled = !selected.length;
    $("group").disabled = selected.length < 2;
    $("deleteDocument").disabled = !doc.id;
    $("openOutput").disabled = !doc.id;
    $("openOutput").title = doc.id
      ? "Browser source URL and dimensions"
      : "Save this overlay first to create its OBS link";
    commands.sync();
    drawLayers();
    if (fields) inspector.draw();
    else if (selected.length === 1) $("selectedName").textContent = selected[0].name;
    fit();
  }
  function showSettings(name) {
    $("widgetSettings").hidden = name !== "widget" || !a.selected().length;
    if (name === "widget" && a.selected().length) {
      $("widgetInspector").open = true;
      document.body.classList.remove("hideLayers", "hideInspector");
      $("toggleLayers").setAttribute("aria-pressed", "true");
      $("toggleInspector").setAttribute("aria-pressed", "true");
    }
  }
  function syncCanvasFields() {
    $("documentName").value = doc.name;
    $("canvasWidth").value = doc.width;
    $("canvasHeight").value = doc.height;
    $("overlayMotion").value = doc.motion || "full";
    $("sizePreset").value =
      OverlayModel.presets.find((row) => row[1] === doc.width && row[2] === doc.height)?.[0] ||
      "custom";
  }
  function library() {
    const selected = doc.id;
    $("library").replaceChildren(
      new Option("New overlay", ""),
      ...documents.map((row) => new Option(row.name, row.id)),
    );
    $("library").value = selected;
    const list = $("savedOverlays");
    list.replaceChildren();
    for (const row of documents) {
      const button = document.createElement("button");
      button.textContent = row.name + " - " + row.width + " x " + row.height;
      button.setAttribute("aria-pressed", String(row.id === selected));
      button.onclick = () => load(row.id).catch((error) => a.notice(error.message));
      list.append(button);
    }
    $("savedEmpty").hidden = documents.length > 0;
  }
  async function confirm(title, text) {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmDialog").showModal();
    return new Promise((resolve) => {
      const close = (value) => {
        $("confirmDialog").close();
        resolve(value);
      };
      $("confirmYes").onclick = () => close(true);
      $("confirmNo").onclick = () => close(false);
      $("confirmDialog").oncancel = () => resolve(false);
    });
  }
  async function load(id) {
    if (
      dirty() &&
      !(await confirm("Discard unsaved changes?", "The saved overlay will remain unchanged."))
    ) {
      library();
      return;
    }
    doc = OverlayModel.document(documents.find((row) => row.id === id));
    a.doc = doc;
    selection.clear();
    undo = [];
    redo = [];
    saved = serial();
    library();
    syncCanvasFields();
    showSettings("canvas");
    draw();
  }
  function drawCatalog() {
    const host = $("widgetCatalog"),
      query = $("widgetSearch").value.toLowerCase();
    host.replaceChildren();
    host.scrollTop = 0;
    let group = "";
    const groups = [
      "Static",
      "Music",
      "Labels",
      "Twitch",
      "Alerts",
      "Records",
      "Games",
      "Tools",
      "Custom",
    ];
    const selectedGroup =
      groups.includes($("widgetGroup").value) &&
      catalog.some((row) => row.group === $("widgetGroup").value)
        ? $("widgetGroup").value
        : "";
    $("widgetGroup").replaceChildren(
      new Option("All categories", ""),
      ...groups
        .filter((group) => catalog.some((row) => row.group === group))
        .map((group) => new Option(group, group)),
    );
    $("widgetGroup").value = selectedGroup;
    const choices = catalog
      .filter(
        (row) =>
          (row.name + " " + row.group).toLowerCase().includes(query) &&
          (!selectedGroup || row.group === selectedGroup),
      )
      .sort(
        (a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.name.localeCompare(b.name),
      );
    for (const row of choices) {
      if (row.group !== group) {
        group = row.group;
        const title = document.createElement("h3");
        title.textContent = group;
        host.append(title);
      }
      const button = document.createElement("button");
      const name = document.createElement("span");
      name.textContent = row.name;
      button.append(name);
      if (row.requirement) {
        const hint = document.createElement("small");
        hint.id = "widget-requirement-" + row.type;
        hint.textContent = row.requirement;
        button.setAttribute("aria-label", row.name);
        button.setAttribute("aria-describedby", hint.id);
        button.append(hint);
      }
      button.onclick = () => {
        if (doc.widgets.length >= 64) return a.notice("An overlay can contain up to 64 layers.");
        change(() => {
          const w = OverlayModel.widget({
            type: row.type,
            ...(row.type === "credits" ? { creditsSource: "subscribers" } : {}),
            ...(row.type === "challenge-board"
              ? { challengeLayout: "grid", gridSize: 3, gridRows: 3 }
              : {}),
            id: globalThis.GrobyRandomId(),
            x: Math.min(80, doc.width - row.width),
            y: Math.min(80, doc.height - row.height),
            width: Math.min(row.width, doc.width),
            height: Math.min(row.height, doc.height),
          });
          doc.widgets.push(w);
          selection.clear();
          selection.add(w.id);
        });
        $("catalogDialog").close();
        showSettings("widget");
        inspector.draw();
      };
      host.append(button);
    }
    if (!choices.length) {
      const empty = document.createElement("p");
      empty.className = "catalogEmpty";
      empty.textContent = !catalogReady
        ? "Loading widgets…"
        : query
          ? "No matching widgets."
          : "No widgets available.";
      host.append(empty);
    }
    $("catalogHelp").textContent =
      "You can design with sample data. Setup hints show what each live widget needs.";
  }
  $("add").onclick = () => {
    drawCatalog();
    $("catalogDialog").showModal();
    $("widgetSearch").focus();
    void request()
      .then((result) => {
        catalog = result.catalog;
        a.catalog = catalog;
        if ($("catalogDialog").open) drawCatalog();
      })
      .catch((error) => a.notice(error.message));
  };
  $("widgetSearch").oninput = drawCatalog;
  $("widgetGroup").onchange = drawCatalog;
  $("canvasOptions").onclick = () => {
    syncCanvasFields();
    $("canvasDialog").showModal();
  };
  for (const button of document.querySelectorAll("[data-close]"))
    button.onclick = () => $(button.dataset.close).close();
  $("sizePreset").replaceChildren(
    ...OverlayModel.presets.map(([name, w, h]) => new Option(name + " · " + w + " × " + h, name)),
    new Option("Custom", "custom"),
  );
  $("sizePreset").onchange = () => {
    const preset = OverlayModel.presets.find((row) => row[0] === $("sizePreset").value);
    if (preset) {
      $("canvasWidth").value = preset[1];
      $("canvasHeight").value = preset[2];
    }
  };
  $("applySize").onclick = () => {
    if (!$("canvasWidth").reportValidity() || !$("canvasHeight").reportValidity()) return;
    change(() => {
      const width = Number($("canvasWidth").value),
        height = Number($("canvasHeight").value),
        sx = width / doc.width,
        sy = height / doc.height;
      if ($("scaleContents").checked)
        for (const w of doc.widgets) {
          w.x *= sx;
          w.y *= sy;
          w.width *= sx;
          w.height *= sy;
          w.fontSize = Math.min(240, w.fontSize * Math.min(sx, sy));
        }
      doc.width = width;
      doc.height = height;
      doc = OverlayModel.document(doc);
      a.doc = doc;
    });
    syncCanvasFields();
  };
  $("documentName").onchange = () =>
    change(() => {
      doc.name = $("documentName").value.trim() || "Untitled overlay";
    });
  $("overlayMotion").onchange = () =>
    change(() => {
      doc.motion = $("overlayMotion").value;
    });
  $("grid").onchange = () => draw(false);
  $("exitStudio").hidden = parent === window;
  $("exitStudio").onclick = () =>
    parent.postMessage({ type: "overlay-studio-exit" }, location.origin);
  for (const [id, css] of [
    ["toggleLayers", "hideLayers"],
    ["toggleInspector", "hideInspector"],
  ]) {
    $(id).onclick = () => {
      const hidden = document.body.classList.toggle(css);
      if (id === "toggleInspector" && !hidden) {
        document.body.classList.remove("hideLayers");
        $("toggleLayers").setAttribute("aria-pressed", "true");
        $("widgetInspector").open = true;
      }
      $(id).setAttribute("aria-pressed", String(!hidden));
      requestAnimationFrame(fit);
    };
  }
  $("zoom").onchange = fit;
  new ResizeObserver(fit).observe($("stageWrap"));
  $("undo").onclick = () => history(-1);
  $("redo").onclick = () => history(1);
  $("group").onclick = () =>
    change(() => {
      const id = globalThis.GrobyRandomId();
      a.selected().forEach((w) => {
        w.group = id;
      });
    });
  $("ungroup").onclick = () =>
    change(() =>
      a.selected().forEach((w) => {
        w.group = "";
      }),
    );
  for (const [id, delta] of [
    ["front", 1],
    ["back", -1],
  ])
    $(id).onclick = () =>
      change(() => {
        const indices = doc.widgets
          .map((w, index) => (selection.has(w.id) ? index : -1))
          .filter((index) => index >= 0);
        if (delta > 0) indices.reverse();
        for (const index of indices) {
          const target = index + delta;
          if (target < 0 || target >= doc.widgets.length || selection.has(doc.widgets[target].id))
            continue;
          [doc.widgets[index], doc.widgets[target]] = [doc.widgets[target], doc.widgets[index]];
        }
      });
  $("layerSearch").oninput = drawLayers;
  document.addEventListener("click", (event) => {
    const menu = $("overlayLibrary");
    if (!menu.contains(event.target) || event.target.closest(".libraryMenu button"))
      menu.open = false;
    const tools = document.querySelector(".editTools");
    if (!tools.contains(event.target)) tools.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      $("overlayLibrary").open = false;
      document.querySelector(".editTools").open = false;
    }
  });
  $("library").onchange = () => load($("library").value);
  $("new").onclick = () => load("");
  $("exportLayout").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, ...doc }, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = doc.name.replace(/[^a-z0-9_-]/gi, "_") + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("importLayout").onchange = async () => {
    const file = $("importLayout").files[0];
    if (!file) return;
    try {
      if (file.size > 240000) throw Error("Choose a layout under 240 KB.");
      const value = JSON.parse(await file.text());
      if (!value || !Array.isArray(value.widgets))
        throw Error("Choose an exported overlay layout.");
      const next = OverlayModel.document({ ...value, id: "" });
      if (
        dirty() &&
        !(await confirm(
          "Replace the current draft?",
          "Import opens a new overlay. The saved version stays available.",
        ))
      )
        return;
      checkpoint();
      doc = next;
      a.doc = doc;
      selection.clear();
      syncCanvasFields();
      showSettings("canvas");
      draw();
      a.notice("Layout imported as a new draft. Save to create its OBS link.");
    } catch (error) {
      a.notice(error.message);
    } finally {
      $("importLayout").value = "";
    }
  };
  $("copyDocument").onclick = () => {
    change(() => {
      doc.id = "";
      doc.name += " copy";
    });
    library();
    syncCanvasFields();
  };
  $("deleteDocument").onclick = async () => {
    if (
      !(await confirm(
        "Delete overlay?",
        "Remove this saved overlay? Its OBS URL will become empty.",
      ))
    )
      return;
    try {
      const result = await request("/" + encodeURIComponent(doc.id), "DELETE", {
        expectedRevision: revision,
      });
      documents = result.documents;
      revision = result.revision;
      saved = serial();
      await load("");
    } catch (error) {
      a.notice(error.message);
    }
  };
  $("save").onclick = async () => {
    if (
      !a.enhancedReady &&
      (doc.motion !== "full" ||
        doc.widgets.some(
          (w) =>
            w.goalSource === "events" ||
            w.alertVariants?.length ||
            w.alert?.mediaUrl ||
            w.alert?.soundUrl ||
            ["slide-left", "slide-right", "blur"].includes(w.entrance) ||
            w.textEffect !== "none" ||
            w.hideCommands ||
            w.showTimestamps ||
            (w.statSource === "watchtime" && w.watchtimeFormat !== "compact"),
        ))
    ) {
      a.notice(
        "Restart Core before saving these upgraded widget settings. Your draft is still here.",
      );
      return;
    }
    if (!a.boardsReady && doc.widgets.some((w) => OverlayGameRules.boardTypes.includes(w.type))) {
      a.notice("Restart Core to save board settings. Your draft is still here.");
      return;
    }
    if (
      !a.refinementsReady &&
      doc.widgets.some(
        (w) =>
          w.type === "tile-match" ||
          (w.mediaFocusX ?? 50) !== 50 ||
          (w.mediaFocusY ?? 50) !== 50 ||
          (w.countdownFinish || "zero") !== "zero",
      )
    ) {
      a.notice("Restart Core to save the new widget settings. Your draft is still here.");
      return;
    }
    if (
      !a.livePreviewReady &&
      doc.widgets.some((w) => w.hideBotMessages || w.hiddenAccounts?.length)
    ) {
      a.notice("Restart Groby's Deck to save chat filters. Your draft is still here.");
      return;
    }
    if (
      !a.motionReady &&
      doc.widgets.some(
        (w) =>
          (w.entrance || "none") !== "none" ||
          (w.ambient || "none") !== "none" ||
          w.itemOpacity > 0 ||
          w.itemPadding > 0 ||
          w.itemGap > 0 ||
          w.itemRadius > 0 ||
          w.exitAnimation ||
          w.chatMode === "scroll" ||
          w.motionTarget === "text" ||
          (w.animationMs || 350) !== 350 ||
          (w.ambientSeconds || 6) !== 6 ||
          (w.itemBackground || "#17233b") !== "#17233b" ||
          ["slideshow", "rotating-text", "credits"].includes(w.type),
      )
    ) {
      a.notice(
        "Restart Core to save animated styles and rotating widgets. Your draft is still here.",
      );
      return;
    }
    for (const field of document.querySelectorAll("#widgetFields input, #widgetFields textarea")) {
      if (field.checkVisibility() && !field.reportValidity()) return;
    }
    document.activeElement?.blur();
    $("save").disabled = true;
    try {
      const submitted = serial(),
        submittedId = doc.id,
        result = await request("", "PUT", {
          document: OverlayModel.document(doc),
          expectedRevision: revision,
        });
      documents = result.documents;
      revision = result.revision;
      if (serial() === submitted) {
        doc = structuredClone(documents.find((row) => row.id === result.selectedId));
        a.doc = doc;
        saved = serial();
      } else if (doc.id === submittedId) {
        doc.id = result.selectedId;
        saved = JSON.stringify(documents.find((row) => row.id === result.selectedId));
      }
      library();
      syncCanvasFields();
      draw();
      a.notice("Overlay saved. OBS will receive the saved changes.");
    } catch (error) {
      a.notice(error.message);
    } finally {
      $("save").disabled = false;
    }
  };
  $("openOutput").onclick = () => {
    const published = documents.find((row) => row.id === doc.id);
    const url = new URL("/stream-overlay.html", location.origin);
    if (published) url.searchParams.set("id", published.id);
    $("outputUrl").value = published ? url.href : "";
    $("copyUrl").disabled = !published;
    $("copyUrl").textContent = "Copy URL";
    $("viewOutput").hidden = !published;
    if (published) $("viewOutput").href = url.href;
    $("outputSize").textContent = published
      ? "Width: " + published.width + " px · Height: " + published.height + " px"
      : "Save this overlay to create an OBS URL.";
    $("outputDraftNotice").hidden = !published || !dirty();
    $("outputDialog").showModal();
  };
  $("copyUrl").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("outputUrl").value);
      $("copyUrl").textContent = "Copied";
    } catch {
      $("outputUrl").select();
      $("copyUrl").textContent = "Selected - press Ctrl+C";
    }
  };
  function preview(value) {
    previewing = value;
    a.previewing = value;
    document.body.classList.toggle("previewMode", value);
    $("previewBanner").hidden = !value;
    draw();
  }
  $("preview").onclick = () => preview(true);
  $("endPreview").onclick = () => preview(false);
  feed = setupOverlayLivePreview(a);
  setupOverlayViewport(a);
  setupOverlayInteractions(a);
  saved = serial();
  syncCanvasFields();
  draw();
  addEventListener("beforeunload", (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  request()
    .then((result) => {
      documents = result.documents;
      revision = result.revision;
      catalog = result.catalog;
      a.catalog = catalog;
      a.motionReady = result.presentationEffects === true;
      a.livePreviewReady = result.livePreview === true;
      a.enhancedReady = result.designerVersion >= 4;
      a.boardsReady = result.designerVersion >= 5;
      a.refinementsReady = result.designerVersion >= 6;
      library();
      if (documents.length && !dirty()) void load(documents[0].id);
    })
    .catch((error) => {
      catalog = OverlayModel.definitions;
      a.catalog = catalog;
      a.notice(error.message);
    })
    .finally(() => {
      catalogReady = true;
      if ($("catalogDialog").open) drawCatalog();
    });
})();
