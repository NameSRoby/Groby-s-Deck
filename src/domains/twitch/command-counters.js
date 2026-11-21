/** Account-scoped, copy-on-write recipes. Previews touch only their bounded draft. */
module.exports = (file) => {
  const store = require("./command-counter-store")(file);
  return (owner, preview = false, staged = false) => {
    let version = store.version(owner),
      changed = false;
    const writes = new Map(),
      resets = new Map(),
      boards = new Map(),
      reads = new Map();
    const playerField = (name) =>
      /^player [a-z0-9_]{1,25} ([a-z][a-z0-9_]{0,23})$/i.exec(name)?.[1];
    function read(name) {
      if (writes.has(name)) return writes.get(name);
      if (!reads.has(name)) {
        if (reads.size >= 4096) throw Error("This command uses too many saved values.");
        reads.set(name, store.get(owner, name));
      }
      if (reads.get(name) !== undefined && resets.has(playerField(name)))
        return resets.get(playerField(name));
      return reads.get(name);
    }
    function commit() {
      if (!changed || preview) return;
      version = store.commit(owner, version, writes, resets, boards);
      writes.clear();
      resets.clear();
      boards.clear();
      reads.clear();
      changed = false;
    }
    function mark() {
      changed = true;
      if (!preview && !staged) commit();
    }
    const counter = (name, mode, amount) => {
      const current = read(name) ?? 0;
      if (mode === "get") return current;
      const next = mode === "set" ? amount : current + amount;
      if (!Number.isSafeInteger(next) || Math.abs(next) > 1e9 || writes.size >= 4096)
        throw Error("Counter limit reached.");
      writes.set(name, next);
      mark();
      return next;
    };
    counter.readMany = (names) => store.readMany(owner, names);
    counter.has = (name) => read(name) !== undefined;
    function leaders(field, limit) {
      const base = store.leaders(
        owner,
        field,
        Math.min(1000010, limit + writes.size),
        resets.get(field),
      );
      const entries = new Map(
        base.filter((row) => !writes.has(row.name)).map((row) => [row.name, row]),
      );
      for (const [name, value] of writes)
        if (playerField(name) === field)
          entries.set(name, { name, value, player: name.split(" ")[1] });
      return [...entries.values()]
        .sort((a, b) => b.value - a.value || a.player.localeCompare(b.player))
        .slice(0, limit)
        .map(({ player, value }) => ({ player, value }));
    }
    const display = (rows) =>
      rows.map((row, i) => `${i + 1}. ${row.player}: ${row.value}`).join(" \u00b7 ");
    counter.leaders = (field, limit) => leaders(field, Math.min(20, Math.max(1, limit)));
    counter.top = (field, limit) => display(leaders(field, limit));
    counter.resetField = (field, value) => {
      if (!Number.isSafeInteger(value) || Math.abs(value) > 1e9)
        throw Error("Counter limit reached.");
      resets.set(field, value);
      for (const [name] of writes) if (playerField(name) === field) writes.set(name, value);
      mark();
    };
    counter.saveBoard = (label, field, limit) => {
      const name = label.toLowerCase();
      if (boards.has(name) || store.board(owner, name))
        throw Error("That leaderboard is already saved. Choose a new name.");
      boards.set(name, { label, field, entries: leaders(field, limit) });
      mark();
    };
    counter.board = (label) => {
      const row = boards.get(label.toLowerCase()) || store.board(owner, label.toLowerCase());
      return row
        ? row.label + ": " + (display(row.entries) || "No player records.")
        : "No saved leaderboard with that name.";
    };
    counter.boards = (limit) =>
      [...store.boards(owner), ...boards.values()]
        .slice(-limit)
        .map((row) => row.label)
        .join(", ") || "No saved leaderboards yet.";
    counter.commit = commit;
    return counter;
  };
};
