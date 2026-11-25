const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
module.exports = (file, options = {}) => {
  let data = { version: 1, accounts: {} },
    blocked = false;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32000000)
      throw Error("Invalid community store.");
    data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data.version !== 1 || !data.accounts || Array.isArray(data.accounts))
      throw Error("Invalid community store.");
  } catch (error) {
    if (error.code !== "ENOENT") blocked = true;
  }
  let dirty = false;
  const users = require("./watchtime-records")(file + ".sqlite", {
    ...options,
    protectedBytes: () => (fs.existsSync(file) ? fs.statSync(file).size : 0),
  });
  let migrated = false;
  function migrate() {
    if (migrated || blocked) return;
    for (const [owner, account] of Object.entries(data.accounts)) {
      for (const [login, row] of Object.entries(account.viewers || {})) {
        if (!users.peek(owner, login))
          users.put(owner, login, { ...row, lastActiveAt: row.lastActiveAt || Date.now() });
      }
    }
    users.flush();
    for (const account of Object.values(data.accounts)) {
      if (Object.keys(account.viewers || {}).length) dirty = true;
      delete account.viewers;
    }
    migrated = true;
  }
  function flush() {
    if (blocked)
      throw Error("Community data is unavailable; restore its backup before using these commands.");
    migrate();
    users.flush();
    if (!dirty) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(data) + "\n", { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
    dirty = false;
  }
  function account(owner) {
    if (blocked) throw Error("Community data is unavailable.");
    if (!/^\d{1,80}$/.test(owner)) throw Error("Invalid account.");
    migrate();
    return (data.accounts[owner] ??= { quotes: [], imports: [] });
  }
  function viewer(owner, login) {
    login = String(login).replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(login)) throw Error("Invalid username.");
    account(owner);
    return users.put(owner, login);
  }

  return {
    account,
    viewer,
    flush,
    peek(owner, login) {
      account(owner);
      return users.peek(owner, login);
    },
    leaders(owner, metric, limit) {
      account(owner);
      return users.leaders(owner, metric, limit);
    },
    subscribedLogins(owner, logins) {
      account(owner);
      return users.subscribedLogins(owner, logins);
    },
    count(owner) {
      account(owner);
      return users.count(owner);
    },
    dropUnsubscribed(owner) {
      account(owner);
      users.dropUnsubscribed(owner);
    },
    storageBudget(value) {
      migrate();
      return users.budget(value);
    },
    forget(owner, login) {
      account(owner);
      users.forget(owner, login);
    },
    touch(owner, login, at, subscribed = false) {
      const row = viewer(owner, login);
      row.lastActiveAt = at;
      row.everSubscribed = row.everSubscribed === true || subscribed;
      dirty = true;
      return row;
    },
    tracking(owner, mode) {
      const target = account(owner);
      if (mode !== undefined) {
        if (!["off", "followers", "subscribed-followers"].includes(mode))
          throw Error("Invalid tracking mode.");
        const previous = target.trackingMode;
        target.trackingMode = mode;
        dirty = true;
        try {
          flush();
        } catch (error) {
          target.trackingMode = previous;
          throw error;
        }
      }
      return target.trackingMode || "followers";
    },
    prune(owner) {
      account(owner);
      return users.flush();
    },
    manageQuotes: require("./quote-management")({
      account,
      flush,
      markDirty: () => {
        dirty = true;
      },
    }),
    credit(owner, login, minutes) {
      const row = viewer(owner, login);
      const before = Math.floor(row.minutes / 10);
      row.minutes += minutes;
      row.points += (Math.floor(row.minutes / 10) - before) * 10;
      dirty = true;
    },
    quote(owner, operation, text, user, now) {
      const rows = account(owner).quotes;
      if (operation === "add") {
        if (!text.trim() || text.length > 2000)
          throw Error("Use !quote add followed by up to 2,000 characters.");
        if (rows.length >= 10000) throw Error("Quote limit reached.");
        rows.push({ text: text.trim(), author: user, createdAt: now });
        dirty = true;
        flush();
        return `Quote #${rows.length} added.`;
      }
      if (operation === "delete") {
        const index = Number(text.replace(/^#/, ""));
        if (!Number.isInteger(index) || index < 1 || index > rows.length)
          throw Error("Choose an existing quote number.");
        rows.splice(index - 1, 1);
        dirty = true;
        flush();
        return rows.length
          ? `Quote #${index} deleted. Remaining quotes are numbered #1 to #${rows.length}.`
          : `Quote #${index} deleted. No quotes remain.`;
      }
      if (!rows.length)
        return "No quotes saved yet. Moderators can use !quote add followed by the quote.";
      const index = text ? Number(text.replace(/^#/, "")) - 1 : crypto.randomInt(rows.length);
      if (!Number.isInteger(index) || index < 0 || index >= rows.length)
        throw Error("Choose an existing quote number.");
      const reply = `#${index + 1}: ${rows[index].text}`;
      return reply.length > 500 ? reply.slice(0, 497) + "..." : reply;
    },
    import: require("./community-import")({
      account,
      viewer,
      flush,
      markDirty: () => {
        dirty = true;
      },
    }),
  };
};
