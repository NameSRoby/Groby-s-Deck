/** Convert persisted designs on load before passing them to the current engine. */
const retiredBehaviors = new Set([
  "ambientContrast",
  "ambientAttackMs",
  "ambientReleaseMs",
  "ambientBed",
  "bandsBed",
  "bandSeparation",
  "bandSensitivity",
  "intervalPulseEnabled",
]);
const pulse = (value) => (["wash", "bands"].includes(value) ? "pulse" : value);
const palette = (value) => (value === "prism-bands" ? "prism-pulse" : value);
const record = (value) => value && typeof value === "object" && !Array.isArray(value);

function assignment(row) {
  if (!record(row) || !Object.hasOwn(row, "assignedEffect")) return row;
  return { ...row, assignedEffect: pulse(row.assignedEffect) };
}

function design(value) {
  if (!record(value)) return value;
  const next = { ...value };
  if (["ambient", "bands"].includes(next.preset)) next.preset = "pulse";
  if (Object.hasOwn(next, "raveScenario")) next.raveScenario = pulse(next.raveScenario);
  for (const key of ["behaviors", "parameterRanges"]) {
    if (record(next[key]))
      next[key] = Object.fromEntries(
        Object.entries(next[key]).filter(([name]) => !retiredBehaviors.has(name)),
      );
  }
  if (record(next.recipeOptions)) {
    next.recipeOptions = { ...next.recipeOptions };
    for (const [key, convert] of [
      ["effect", pulse],
      ["palette", palette],
    ]) {
      const row = next.recipeOptions[key];
      if (!record(row)) continue;
      const allowed = Array.isArray(row.allowed) ? row.allowed.map(convert) : row.allowed;
      next.recipeOptions[key] = {
        ...row,
        value: convert(row.value),
        allowed:
          Array.isArray(allowed) && allowed.some((value, i) => value !== row.allowed[i])
            ? [...new Set(allowed)]
            : allowed,
      };
    }
  }
  if (record(next.scenarioWeights)) {
    const { wash, bands, ...weights } = next.scenarioWeights;
    if ([wash, bands].some((n) => n !== undefined)) {
      const pulseWeights = [weights.pulse ?? 1, wash ?? 0, bands ?? 0];
      if (pulseWeights.every((n) => Number.isFinite(n) && n >= 0 && n <= 10))
        next.scenarioWeights = { ...weights, pulse: Math.max(...pulseWeights) };
    }
  }
  return next;
}

module.exports = { design, assignment, retiredBehaviors };
