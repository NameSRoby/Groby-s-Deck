/** Apply an operator-prepared local import once, preserving intervening edits. */
const fs = require("node:fs"),
  crypto = require("node:crypto");
const fingerprint = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function apply(file, data) {
  const pending = file.replace(/\.json$/, ".import.json");
  if (!fs.existsSync(pending)) return { data, changed: false };
  const stat = fs.lstatSync(pending);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 300000)
    throw Error("Invalid pending import.");
  const plan = JSON.parse(fs.readFileSync(pending, "utf8"));
  if (
    plan.version !== 1 ||
    !/^\d{1,80}$/.test(plan.owner) ||
    !Array.isArray(plan.rows) ||
    plan.rows.length > 128
  )
    throw Error("Invalid pending import.");
  const rows = [...data.rows],
    report = [];
  for (const item of plan.rows) {
    const row = require("./twitch-automation-config").normalize(item.automation, plan.owner);
    const index = rows.findIndex((other) => other.id === row.id),
      current = rows[index];
    if (
      (current && (current.accountId !== plan.owner || fingerprint(current) !== item.expected)) ||
      (!current && item.expected !== null)
    ) {
      report.push({ id: row.id, result: "kept newer local edit" });
      continue;
    }
    if (
      rows.some(
        (other) =>
          other.id !== row.id &&
          other.accountId === plan.owner &&
          other.trigger.type === "command" &&
          require("./command-triggers").overlaps(other.trigger, row.trigger),
      )
    ) {
      report.push({ id: row.id, result: "kept existing command with same trigger" });
      continue;
    }
    if (index < 0) rows.push(row);
    else rows[index] = row;
    report.push({ id: row.id, result: "applied" });
  }
  if (rows.length > 128 || JSON.stringify(rows).length > 200000)
    throw Error("Import exceeds command limits.");
  return {
    data: { ...data, rows, revision: data.revision + 1 },
    changed: true,
    finish: () => {
      fs.writeFileSync(pending + ".report.json", JSON.stringify(report, null, 2) + "\n", {
        mode: 0o600,
      });
      fs.renameSync(pending, pending + ".applied");
    },
  };
}
module.exports = { apply, fingerprint };
