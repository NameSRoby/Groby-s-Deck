/** Embed the same flow editor used by deck buttons into the sandboxed Twitch page. */
const path = require("node:path");
const { read, replaceBlock, syncFile } = require("./lib/embedded-assets");
const root = path.resolve(__dirname, "..");
const manual = require("./lib/command-manual");
syncFile(
  path.join(root, "features/twitch-integration/ui/syntax.html"),
  (content) =>
    replaceBlock(
      content,
      "<!-- LANGUAGE_MANUAL_START -->",
      "<!-- LANGUAGE_MANUAL_END -->",
      "\n" +
        replaceBlock(
          read(path.join(root, "features/twitch-integration/ui/command-manual.html")),
          "<!-- OPERATOR_TABLES_START -->",
          "<!-- OPERATOR_TABLES_END -->",
          "\n" + manual.html() + "\n",
        ) +
        "\n",
    ),
  { check: process.argv.includes("--check") },
);
syncFile(
  path.join(root, "docs/COMMAND-VARIABLES.md"),
  (content) =>
    replaceBlock(
      content,
      "<!-- OPERATOR_MANUAL_START -->",
      "<!-- OPERATOR_MANUAL_END -->",
      "\n\n" + manual.markdown() + "\n\n",
    ),
  { check: process.argv.includes("--check") },
);
const dialogScript = read(path.join(root, "public/core/visible-dialog.js")).replace(
  /export function /g,
  "function ",
);
const dialogStyle = read(path.join(root, "public/core/visible-dialog.css"));
syncFile(
  path.join(root, "features/twitch-integration/ui/quotes.html"),
  (content) =>
    replaceBlock(
      content,
      "<!-- QUOTE_PARSER_START -->",
      "<!-- QUOTE_PARSER_END -->",
      "\n<script>const QuoteImport={parse:" +
        require("../src/domains/twitch/quote-import").parse.toString() +
        "};</script>\n",
    ),
  { check: process.argv.includes("--check") },
);
syncFile(
  path.join(root, "features/twitch-integration/ui/quotes.html"),
  (content) =>
    replaceBlock(
      content,
      "<!-- QUOTE_MANAGER_START -->",
      "<!-- QUOTE_MANAGER_END -->",
      "\n<style>\n" +
        dialogStyle +
        "\n</style><script>\n" +
        dialogScript +
        "\n" +
        read(path.join(root, "features/twitch-integration/ui/quotes-manager.js")) +
        "\n</script>\n",
    ),
  { check: process.argv.includes("--check") },
);
syncFile(
  path.join(root, "features/twitch-integration/dist/variable-recipe-storage.js"),
  () => '"use strict";\n' + read(path.join(root, "src/domains/twitch/command-source-storage.js")),
  { check: process.argv.includes("--check") },
);
const variables = require("../src/domains/twitch/command-variables");
const variableArena = require("../src/domains/twitch/command-arena-variables");
const variableCatalog = require("../src/domains/twitch/command-variable-guide");
const tokenize = require("../src/domains/twitch/command-syntax-tokens");
const editorStyle = read(path.join(root, "public/core/command-code-editor.css"));
const editorScript =
  "const commandTokens = (" +
  tokenize.toString() +
  ")(" +
  JSON.stringify(variableCatalog) +
  ");\n" +
  read(path.join(root, "public/core/command-code-editor.js"))
    .replace(/^import .*;\n/gm, "")
    .replace(/export function /g, "function ");
syncFile(
  path.join(root, "public/core/command-syntax-tokens.js"),
  () =>
    'import { COMMAND_VARIABLES } from "./command-variable-catalog.js";\nexport const commandTokens = (' +
    tokenize.toString() +
    ")(COMMAND_VARIABLES);\n",
  { check: process.argv.includes("--check") },
);
syncFile(
  path.join(root, "features/twitch-integration/ui/syntax.html"),
  (content) =>
    replaceBlock(
      content,
      "<!-- COMMAND_EDITOR_START -->",
      "<!-- COMMAND_EDITOR_END -->",
      "\n<style>\n" + editorStyle + "\n</style><script>\n" + editorScript + "\n</script>\n",
    ),
  { check: process.argv.includes("--check") },
);
syncFile(
  path.join(root, "public/core/command-variable-catalog.js"),
  () =>
    "// Generated from the canonical command reference.\nexport const COMMAND_VARIABLES = " +
    JSON.stringify(variableCatalog) +
    ";\n",
  { check: process.argv.includes("--check") },
);
for (const [target, source] of [
  ["variable-arguments", "command-variable-arguments"],
  ["syntax-migration", "command-syntax-migration"],
])
  syncFile(
    path.join(root, "features/twitch-integration/dist/" + target + ".js"),
    () =>
      '"use strict";\n' +
      read(path.join(root, "src/domains/twitch/" + source + ".js"))
        .replace('require("./command-arena-variables")', 'require("./arena-language.json")')
        .replace('require("./command-variable-arguments")', 'require("./variable-arguments")'),
    { check: process.argv.includes("--check") },
  );
