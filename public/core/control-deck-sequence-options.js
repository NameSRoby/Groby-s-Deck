/** Repetition is explicit; stopping prevents remaining steps, not past actions. */
export function sequenceAvailable(button, catalog) {
  return (
    button.kind === "folder" ||
    (button.steps || []).every((step) => {
      if (step.type) return true;
      const action = catalog.find((action) => action.id === step.actionId);
      return !!action && action.available !== false;
    })
  );
}
export function sequenceStatus(run, cancelOnPress) {
  if (!run) return "Starting…";
  return `${run.phase === "waiting" ? "Waiting" : run.phase === "condition" ? "Checking" : "Running"} · ${run.step}/${run.total}${run.detail ? ` · ${run.detail}` : ""}${run.repeats > 1 ? ` · ${run.iteration}/${run.repeats}` : ""}${cancelOnPress ? " · tap to stop" : ""}`;
}
export function createSequenceOptions(value) {
  const element = document.createElement("section");
  element.className = "deckSequenceOptions";
  element.innerHTML =
    '<h3>Sequence controls</h3><label class="deckField">Run sequence this many times<input id="deckRepeatCount" type="number" min="1" max="1000" step="1" value="1"></label><label class="deckCheck"><input id="deckCancelOnPress" type="checkbox"> Press again to stop a running sequence</label><p class="deckEditorHint">Timers continue if you close the deck. Stop cancels remaining steps; completed actions stay as they are. Core must stay running.</p>';
  const repeat = element.querySelector('[type="number"]'),
    cancel = element.querySelector('[type="checkbox"]');
  repeat.value = value.repeatCount || 1;
  cancel.checked = value.cancelOnPress !== false;
  return {
    element,
    read() {
      if (!repeat.reportValidity()) throw Error("Choose 1–1,000 repetitions.");
      return { repeatCount: Number(repeat.value), cancelOnPress: cancel.checked };
    },
  };
}
