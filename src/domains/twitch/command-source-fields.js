/** Only authored Twitch message fields are templates, never viewer input or other data. */
function messages(value) {
  if (Array.isArray(value)) return value.map(messages);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, messages(child)]),
  );
  if (
    ["twitch.action.chat", "twitch.action.announcement", "twitch.action.recipe"].includes(
      result.actionId,
    ) &&
    typeof result.params?.message === "string"
  )
    result.params.message = require("./command-source").canonical(result.params.message);
  return result;
}
function backup(file, data) {
  const fs = require("node:fs"),
    content = JSON.stringify(data) + "\n",
    original = file.replace(/\.json$/, ".syntax-backup.json"),
    hash = require("node:crypto").createHash("sha256").update(content).digest("hex").slice(0, 12),
    target = fs.existsSync(original)
      ? file.replace(/\.json$/, ".syntax-backup." + hash + ".json")
      : original;
  try {
    fs.writeFileSync(target, content, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}
module.exports = { messages, backup };
