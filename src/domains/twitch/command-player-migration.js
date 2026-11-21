/** One-time data import from the retired duel store; no game rules live here. */
module.exports = (file) => {
  const fs = require("node:fs"),
    legacy = file.replace(/\.json$/, ".duels.json"),
    target = file.replace(/\.json$/, ".counters.json");
  if (!fs.existsSync(legacy)) return;
  const read = (name) => {
    const stat = fs.lstatSync(name);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2000000)
      throw Error("Player records could not be migrated safely.");
    return JSON.parse(fs.readFileSync(name, "utf8"));
  };
  const old = read(legacy),
    saved = fs.existsSync(target) && !fs.existsSync(target + ".sqlite") ? read(target) : {},
    values = saved.version === 2 ? saved.values : saved;
  if (
    !old ||
    Array.isArray(old) ||
    typeof old !== "object" ||
    !values ||
    Array.isArray(values) ||
    typeof values !== "object" ||
    Object.keys(old).length > 2000
  )
    throw Error("Player records could not be migrated safely.");
  const next = { ...values };
  for (const [key, row] of Object.entries(old)) {
    const match = /^([^:]{1,80}):([a-z0-9_]{1,25})$/.exec(key);
    if (!match || row?.login !== match[2]) throw Error("Invalid retired player record.");
    for (const field of ["wins", "losses", "streak", "rating", "xp"]) {
      if (!Number.isSafeInteger(row[field]) || Math.abs(row[field]) > 1000000000)
        throw Error("Invalid retired player value.");
      const name = match[1] + ":player " + match[2] + " " + field;
      if (!Object.hasOwn(next, name)) next[name] = row[field];
    }
  }
  const content = JSON.stringify(saved.version === 2 ? { ...saved, values: next } : next) + "\n";
  if (Object.keys(next).length > 16384 || Buffer.byteLength(content) > 2000000)
    throw Error("Player records are full; migration was not applied.");
  if (fs.existsSync(target + ".sqlite")) {
    const counters = require("./command-counters")(target),
      accounts = new Map();
    for (const [key, value] of Object.entries(next)) {
      const at = key.indexOf(":"),
        owner = key.slice(0, at),
        name = key.slice(at + 1);
      if (!accounts.has(owner)) accounts.set(owner, counters(owner, false, true));
      const counter = accounts.get(owner);
      if (!counter.has(name)) counter(name, "set", value);
    }
    for (const counter of accounts.values()) counter.commit();
    fs.renameSync(legacy, legacy.replace(/\.json$/, ".migrated.json"));
    return;
  }
  if (fs.existsSync(target)) require("./command-source-fields").backup(target, saved);
  fs.writeFileSync(target + ".tmp", content, { mode: 0o600 });
  fs.renameSync(target + ".tmp", target);
  fs.renameSync(legacy, legacy.replace(/\.json$/, ".migrated.json"));
};