syncFile(
  path.join(root, "features/twitch-integration/dist/variable-recipe.js"),
  () =>
    "const compile = " +
    variables.compile
      .toString()
      .replace('require("./command-variable-arguments")', 'require("./variable-arguments")') +
    ';\nconst modernize = require("./syntax-migration").modernize' +
    ";\nmodule.exports=require('./variable-recipe-storage')(compile, modernize);\n",
  { check: process.argv.includes("--check") },
);
syncFile(
  path.join(root, "features/twitch-integration/dist/arena-language.json"),
  () =>
    JSON.stringify(
      {
        message: variableArena.message,
        stages: variableArena.stages,
      },
      null,
      2,
    ) + "\n",
  { check: process.argv.includes("--check") },
);
const presets = require("../src/domains/twitch/command-presets");
const modules = [
  ["action-presentation", ["presentAction"]],
  ["sound-fields", ["attachSoundField", "readSoundOutputs"]],
  ["parameters", ["parameterForm"]],
  ["flow-groups", ["buildFlowGroup"]],
  ["steps", ["buildActionSteps"]],
];
syncFile(
  path.join(root, "features/twitch-integration/ui/syntax.html"),
  (content) =>
    replaceBlock(
      content,
      "<!-- TEMPLATE_CATALOG_START -->",
      "<!-- TEMPLATE_CATALOG_END -->",
      "\n<script>const GrobyTemplateCatalog = " +
        JSON.stringify(require("../src/domains/twitch/command-variable-guide")) +
        ";const GrobyCommandPresets = " +
        JSON.stringify(presets) +
        ";</script>\n",
    ),
  { check: process.argv.includes("--check") },
);
const js = [
  "const DeckFlow = {};",
  read(path.join(root, "public/core/soundboard-errors.js")).replace(/export const /g, "const "),
  editorScript,
  "const COMMAND_VARIABLES = " + JSON.stringify(variableCatalog) + ";",
  "const calendarDateAfter = " +
    require("../src/domains/twitch/calendar-schedule").advance.toString() +
    ";",
  dialogScript,
  read(path.join(root, "public/core/pill-input.js")).replace(/export function /g, "function "),
  read(path.join(root, "features/twitch-integration/ui/duration-input.js")),
  "const GrobyVariablePresets=" + JSON.stringify(presets) + ";",
  "const GrobyBuiltinPresets=" +
    JSON.stringify(require("../src/domains/twitch/builtin-presets")) +
    ";",
  "const GrobyAutomationPresets=" +
    JSON.stringify(require("../src/domains/twitch/streamer-automation-presets")) +
    ";",
  read(path.join(root, "features/twitch-integration/ui/automations-list.js")),
  read(path.join(root, "features/twitch-integration/ui/automation-reward-editor.js")),
  ...modules.map(([name, exports]) => {
    let source = read(path.join(root, `public/core/control-deck-${name}.js`)).replace(
      /^import .*;\n/gm,
      "",
    );
    source = source.replace(/export function /g, "function ");
    const imports =
      name === "steps"
        ? "const {parameterForm,buildFlowGroup,presentAction}=DeckFlow;"
        : name === "parameters"
          ? "const {attachSoundField,readSoundOutputs}=DeckFlow;"
          : "";
    return `(()=>{\n${imports}\n${source}\nObject.assign(DeckFlow,{${exports.join(",")}});\n})();`;
  }),
  read(path.join(root, "features/twitch-integration/ui/automations-controller.js")),
].join("\n");
syncFile(
  path.join(root, "features/twitch-integration/ui/automations.html"),
  (content) => {
    content = content.replace(
      /(<span id="automationBuildVersion">)[^<]*(<\/span>)/,
      "$1" + require("../features/twitch-integration/groby.feature.json").version + "$2",
    );
    content = replaceBlock(
      content,
      "<!-- AUTOMATION_LAYOUT_STYLE_START -->",
      "<!-- AUTOMATION_LAYOUT_STYLE_END -->",
      "\n<style>\n" +
        read(path.join(root, "features/twitch-integration/ui/automations-layout.css")) +
        "\n</style>\n",
    );
    content = replaceBlock(
      content,
      "<!-- TWITCH_FLOW_STYLE_START -->",
      "<!-- TWITCH_FLOW_STYLE_END -->",
      `\n<style>\n${read(path.join(root, "public/core/control-deck.css"))}\n${read(path.join(root, "public/core/pill-input.css"))}\n${dialogStyle}\n${editorStyle}\n</style>\n`,
    );
    return replaceBlock(
      content,
      "<!-- TWITCH_FLOW_SCRIPT_START -->",
      "<!-- TWITCH_FLOW_SCRIPT_END -->",
      `\n<script>\n${js}\n</script>\n`,
    );
  },
  { check: process.argv.includes("--check") },
);

syncFile(
  path.join(root, "features/twitch-integration/ui/command-list.html"),
  (content) => {
    content = replaceBlock(
      content,
      "<!-- COMMAND_LIST_STYLE_START -->",
      "<!-- COMMAND_LIST_STYLE_END -->",
      "\n<style>\n" +
        read(path.join(root, "features/twitch-integration/ui/command-list.css")) +
        "\n</style>\n",
    );
    content = replaceBlock(
      content,
      "<!-- COMMAND_LIST_LAYOUT_START -->",
      "<!-- COMMAND_LIST_LAYOUT_END -->",
      "\n" +
        read(path.join(root, "features/twitch-integration/ui/command-list-layout.html")) +
        "\n",
    );
    return replaceBlock(
      content,
      "<!-- COMMAND_LIST_SCRIPT_START -->",
      "<!-- COMMAND_LIST_SCRIPT_END -->",
      "\n<script>\n" +
        ["command-list-model.js", "command-list-ui.js", "command-list-controller.js"]
          .map((file) => read(path.join(root, "features/twitch-integration/ui", file)))
          .join("\n") +
        "\n</script>\n",
    );
  },
  { check: process.argv.includes("--check") },
);
