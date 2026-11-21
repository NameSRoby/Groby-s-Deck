/** Flow data is a closed tree of approved actions, never an expression language. */
const { MAX_WAIT } = require("./deck-sequence");
const FIELDS = ["available", "active", "muted", "value", "status"];
const OPERATORS = ["equals", "not-equals", "greater", "less"];
function normalize(value = [], guards, depth = 0, inParallel = false) {
  const { fault, closed, json, id } = guards;
  const invalid = () => {
    throw fault("control_deck_steps_invalid");
  };
  if (!Array.isArray(value) || depth > 6) invalid();
  return value.map((node) => {
    if (["remember", "restore"].includes(node?.type)) {
      if (!closed(node, ["type"]) || inParallel) invalid();
      return { type: node.type };
    }
    if (node?.type === "if") {
      const c = node.condition;
      if (
        !closed(node, ["type", "condition", "then", "else"]) ||
        !closed(c, ["actionId", "field", "operator", "value"]) ||
        !id(c.actionId) ||
        !FIELDS.includes(c.field) ||
        !OPERATORS.includes(c.operator) ||
        !["boolean", "number", "string"].includes(typeof c.value) ||
        (typeof c.value === "number" && !Number.isFinite(c.value)) ||
        (typeof c.value === "string" && c.value.length > 160) ||
        (["greater", "less"].includes(c.operator) && typeof c.value !== "number") ||
        (c.field === "value" && typeof c.value !== "number") ||
        (c.field === "status" && typeof c.value !== "string") ||
        (["available", "active", "muted"].includes(c.field) &&
          (typeof c.value !== "boolean" || !["equals", "not-equals"].includes(c.operator)))
      )
        invalid();
      const yes = normalize(node.then, guards, depth + 1, inParallel),
        no = normalize(node.else, guards, depth + 1, inParallel);
      if (!yes.length && !no.length) invalid();
      return { type: "if", condition: { ...c }, then: yes, else: no };
    }
    if (["parallel", "repeat", "sequence"].includes(node?.type)) {
      if (
        !closed(node, node.type === "repeat" ? ["type", "count", "steps"] : ["type", "steps"]) ||
        (node.type === "repeat" &&
          (!Number.isInteger(node.count) || node.count < 1 || node.count > 1000)) ||
        (node.type === "parallel" &&
          (inParallel || !Array.isArray(node.steps) || node.steps.length > 8))
      )
        invalid();
      const children = normalize(
        node.steps,
        guards,
        depth + 1,
        inParallel || node.type === "parallel",
      );
      if (!children.length) invalid();
      return {
        type: node.type,
        ...(node.type === "repeat" ? { count: node.count } : {}),
        steps: children,
      };
    }
    const delayMs = node?.delayMs ?? 0,
      params = node?.params ?? {};
    if (
      !closed(node, ["actionId", "params", "delayMs"]) ||
      !id(node.actionId) ||
      !json(params) ||
      JSON.stringify(params).length > 16384 ||
      !Number.isInteger(delayMs) ||
      delayMs < 0 ||
      delayMs > MAX_WAIT
    )
      invalid();
    return { actionId: node.actionId, params: structuredClone(params), delayMs };
  });
}
function leaves(nodes) {
  return nodes.flatMap((node) =>
    node.type === "if"
      ? leaves([...node.then, ...node.else])
      : node.type
        ? leaves(node.steps || [])
        : [node],
  );
}
module.exports = { normalize, leaves };
