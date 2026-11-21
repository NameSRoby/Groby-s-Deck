/** Decisions read current owner feedback; unknown state never silently takes Else. */
const { WAIT } = require("./deck-sequence");
module.exports = function flowRunner({ actions, describe, delay, changed, now, isClosed, fault }) {
  const restoration = require("./deck-flow-restore")(actions, fault);
  function condition(rule, item) {
    if (rule.field === "available") return compare(item?.available === true, rule);
    const state = item?.state;
    if (
      !item?.available ||
      state === null ||
      state === undefined ||
      (typeof state === "object" &&
        ["unknown", "unconfirmed", "unavailable", "disconnected", "error", "failed"].includes(
          state.tone || state.status || state.state,
        ))
    )
      throw fault("control_deck_condition_unavailable");
    const value =
      rule.field === "active"
        ? typeof state === "boolean"
          ? state
          : state.active
        : rule.field === "muted"
          ? state.muted
          : rule.field === "value"
            ? typeof state === "number"
              ? state
              : (state.value ?? state.level)
            : typeof state === "string"
              ? state
              : (state.status ?? state.state ?? state.tone);
    if (
      !["boolean", "number", "string"].includes(typeof value) ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      throw fault("control_deck_condition_unavailable");
    return compare(value, rule);
  }
  function compare(value, rule) {
    if (typeof value !== typeof rule.value) throw fault("control_deck_condition_unavailable");
    if (rule.operator === "equals") return value === rule.value;
    if (rule.operator === "not-equals") return value !== rule.value;
    if (typeof value !== "number") throw fault("control_deck_condition_unavailable");
    return rule.operator === "greater" ? value > rule.value : value < rule.value;
  }
  return async function perform(run, steps) {
    const saved = restoration(run.runId);
    let processed = 0;
    const check = (signal) => {
      if (isClosed() || signal.aborted) throw fault("control_deck_cancelled");
      run.guard?.();
    };
    const progress = (index, phase, detail, waitUntil = null) => {
      Object.assign(run, { step: index + 1, phase, detail, waitUntil });
      changed();
    };
    async function walk(nodes, signal, outerIndex, path = "") {
      check(signal);
      describe(nodes);
      for (const [index, node] of nodes.entries()) {
        if (++processed > 100000) throw fault("control_deck_flow_budget");
        if (processed % 32 === 0) await new Promise(setImmediate);
        check(signal);
        const at = outerIndex ?? index;
        const waiting = async (ms) => {
          if (!ms) return;
          progress(at, "waiting", path, now() + ms);
          await delay(ms, signal);
          check(signal);
        };
        if (node.type === "remember") saved.remember();
        else if (node.type === "restore") {
          progress(at, "restore", "Restoring previous values");
          await saved.restore();
          check(signal);
        } else if (node.type === "if") {
          progress(at, "condition", "Checking condition");
          let item;
          if (node.condition.actionId.startsWith("twitch.event."))
            item = require("../twitch/twitch-event-conditions").read(node.condition, run.context);
          else if (actions.conditionState) item = await actions.conditionState(node.condition);
          else {
            await (actions.refresh?.() || actions.refreshLive?.());
            item = actions.catalog().find((row) => row.id === node.condition.actionId);
          }
          check(signal);
          const branch = condition(node.condition, item);
          await walk(branch ? node.then : node.else, signal, at, branch ? "Then" : "Otherwise");
        } else if (node.type === "sequence") {
          await walk(node.steps, signal, at, "In order");
        } else if (node.type === "repeat") {
          for (let count = 0; count < node.count; count++) {
            check(signal);
            await walk(node.steps, signal, at, `Repeat ${count + 1}/${node.count}`);
          }
        } else if (node.type === "parallel") {
          describe(node.steps);
          const controller = new AbortController(),
            combined = AbortSignal.any([signal, controller.signal]);
          let failure;
          progress(at, "parallel", "Do together");
          await Promise.allSettled(
            node.steps.map((child) =>
              walk([child], combined, at, "Together").catch((error) => {
                failure ||= error;
                controller.abort();
              }),
            ),
          );
          if (failure) throw failure;
          check(signal);
        } else {
          await waiting(node.delayMs);
          check(signal);
          describe([node]);
          if (node.actionId === WAIT) {
            await waiting(node.params.durationMs);
            continue;
          }
          progress(at, "action", path);
          await saved.capture(node.actionId, node.params, signal);
          const params = await require("../twitch/twitch-automation-context").parameters(
            node.actionId,
            structuredClone(node.params),
            run.context,
            signal,
          );
          check(signal);
          const result = await actions.execute(node.actionId, params, signal);
          if (result?.ok === false || result?.value?.ok === false) {
            const detail = result.value || result,
              code = detail.reason || detail.code || detail.error?.code || detail.error;
            throw fault(
              typeof code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(code)
                ? code
                : "control_deck_action_failed",
            );
          }
        }
      }
    }
    try {
      for (let iteration = 1; iteration <= run.repeats; iteration++) {
        run.iteration = iteration;
        await walk(steps, run.controller.signal);
      }
      check(run.controller.signal);
    } finally {
      await saved.finish();
    }
  };
};
