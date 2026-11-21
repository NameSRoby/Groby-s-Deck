/** The example is data: every rule and narrative is editable public syntax. */
const { stages } = require("../../../public/core/recipes/d20-arena.json");
module.exports = { stages, message: stages.map((stage) => stage.source).join("\n\n") };
