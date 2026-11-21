/** Data-only repair for action IDs renamed during the Groby's Deck rebrand.
 * Folder moves never change identity. No runtime aliases or mod grants are added.
 */
const renamed = new Map([["mod:ravelink.twitch-clips:create", "mod:groby.twitch-clips:create"]]);
const canonicalId = (id) => renamed.get(id) || id;
const children = [
  "pages",
  "buttons",
  "steps",
  "alternateSteps",
  "holdSteps",
  "then",
  "else",
  "condition",
];
module.exports = function migrateActionReferences(value) {
  if (Array.isArray(value)) return value.map(migrateActionReferences);
  if (!value || typeof value !== "object") return value;
  const next = { ...value };
  if (renamed.has(next.actionId)) next.actionId = renamed.get(next.actionId);
  for (const key of children)
    if (Object.hasOwn(next, key)) next[key] = migrateActionReferences(next[key]);
  return next;
};
module.exports.canonicalId = canonicalId;
