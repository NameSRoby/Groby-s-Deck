/** Normal deck actions; no private action path or widget-specific automation runner. */
const { markTypes, types: gameTypes } = require("../../../public/core/overlay-game-rules");
const { boardLimit, matchPairLimit } = require("../../../public/core/overlay-model");
function rows(documents) {
  return documents.flatMap((doc) =>
    doc.widgets
      .filter((w) => gameTypes.includes(w.type))
      .map((w) => ({
        key: doc.id + "/" + w.id,
        title: doc.name + " / " + w.name,
        type: w.type,
        entrySource: w.entrySource,
      })),
  );
}
exports.catalog = (documents) => {
  const widgets = rows(documents);
  return [
    ["collect", "Open wheel chat entries", ["wheel"]],
    ["close-entries", "Close wheel chat entries", ["wheel"]],
    ["spin", "Spin wheel", ["wheel"]],
    ["start", "Start chat vote", ["chat-vote"]],
    ["close", "Close chat vote", ["chat-vote"]],
    ["mark", "Toggle board square", markTypes, boardLimit],
    ["flip", "Flip a Tile Match card", ["tile-match"], matchPairLimit * 2],
    ["reset", "Reset overlay game", gameTypes],
  ]
    .map(([operation, label, types, cellLimit]) => {
      const choices = widgets.filter(
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
          required: cellLimit ? ["widget", "cell"] : ["widget"],
          properties: {
            widget: {
              type: "string",
              title: "Overlay / widget",
              enum: choices.map((w) => w.key),
              enumNames: Object.fromEntries(choices.map((w) => [w.key, w.title])),
            },
            ...(cellLimit
              ? {
                  cell: {
                    type: "integer",
                    title: operation === "flip" ? "Tile number" : "Square number",
                    minimum: 1,
                    maximum: cellLimit,
                  },
                }
              : {}),
          },
        },
        defaults: { widget: choices[0]?.key || "", ...(cellLimit ? { cell: 1 } : {}) },
      };
    })
    .filter((action) => action.available);
};
exports.execute = (id, input, documents, control) => {
  const operation = id.slice("overlay.game.".length),
    action = exports.catalog(documents).find((row) => row.id === id);
  if (!action || !action.parameters.properties.widget.enum.includes(input?.widget))
    throw Error("Choose a saved overlay game.");
  const [documentId, widgetId] = input.widget.split("/");
  return control({ documentId, widgetId, operation, cell: input.cell });
};
