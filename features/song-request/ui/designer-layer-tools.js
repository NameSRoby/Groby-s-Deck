/** Non-destructive layer crop uses overlay pixels and survives save/reload. */
/* global node, labeled, changed, updatePieceInspector */
/* exported setupLayerCrop */
function setupLayerCrop(panel, target) {
  if (!target.frame) return;
  const details = node("details", "layer-crop"),
    fields = node("div", "canvas-fields");
  details.append(node("summary", "", "Crop layer"));
  for (const key of ["top", "right", "bottom", "left"]) {
    const input = node("input");
    input.type = "number";
    input.min = 0;
    const horizontal = ["left", "right"].includes(key),
      other = { left: "right", right: "left", top: "bottom", bottom: "top" }[key];
    input.max = Math.max(
      0,
      target.frame[horizontal ? "width" : "height"] - (target.crop?.[other] || 0) - 1,
    );
    input.value = target.crop?.[key] || 0;
    input.dataset.crop = key;
    input.onchange = () => {
      if (!input.reportValidity()) return;
      target.crop = { ...target.crop, [key]: Number(input.value) };
      changed();
      updatePieceInspector();
    };
    fields.append(labeled(key[0].toUpperCase() + key.slice(1) + " (px)", input));
  }
  const reset = node("button", "", "Reset crop");
  reset.onclick = () => {
    target.crop = { top: 0, right: 0, bottom: 0, left: 0 };
    changed();
    updatePieceInspector();
  };
  details.append(fields, reset);
  panel.append(details);
}
