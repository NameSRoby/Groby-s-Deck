/** Private macro configuration and cancellable, single-flight button lifetimes. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { validate, defaults, fault } = require("./control-deck-config");
const { validateValue } = require("../../shared/contracts/bounded-json-schema");
const { waitAction } = require("./deck-sequence");
module.exports = function createControlDeck({ runtimeDir, actions, widgets, now = Date.now }) {
  const file = path.join(runtimeDir, "system", "control-deck.json");
  const styles = require("./deck-style-profiles")(runtimeDir);
  let config = defaults(),
    revision = 0,
    closed = false,
    audioPageAdded = true;
  const running = new Map(),
    states = new Map();
  const live = require("./control-deck-live")({
    read: () => ({
      snapshot: snapshot(),
      catalog: catalog(),
    }),
    refresh: refreshLive,
    subscribe: actions.subscribe,
  });
  try {
    const stat = fs.lstatSync(file);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 300000) {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      config = validate(saved.config);
      audioPageAdded = saved.audioPageAdded === true;
      revision = Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0;
    }
  } catch {
    /* A new or corrupt local layout starts with usable controls. */
  }
  let migrated = require("./retire-discord-controls")(config);
  try {
    const source = require("../twitch/command-source-fields"),
      next = source.messages(require("../../shared/fs/migrate-action-references")(migrated));
    if (JSON.stringify(next) !== JSON.stringify(migrated)) {
      source.backup(file, { version: 1, revision, audioPageAdded, config });
      migrated = next;
    }
  } catch {
    // Keep an invalid draft available for correction; it cannot pass Save validation.
  }
  if (!audioPageAdded) {
    migrated.pages = require("./audio-mixer-page").ensure(migrated.pages);
    audioPageAdded = true;
  }
  if (JSON.stringify(migrated) !== JSON.stringify(config)) save(migrated, revision);
  function refreshLive() {
    void widgets?.refresh(config);
    return actions.refreshLive?.() || actions.refresh?.();
  }
  function snapshot() {
    return {
      revision,
      config: structuredClone(config),
      running: [...running.values()].map(
        ({
          runId,
          buttonId,
          step,
          total,
          startedAt,
          phase,
          waitUntil,
          iteration,
          repeats,
          detail,
        }) => ({
          runId,
          buttonId,
          step,
          total,
          startedAt,
          phase,
          waitUntil,
          iteration,
          repeats,
          detail,
        }),
      ),
      states: Object.fromEntries([...states].map(([id, state]) => [id, { ...state }])),
      actionStates: actions.feedback?.() || {},
      windowsAudio: actions.windowsAudio?.(),
      widgetData: widgets?.snapshot(),
    };
  }
  function save(value, expected) {
    if (closed) throw fault("control_deck_closed");
    if (expected !== revision) throw fault("control_deck_revision_conflict");
    const next = validate(
      require("../twitch/command-source-fields").messages(
        require("../../shared/fs/migrate-action-references")(value),
      ),
    );
    if (running.size) throw fault("control_deck_busy");
    if (JSON.stringify(styles.capture(config)) !== JSON.stringify(styles.capture(next)))
      styles.backup(config);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file + ".tmp",
      JSON.stringify({ version: 1, revision: revision + 1, audioPageAdded, config: next }) + "\n",
      { mode: 0o600 },
    );
    fs.renameSync(file + ".tmp", file);
    const prior = new Map(
      config.pages.flatMap((page) =>
        page.buttons.map((button) => [
          button.id,
          JSON.stringify([
            button.kind,
            button.steps,
            button.alternateSteps,
            button.holdSteps,
            button.repeatCount,
          ]),
        ]),
      ),
    );
    for (const button of next.pages.flatMap((page) => page.buttons))
      if (
        prior.get(button.id) !==
        JSON.stringify([
          button.kind,
          button.steps,
          button.alternateSteps,
          button.holdSteps,
          button.repeatCount,
        ])
      )
        states.delete(button.id);
    config = next;
    revision++;
    live.changed();
    const ids = new Set(config.pages.flatMap((p) => p.buttons.map((b) => b.id)));
    for (const id of states.keys()) if (!ids.has(id)) states.delete(id);
    return snapshot();
  }
  function delay(ms, signal) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        reject(fault("control_deck_cancelled"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", stop);
        resolve();
      }, ms);
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
    });
  }
  function describe(steps) {
    const descriptors = new Map(catalog().actions.map((a) => [a.id, a]));
    return steps
      .filter((step) => !step.type)
      .map((step) => {
        const item = descriptors.get(step.actionId);
        if (!item?.available) throw fault("control_deck_action_unavailable");
        if (!validateValue(item.parameters || {}, step.params))
          throw fault("control_deck_parameters_invalid");
        return item;
      });
  }
  const runFlow = require("./deck-flow-runner")({
    actions,
    describe,
    delay,
    changed: live.changed,
    now,
    isClosed: () => closed,
    fault,
  });
  async function perform(run, button, steps) {
    let successful = false,
      code = "completed";
    try {
      await runFlow(run, steps);
      successful = true;
    } catch (error) {
      code = /^[a-z][a-z0-9_]{0,79}$/.test(error?.code || "")
        ? error.code
        : "control_deck_action_failed";
    } finally {
      const old = states.get(button.id) || { toggled: false };
      states.set(button.id, {
        toggled:
          successful && button.alternateSteps.length && run.trigger === "press"
            ? !old.toggled
            : old.toggled,
        lastResult: { ok: successful, code },
        lastRunAt: now(),
      });
      running.delete(run.runId);
      live.changed();
    }
    return { ok: successful, code };
  }
  function execute(buttonId, trigger = "press", value) {
    if (closed) throw fault("control_deck_closed");
    if (!["press", "hold"].includes(trigger)) throw fault("control_deck_trigger_invalid");
    const button = config.pages.flatMap((p) => p.buttons).find((b) => b.id === buttonId);
    if (!button || !["macro", "slider"].includes(button.kind))
      throw fault("control_deck_button_invalid");
    const active = [...running.values()].find((r) => r.buttonId === buttonId);
    if (active && button.cancelOnPress && trigger === "press") {
      active.controller.abort();
      return { runId: active.runId, buttonId, cancelled: true };
    }
    if (running.size >= 8 || active) throw fault("control_deck_busy");
    const steps = structuredClone(
      trigger === "hold"
        ? button.holdSteps
        : states.get(button.id)?.toggled && button.alternateSteps.length
          ? button.alternateSteps
          : button.steps,
    );
    if (button.kind === "slider") {
      const action = actions.catalog().find((a) => a.id === steps[0].actionId),
        control = action?.control;
      if (
        trigger !== "press" ||
        control?.type !== "slider" ||
        typeof control.parameter !== "string" ||
        !Number.isFinite(value) ||
        value < control.min ||
        value > control.max ||
        Math.abs(
          (value - control.min) / control.step - Math.round((value - control.min) / control.step),
        ) > 1e-6
      )
        throw fault("control_deck_slider_invalid");
      steps[0].params[control.parameter] = value;
    } else if (value !== undefined) throw fault("control_deck_slider_invalid");
    return start(button, steps, trigger);
  }
  function start(button, steps, trigger, completion = false, guard, context) {
    const buttonId = button.id;
    if (closed) throw fault("control_deck_closed");
    if (running.size >= 8 || [...running.values()].some((run) => run.buttonId === buttonId))
      throw fault("control_deck_busy");
    if (!steps.length) throw fault("control_deck_trigger_empty");
    const descriptors = describe(steps);
    const run = {
      runId: crypto.randomBytes(12).toString("hex"),
      buttonId,
      trigger,
      controller: new AbortController(),
      step: 0,
      total: steps.length,
      startedAt: now(),
      phase: "action",
      waitUntil: null,
      iteration: 1,
      repeats: button.repeatCount || 1,
      promise: null,
      guard,
      context,
    };
    running.set(run.runId, run);
    live.changed();
    run.promise = Promise.resolve().then(() =>
      perform(run, structuredClone(button), structuredClone(steps)),
    );
    return {
      runId: run.runId,
      buttonId,
      ...(completion ? { completion: run.promise } : {}),
      ...(steps.length === 1 && descriptors[0]?.navigation
        ? { navigation: descriptors[0].navigation }
        : {}),
    };
  }
  function cancel(runId) {
    if (runId !== undefined && (typeof runId !== "string" || !/^[a-f0-9]{24}$/.test(runId)))
      throw fault("control_deck_run_invalid");
    let cancelled = 0;
    for (const run of running.values())
      if (!runId || run.runId === runId) {
        run.controller.abort();
        cancelled++;
      }
    return { cancelled };
  }
  async function shutdown() {
    closed = true;
    live.close();
    cancel();
    await Promise.allSettled([...running.values()].map((r) => r.promise));
  }
  function catalog() {
    return { actions: [...actions.catalog(), waitAction], modGuidance: actions.guidance?.() || "" };
  }
  return Object.freeze({
    snapshot,
    save,
    styleProfiles: styles.list,
    saveStyleProfile(input) {
      if (input.revision !== revision) throw fault("control_deck_revision_conflict");
      return styles.save(input, config);
    },
    restoreStyleProfile(input) {
      return save(styles.apply(input, config), input.revision);
    },
    deleteStyleProfile: styles.remove,
    execute,
    runAutomation(id, steps, guard, context) {
      if (
        typeof id !== "string" ||
        !/^[a-f0-9]{24}$/.test(id) ||
        JSON.stringify(steps).length > 120000
      )
        throw fault("control_deck_automation_invalid");
      const normalized = require("./control-deck-config").steps(steps);
      return start(
        { id: "twitch:" + id, alternateSteps: [], repeatCount: 1 },
        normalized,
        "press",
        true,
        guard,
        context,
      );
    },
    cancel,
    refresh: actions.refresh,
    refreshLive,
    live,
    catalog,
    shutdown,
  });
};
