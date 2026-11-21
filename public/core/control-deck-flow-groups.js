/** Visible branches and groups use the same action editor as ordinary sequences. */
const el = (tag, css, text) => {
  const node = document.createElement(tag);
  if (css) node.className = css;
  if (text !== undefined) node.textContent = text;
  return node;
};
function choice(label, rows, value) {
  const field = el("label", "deckField"),
    select = el("select");
  select.setAttribute("aria-label", label);
  for (const [key, text] of rows) select.add(new Option(text, key));
  select.value = value;
  field.append(el("span", "", label), select);
  return { field, select };
}
export function conditionEditor(host, initial, catalog) {
  const source = choice(
    "If this action",
    catalog.filter((a) => a.id !== "deck.wait").map((a) => [a.id, a.label]),
    initial.actionId,
  );
  if (!catalog.some((a) => a.id === initial.actionId))
    source.select.add(new Option("Missing action", initial.actionId));
  source.select.value = initial.actionId;
  const field = choice(
      "Check",
      [
        ["available", "Is available"],
        ["active", "Active / enabled"],
        ["muted", "Muted"],
        ["value", "Value / level"],
        ["status", "Status"],
      ],
      initial.field,
    ),
    operator = choice(
      "Comparison",
      [
        ["equals", "is"],
        ["not-equals", "is not"],
        ["greater", "is greater than"],
        ["less", "is less than"],
      ],
      initial.operator,
    ),
    value = el("input"),
    boolean = choice(
      "Expected state",
      [
        ["true", "Yes"],
        ["false", "No"],
      ],
      String(initial.value),
    ),
    valueField = el("label", "deckField");
  value.setAttribute("aria-label", "Expected value");
  value.maxLength = 160;
  value.value = String(initial.value);
  valueField.append(el("span", "", "Expected value"), value);
  function sync() {
    const binary = ["available", "active", "muted"].includes(field.select.value);
    boolean.field.hidden = !binary;
    valueField.hidden = binary;
    value.type = field.select.value === "value" ? "number" : "text";
    value.step = "any";
    for (const option of operator.select.options)
      option.disabled =
        field.select.value !== "value" && ["greater", "less"].includes(option.value);
    if (field.select.value !== "value" && ["greater", "less"].includes(operator.select.value))
      operator.select.value = "equals";
  }
  field.select.onchange = sync;
  const help = el("p", "deckEditorHint");
  function supported(explicit = false) {
    const action = catalog.find((a) => a.id === source.select.value),
      state = action?.state;
    const has = {
      available: true,
      active: typeof state === "boolean" || typeof state?.active === "boolean",
      muted: typeof state?.muted === "boolean",
      value: typeof state === "number" || typeof (state?.value ?? state?.level) === "number",
      status:
        typeof state === "string" ||
        typeof (state?.status ?? state?.state ?? state?.tone) === "string",
    };
    for (const option of field.select.options) option.disabled = !has[option.value];
    if (explicit && !has[field.select.value]) field.select.value = "available";
    help.textContent =
      Object.values(has).filter(Boolean).length === 1
        ? "This action currently reports availability only."
        : "Checks use the current state reported by this action.";
    sync();
  }
  source.select.onchange = () => supported(true);
  supported();
  sync();
  host.append(source.field, field.field, operator.field, boolean.field, valueField, help);
  return (validate = true) => {
    const binary = ["available", "active", "muted"].includes(field.select.value);
    if (
      validate &&
      (!source.select.value || (!binary && (!value.value.trim() || !value.reportValidity())))
    )
      throw Error("Complete the condition.");
    return {
      actionId: source.select.value,
      field: field.select.value,
      operator: operator.select.value,
      value: binary
        ? boolean.select.value === "true"
        : field.select.value === "value"
          ? Number(value.value)
          : value.value,
    };
  };
}
export function buildFlowGroup(
  card,
  node,
  { catalog, sendKey, build, depth, shared, parallel, trigger },
) {
  const branch = (label, steps, inParallel = parallel, together = false) => {
    const region = el("section", "deckFlowBranch");
    region.setAttribute("aria-label", label);
    card.append(region);
    const editor = build(region, label, steps, catalog, sendKey, {
      depth: depth + 1,
      shared,
      inParallel,
      parallel: together,
      trigger,
    });
    return editor;
  };
  if (node.type === "if") {
    const fields = el("div", "deckFlowCondition");
    card.append(fields);
    const condition = conditionEditor(fields, node.condition, catalog),
      yes = branch("Then", node.then),
      no = branch("Otherwise", node.else);
    card.append(
      el(
        "p",
        "deckEditorHint",
        "Unknown or disconnected state stops the flow; it does not count as No.",
      ),
    );
    return (validate) => {
      const then = yes.read(validate),
        otherwise = no.read(validate);
      if (validate && !then.length && !otherwise.length)
        throw Error("Add an action to Then or Otherwise.");
      return { type: "if", condition: condition(validate), then, else: otherwise };
    };
  }
  if (node.type === "parallel") {
    card.append(
      el(
        "p",
        "deckEditorHint",
        "Start these steps together. Continue after all finish. A failure stops the group; completed actions are not undone.",
      ),
    );
    const editor = branch("Together", node.steps, true, true);
    return (validate) => {
      const steps = editor.read(validate);
      if (validate && !steps.length) throw Error("Add actions to the Together block.");
      return { type: "parallel", steps };
    };
  }
  if (node.type === "sequence") {
    const editor = branch("In order", node.steps);
    return (validate) => {
      const steps = editor.read(validate);
      if (validate && !steps.length) throw Error("Add actions to the In order block.");
      return { type: "sequence", steps };
    };
  }
  const field = el("label", "deckField"),
    count = el("input");
  count.type = "number";
  count.min = 1;
  count.max = 1000;
  count.step = 1;
  count.value = node.count;
  count.setAttribute("aria-label", "Repeat block count");
  field.append(el("span", "", "Repeat this block"), count);
  card.append(field);
  const editor = branch("Repeat actions", node.steps);
  return (validate) => {
    if (validate && !count.reportValidity()) throw Error("Choose 1–1,000 repetitions.");
    const steps = editor.read(validate);
    if (validate && !steps.length) throw Error("Add actions to the Repeat block.");
    return { type: "repeat", count: Number(count.value), steps };
  };
}
