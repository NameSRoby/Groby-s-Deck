/** Unit selectors display friendly durations while the API keeps its existing seconds values. */
window.createDurationInput = (input, { label, max, min = 0, precision = 1, initial }) => {
  const unit = document.createElement("select"),
    box = document.createElement("span");
  unit.id = input.id + "Unit";
  unit.setAttribute("aria-label", label + " unit");
  input.setAttribute("aria-label", label);
  box.className = "automationDuration";
  for (const [factor, text] of [
    [1, "Seconds"],
    [60, "Minutes"],
    [3600, "Hours"],
  ])
    unit.add(new Option(text, factor));
  input.replaceWith(box);
  box.append(input, unit);
  input.step = "any";
  let factor = 1,
    exact = null;
  function bounds() {
    input.min = min / factor;
    input.max = max / factor;
  }
  function set(seconds) {
    factor =
      seconds >= 3600 && seconds % 3600 === 0 ? 3600 : seconds >= 60 && seconds % 60 === 0 ? 60 : 1;
    exact = seconds;
    unit.value = String(factor);
    input.value = Number((seconds / factor).toPrecision(12));
    input.setCustomValidity("");
    bounds();
  }
  input.addEventListener("input", () => {
    exact = null;
    input.setCustomValidity("");
  });
  unit.onchange = () => {
    const seconds = exact ?? Number(input.value) * factor;
    factor = Number(unit.value);
    exact = seconds;
    input.value = Number((seconds / factor).toPrecision(12));
    input.setCustomValidity("");
    bounds();
  };
  set(initial ?? Number(input.value));
  return {
    set,
    read() {
      const seconds = exact ?? Number(input.value) * factor,
        rounded = Math.round(seconds / precision) * precision;
      if (input.value === "" || !Number.isFinite(seconds) || seconds < min || seconds > max)
        throw Error("Enter a valid " + label.toLowerCase() + " within the shown range.");
      if (Math.abs(seconds - rounded) > 0.000001) {
        input.setCustomValidity(
          precision === 1
            ? "Choose a duration in whole seconds."
            : "Choose a duration in whole milliseconds.",
        );
        input.reportValidity();
        throw Error(input.validationMessage);
      }
      return Number(rounded.toFixed(3));
    },
  };
};
