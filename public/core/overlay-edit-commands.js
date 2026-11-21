/** Reversible document edits. Clipboard stays inside the editor; nothing runs live. */
/* exported setupOverlayCommands */
/* global OverlayModel */
globalThis.setupOverlayCommands = function (a) {
  let clipboard = [];
  function remove(ids = [...a.selection]) {
    const removable = a.doc.widgets.filter((row) => ids.includes(row.id) && !row.locked);
    if (!removable.length) return a.notice("Unlock the selected widget before deleting it.");
    const keys = new Set(removable.map((row) => row.id));
    a.change(() => {
      a.doc.widgets = a.doc.widgets.filter((row) => !keys.has(row.id));
      for (const id of keys) a.selection.delete(id);
    });
    a.notice(
      removable.length +
        " widget" +
        (removable.length === 1 ? "" : "s") +
        " deleted. Undo restores the selection.",
    );
  }
  function copy(cut = false) {
    clipboard = structuredClone(a.selected().filter((row) => !cut || !row.locked));
    if (cut && clipboard.length) remove(clipboard.map((row) => row.id));
    else a.notice(clipboard.length + " widgets copied. Paste in this or another overlay.");
    sync();
  }
  function paste(rows = clipboard) {
    if (!rows.length) return a.notice("Copy a widget first.");
    if (a.doc.widgets.length + rows.length > 64)
      return a.notice("An overlay can contain up to 64 widgets.");
    const groups = new Map();
    const copies = rows.map((row) => {
      if (row.group && !groups.has(row.group)) groups.set(row.group, globalThis.GrobyRandomId());
      return OverlayModel.widget({
        ...structuredClone(row),
        id: globalThis.GrobyRandomId(),
        name: row.name + " copy",
        locked: false,
        group: groups.get(row.group) || "",
        x: Math.min(a.doc.width - row.width, row.x + 20),
        y: Math.min(a.doc.height - row.height, row.y + 20),
      });
    });
    a.change(() => {
      a.doc.widgets.push(...copies);
      a.selection.clear();
      copies.forEach((row) => a.selection.add(row.id));
    });
  }
  function selectAll() {
    a.selection.clear();
    a.doc.widgets.forEach((row) => a.selection.add(row.id));
    a.draw();
  }
  function toggle(key) {
    const rows = a.selected(),
      next = rows.some((row) => !row[key]);
    if (rows.length) a.change(() => rows.forEach((row) => (row[key] = next)));
  }
  function align(mode) {
    const rows = a.selected().filter((row) => !row.locked);
    if (!rows.length) return;
    const horizontal = ["left", "center", "right", "horizontal"].includes(mode),
      axis = horizontal ? "x" : "y",
      size = horizontal ? "width" : "height";
    if (["horizontal", "vertical"].includes(mode)) {
      if (rows.length < 3)
        return a.notice("Select at least three unlocked widgets to distribute them.");
      const sorted = [...rows].sort((x, y) => x[axis] - y[axis]),
        first = sorted[0][axis],
        end = sorted.at(-1)[axis] + sorted.at(-1)[size],
        total = sorted.reduce((sum, row) => sum + row[size], 0),
        gap = (end - first - total) / (rows.length - 1);
      a.change(() => {
        let at = first;
        for (const row of sorted) {
          row[axis] = at;
          at += row[size] + gap;
        }
      });
      return;
    }
    const minimum = rows.length === 1 ? 0 : Math.min(...rows.map((row) => row[axis])),
      maximum =
        rows.length === 1 ? a.doc[size] : Math.max(...rows.map((row) => row[axis] + row[size]));
    a.change(() =>
      rows.forEach(
        (row) =>
          (row[axis] = ["left", "top"].includes(mode)
            ? minimum
            : ["right", "bottom"].includes(mode)
              ? maximum - row[size]
              : minimum + (maximum - minimum - row[size]) / 2),
      ),
    );
  }
  function reorder(front) {
    const selected = a.doc.widgets.filter((row) => a.selection.has(row.id)),
      rest = a.doc.widgets.filter((row) => !a.selection.has(row.id));
    if (selected.length)
      a.change(() => (a.doc.widgets = front ? [...rest, ...selected] : [...selected, ...rest]));
  }
  function move(id, targetId, after) {
    const row = a.doc.widgets.find((entry) => entry.id === id);
    if (!row) return;
    const moving = a.doc.widgets.filter((entry) =>
      row.group ? entry.group === row.group : entry.id === id,
    );
    if (moving.some((entry) => entry.locked))
      return a.notice("Unlock this layer or group before reordering it.");
    if (moving.some((entry) => entry.id === targetId)) return;
    a.change(() => {
      const rest = a.doc.widgets.filter((entry) => !moving.includes(entry)),
        index = rest.findIndex((entry) => entry.id === targetId);
      if (index < 0) return;
      rest.splice(index + (after ? 1 : 0), 0, ...moving);
      a.doc.widgets = rest;
    });
  }
  function rename(id) {
    if (id) {
      a.selection.clear();
      a.selection.add(id);
      a.draw();
    }
    if (a.selected().length !== 1) return a.notice("Select one widget to rename it.");
    a.showSelection();
    a.showInspectorSection("position");
    const field = document.querySelector('[data-field="name"]');
    field?.focus();
    field?.select();
  }
  const bind = (id, fn) => {
    if (a.$(id)) a.$(id).onclick = fn;
  };
  bind("remove", () => remove());
  bind("deleteSelection", () => remove());
  bind("copySelection", () => copy());
  bind("cutSelection", () => copy(true));
  bind("pasteSelection", () => paste());
  bind("duplicate", () => paste(a.selected()));
  bind("selectAll", selectAll);
  bind("bringToFront", () => reorder(true));
  bind("sendToBack", () => reorder(false));
  bind("lockSelection", () => toggle("locked"));
  bind("showSelection", () => toggle("visible"));
  document
    .querySelectorAll("[data-align-selection]")
    .forEach((button) => (button.onclick = () => align(button.dataset.alignSelection)));
  function sync() {
    const rows = a.selected(),
      editable = rows.filter((row) => !row.locked).length;
    for (const id of ["remove", "deleteSelection"]) {
      a.$(id).disabled = !editable;
      a.$(id).title =
        rows.length && !editable
          ? "Unlock the selected widgets first"
          : "Delete selected widgets (Delete). Undo restores them.";
    }
    for (const id of ["copySelection", "cutSelection", "lockSelection", "showSelection"])
      a.$(id).disabled = !rows.length;
    for (const id of ["bringToFront", "sendToBack"]) a.$(id).disabled = !rows.length;
    a.$("cutSelection").disabled = !editable;
    a.$("pasteSelection").disabled = !clipboard.length;
    a.$("selectionSummary").textContent = rows.length
      ? rows.length + " selected" + (rows.length !== editable ? " (includes locked widgets)" : "")
      : "Select a widget to edit";
    a.$("remove").textContent = rows.length > 1 ? "Delete widgets" : "Delete widget";
    a.$("lockSelection").textContent =
      rows.length && rows.every((row) => row.locked) ? "Unlock selected" : "Lock selected";
    a.$("showSelection").textContent =
      rows.length && rows.every((row) => row.visible) ? "Hide selected" : "Show selected";
  }
  return { remove, copy, paste, selectAll, align, toggle, sync, reorder, move, rename };
};
