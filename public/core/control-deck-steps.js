import { parameterForm } from "./control-deck-parameters.js";
import { presentAction } from "./control-deck-action-presentation.js";
import { buildFlowGroup } from "./control-deck-flow-groups.js";
const clone = (value) => structuredClone(value);
const WAIT = "deck.wait";
const el = (tag, css, text) => {
  const node = document.createElement(tag);
  if (css) node.className = css;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (label, fn) => {
  const node = el("button", "", label);
  node.type = "button";
  node.onclick = fn;
  return node;
};
function durationField(value, label) {
  const field = el("label", "deckField deckDurationField"),
    input = el("input"),
    unit = el("select");
  for (const [ms, text] of [
    [1000, "seconds"],
    [60000, "minutes"],
    [3600000, "hours"],
  ])
    unit.add(new Option(text, ms));
  unit.value =
    value >= 3600000 && value % 3600000 === 0
      ? "3600000"
      : value >= 60000 && value % 60000 === 0
        ? "60000"
        : "1000";
  let factor = Number(unit.value);
  input.type = "number";
  input.min = 0.001;
  input.max = 86400000 / factor;
  input.step = "any";
  input.required = true;
  input.value = value / factor;
  input.setAttribute("aria-label", label);
  unit.setAttribute("aria-label", label + " unit");
  unit.onchange = () => {
    const ms = Number(input.value) * factor;
    factor = Number(unit.value);
    input.value = ms / factor;
    input.max = 86400000 / factor;
  };
  field.append(el("span", "", label), input, unit);
  return {
    field,
    read(validate = true) {
      const ms = Math.round(Number(input.value) * factor);
      if (validate && (!input.reportValidity() || ms < 1 || ms > 86400000))
        throw Error("Choose a wait between 0.001 seconds and 24 hours.");
      return ms;
    },
  };
}
/** A plain, ordered sequence. Storage is bounded by config size, not a tiny row limit. */
export function buildActionSteps(host, title, initial, catalog, sendKey, options = {}) {
  const depth = options.depth || 0,
    shared = options.shared || { active: null };
  host.dataset.flowEditor = "true";
  let steps = clone(initial),
    readers = [];
  const heading = el("h3", "", title),
    list = el("div", "deckStepList"),
    notice = el("p", "deckStepNotice"),
    tools = el("div", "deckSequenceTools");
  notice.setAttribute("role", "status");
  host.append(
    heading,
    el(
      "p",
      "deckEditorHint",
      depth
        ? "Choose Add actions here to send library selections to this branch."
        : "The trigger runs this whole flow. Connect actions, waits and If / Then / Otherwise blocks from top to bottom.",
    ),
    list,
    tools,
    notice,
  );
  if (!depth)
    heading.after(
      el(
        "div",
        "deckFlowTrigger",
        options.triggerLabel ||
          (title === "Press action"
            ? "WHEN · Button pressed"
            : title.includes("hold") || title.includes("Hold")
              ? "WHEN · Button held"
              : "WHEN · Second press"),
      ),
    );
  const read = (validate = true) => readers.map((get) => get(validate));
  function capture() {
    try {
      steps = read(false);
      notice.textContent = "";
      return true;
    } catch (error) {
      notice.textContent = error.message;
      return false;
    }
  }
  function change(fn) {
    if (capture()) {
      fn();
      draw();
      return true;
    }
  }
  function defaultStep() {
    const action =
      catalog.find((a) => a.available && a.id !== WAIT && a.kind !== "condition") || catalog[0];
    return action
      ? { actionId: action.id, params: clone(action.defaults || {}), delayMs: 0 }
      : null;
  }
  const waitStep = () => ({ actionId: WAIT, params: { durationMs: 5000 }, delayMs: 0 });
  function controlsFor(index) {
    const controls = el("div", "deckStepControls");
    for (const [label, text, fn, disabled] of [
      [
        "Move action up",
        "↑",
        () => ([steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]),
        index === 0,
      ],
      [
        "Move action down",
        "↓",
        () => ([steps[index + 1], steps[index]] = [steps[index], steps[index + 1]]),
        index === steps.length - 1,
      ],
      [
        "Duplicate step",
        "Duplicate",
        () => steps.splice(index + 1, 0, clone(steps[index])),
        options.parallel && steps.length >= 8,
      ],
      ["Remove action", "Remove", () => steps.splice(index, 1), false],
    ]) {
      const control = button(text, () => change(fn));
      control.setAttribute("aria-label", label);
      control.disabled = disabled;
      controls.append(control);
    }
    return controls;
  }
  const api = {
    host,
    read,
    add(step) {
      if (options.parallel && steps.length >= 8)
        throw Error("A Together block can start up to eight steps.");
      if (!change(() => steps.push(clone(step)))) throw Error(notice.textContent);
    },
    append(step) {
      const target = shared.active && host.contains(shared.active.host) ? shared.active : api;
      target.add(step);
    },
    replace(value) {
      steps = clone(value);
      draw();
    },
  };
  const selectTarget = button("Add actions here", () => {
    shared.active = api;
    const root = host.closest("dialog") || host;
    root
      .querySelectorAll("[data-flow-selected]")
      .forEach((node) => delete node.dataset.flowSelected);
    host.dataset.flowSelected = "true";
  });
  selectTarget.className = "deckFlowSelectTarget";
  selectTarget.setAttribute("aria-label", "Add library actions to " + title);
  heading.after(selectTarget);
  function draw() {
    readers = [];
    list.replaceChildren();
    steps.forEach((step, index) => {
      if (["remember", "restore"].includes(step.type)) {
        const card = el("div", "deckStep deckFlowGroup");
        card.dataset.stepKind = step.type;
        card.append(
          el(
            "h4",
            "deckFlowKind",
            step.type === "remember" ? "REMEMBER · Current values" : "RESTORE · Previous values",
          ),
          el(
            "p",
            "deckEditorHint",
            step.type === "remember"
              ? "Save OBS visibility, scenes, filters and audio values before changing them. A matching Restore returns them exactly; Stop or a failed flow also restores them. Other actions cannot be undone."
              : "Return the values saved by the most recent Remember step.",
          ),
          controlsFor(index),
        );
        readers.push(() => ({ type: step.type }));
        list.append(card);
        return;
      }
      if (step.type) {
        const card = el("div", "deckStep deckFlowGroup");
        card.dataset.stepKind = step.type;
        card.append(
          el(
            "h4",
            "deckFlowKind",
            step.type === "if"
              ? "IF · Then / Otherwise"
              : step.type === "parallel"
                ? "DO TOGETHER"
                : step.type === "sequence"
                  ? "DO IN ORDER"
                  : "REPEAT",
          ),
        );
        readers.push(
          buildFlowGroup(card, step, {
            catalog,
            sendKey,
            build: buildActionSteps,
            depth,
            shared,
            parallel: options.parallel || options.inParallel,
            trigger: options.trigger,
          }),
        );
        card.append(controlsFor(index));
        list.append(card);
        return;
      }
      const waiting = step.actionId === WAIT,
        card = el("div", "deckStep"),
        row = el("div", "deckStepHeading"),
        choice = el("select");
      card.dataset.stepKind = waiting ? "wait" : "action";
      choice.setAttribute("aria-label", `${title}, action ${index + 1}`);
      const groups = new Map();
      for (const action of catalog) {
        if (!groups.has(action.group)) {
          const group = el("optgroup");
          group.label = action.group;
          groups.set(action.group, group);
          choice.append(group);
        }
        groups
          .get(action.group)
          .append(
            new Option(
              action.label +
                (action.available === false
                  ? " · " + (action.unavailableReason || "unavailable")
                  : ""),
              action.id,
            ),
          );
      }
      if (!catalog.some((action) => action.id === step.actionId))
        choice.add(
          new Option("Unavailable: " + (step.actionId || "choose an action"), step.actionId || ""),
        );
      choice.value = step.actionId;
      card.append(el("div", "deckFlowKind", waiting ? "WAIT" : "THEN · Do action"));
      row.append(el("span", "deckStepNumber", String(index + 1)), choice);
      const params = el("div", "deckStepParameters"),
        action = presentAction(catalog.find((a) => a.id === step.actionId));
      const wait = waiting && durationField(step.params.durationMs, "Wait for");
      const parameters = waiting
        ? null
        : action
          ? parameterForm(
              params,
              action.parameters || {},
              step.params,
              action.id === "native.hotkey" ? sendKey : undefined,
            )
          : () => clone(step.params || {});
      // Earlier before-action delays remain editable; new sequences use visible wait blocks.
      const delay = step.delayMs ? durationField(step.delayMs, "Wait before action") : null;
      const controls = controlsFor(index);
      card.append(row);
      if (waiting) card.append(wait.field);
      else {
        if (action?.description) card.append(el("p", "deckEditorHint", action.description));
        if (action?.available === false && action.unavailableReason)
          card.append(
            el("p", "deckEditorHint", "Action unavailable: " + action.unavailableReason + "."),
          );
        card.append(params);
      }
      if (delay) card.append(delay.field);
      card.append(controls);
      list.append(card);
      readers.push((validate = true) => {
        if (!choice.value) throw Error("Choose an action.");
        const values = waiting ? { durationMs: wait.read(validate) } : parameters(validate);
        const trigger = options.trigger?.();
        if (
          validate &&
          trigger &&
          ["twitch.action.shoutout", "twitch.action.bot-shoutout"].includes(choice.value) &&
          values.target === "raider" &&
          (trigger.type !== "event" || trigger.event !== "channel.raid")
        )
          throw Error(
            "Incoming raider is supplied by an Incoming raid trigger. Choose that trigger, or select a fixed recipient for this action.",
          );
        return {
          actionId: choice.value,
          params: values,
          delayMs: delay?.read(validate) || 0,
        };
      });
      choice.onchange = () => {
        try {
          steps = readers.map((get, at) => (at === index ? steps[at] : get(false)));
        } catch (error) {
          notice.textContent = error.message;
          return;
        }
        const action = catalog.find((a) => a.id === choice.value);
        steps[index] = {
          actionId: choice.value,
          params: clone(action?.defaults || {}),
          delayMs: delay?.read(false) || 0,
        };
        draw();
      };
    });
    for (const control of tools.querySelectorAll("button"))
      control.disabled =
        (options.parallel && steps.length >= 8) ||
        (control.dataset.flowGroup === "true" && depth >= 6) ||
        (control.dataset.flowParallel === "true" && (options.parallel || options.inParallel)) ||
        (control.dataset.flowRestore === "true" && (options.parallel || options.inParallel)) ||
        (control.textContent === "Wait first" && options.parallel);
    host.dispatchEvent(new Event("ravelink-sequence-change", { bubbles: true }));
  }
  tools.append(
    button("+ Add action", () =>
      change(() => {
        const step = defaultStep();
        if (step) steps.push(step);
      }),
    ),
    button("+ Add wait", () => change(() => steps.push(waitStep()))),
    button("Wait first", () => change(() => steps.unshift(waitStep()))),
    button("Action → wait → action", () =>
      change(() => {
        const step = defaultStep();
        if (step) {
          const timed = [step, waitStep(), clone(step)];
          if (options.parallel) steps.push({ type: "sequence", steps: timed });
          else steps.push(...timed);
        }
      }),
    ),
  );
  for (const [label, kind, create] of [
    [
      "+ Add condition",
      "if",
      () => ({
        type: "if",
        condition: {
          actionId: (catalog.find((a) => a.id !== WAIT) || {}).id || "missing",
          field: "available",
          operator: "equals",
          value: true,
        },
        then: [],
        else: [],
      }),
    ],
    ["+ Do together", "parallel", () => ({ type: "parallel", steps: [] })],
    ["+ Do in order", "sequence", () => ({ type: "sequence", steps: [] })],
    ["+ Repeat block", "repeat", () => ({ type: "repeat", count: 2, steps: [] })],
  ]) {
    const control = button(label, () => change(() => steps.push(create())));
    control.dataset.flowGroup = "true";
    if (kind === "parallel") control.dataset.flowParallel = "true";
    tools.append(control);
  }
  for (const type of ["remember", "restore"]) {
    const control = button(
      type === "remember" ? "+ Remember current values" : "+ Restore previous values",
      () => change(() => steps.push({ type })),
    );
    control.dataset.flowRestore = "true";
    tools.append(control);
  }
  draw();
  return api;
}
