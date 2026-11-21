/** Render the same worked explanations for the sandbox page and Markdown manual. */
const groups = require("../../src/domains/twitch/command-language-manual");
const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const answer = (group, value) =>
  group.numeric ? String(value) : value ? "true (yes)" : "false (no)";
const code = (text) => "<code>" + escape(text) + "</code>";
function html() {
  return groups
    .map(
      (group) =>
        `<section id="manual-${group.id}"><h2>${escape(group.title)}</h2><p>${escape(group.intro)}</p><table aria-label="${escape(group.title)}"><thead><tr><th scope="col">Symbol / function</th><th scope="col">What it means</th><th scope="col">Worked examples</th></tr></thead><tbody>${group.rows.map((row) => `<tr><th scope="row">${code(row.symbol)}<br>${escape(row.name)}</th><td>${escape(row.description)}</td><td>${row.cases.map(([expression, value]) => `${code(expression)}<br>Result: <strong>${answer(group, value)}</strong>`).join("<br><br>")}</td></tr>`).join("\n")}</tbody></table></section>`,
    )
    .join("\n");
}
function markdown() {
  const cell = (text) => text.replaceAll("|", "\\|");
  return groups
    .map(
      (group) =>
        `### ${group.title}\n\n${group.intro}\n\n| Symbol / function | What it means | Worked examples |\n| --- | --- | --- |\n${group.rows.map((row) => `| \`${cell(row.symbol)}\` — ${row.name} | ${cell(row.description)} | ${row.cases.map(([expression, value]) => `\`${cell(expression)}\` → **${answer(group, value)}**`).join("; ")} |`).join("\n")}`,
    )
    .join("\n\n");
}
module.exports = { html, markdown };
