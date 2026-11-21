/** Saved commands keep readable authoring text; only rendering compiles VM instructions. */
module.exports = require("./command-source-storage")(
  require("./command-variables").compile,
  require("./command-syntax-migration").modernize,
);
