/** Scheduling belongs to Core, so a closed browser cannot lose a pending step. */
const WAIT = "deck.wait";
const MAX_WAIT = 86400000;
const waitAction = {
  id: WAIT,
  label: "Wait",
  group: "Sequence",
  symbol: "\u23f1",
  available: true,
  description: "Wait, then continue with the next step. Timers run on the Groby’s Deck PC.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["durationMs"],
    properties: { durationMs: { type: "integer", minimum: 1, maximum: MAX_WAIT } },
  },
  defaults: { durationMs: 5000 },
};
module.exports = { WAIT, MAX_WAIT, waitAction };
