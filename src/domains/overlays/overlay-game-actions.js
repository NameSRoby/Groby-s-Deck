/** Normal deck actions; no private action path or widget-specific automation runner. */
function rows(documents) {
  return documents.flatMap((doc) =>
    doc.widgets
      .filter((w) => ["wheel", "bingo", "chat-vote"].includes(w.type))
      .map((w) => ({
        key: doc.id + "/" + w.id,
        title: doc.name + " / " + w.name,
        type: w.type,
        entrySource: w.entrySource,
      })),
  );
}
exports.catalog = (documents) =>
  [
    ["collect", "Open wheel chat entries", ["wheel"]],
    ["close-entries", "Close wheel chat entries", ["wheel"]],
    ["spin", "Spin wheel", ["wheel"]],
    ["start", "Start chat vote", ["chat-vote"]],
    ["close", "Close chat vote", ["chat-vote"]],
    ["mark", "Toggle bingo square", ["bingo"]],
    ["reset", "Reset overlay game", ["wheel", "bingo", "chat-vote"]],
  ]
    .map(([operation, label, types]) => {
      const choices = rows(documents).filter(
        (w) =>
          types.includes(w.type) &&
          (!["collect", "close-entries"].includes(operation) || w.entrySource === "chat"),
      );
      return {
        id: "overlay.game." + operation,
        label,
        group: "Overlay games",
        symbol: "\u25c8",
        available: !!choices.length,
        description: "Controls a saved overlay widget. All OBS sources share its result.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: operation === "mark" ? ["widget", "cell"] : ["widget"],
          properties: {
            widget: {
              type: "string",
              title: "Overlay / widget",
              enum: choices.map((w) => w.key),
              enumNames: Object.fromEntries(choices.map((w) => [w.key, w.title])),
            },
            ...(operation === "mark"
              ? { cell: { type: "integer", title: "Square number", minimum: 1, maximum: 100 } }
              : {}),
          },
        },
        defaults: { widget: choices[0]?.key || "", ...(operation === "mark" ? { cell: 1 } : {}) },
      };
    })
    .filter((action) => action.available);
exports.execute = (id, input, documents, control) => {
  const operation = id.slice("overlay.game.".length),
    action = exports.catalog(documents).find((row) => row.id === id);
  if (!action || !action.parameters.properties.widget.enum.includes(input?.widget))
    throw Error("Choose a saved overlay game.");
  const [documentId, widgetId] = input.widget.split("/");
  return control({ documentId, widgetId, operation, cell: input.cell });
};
