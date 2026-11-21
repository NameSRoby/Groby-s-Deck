/** Indexed numeric records; no whole-database JSON rewrites during commands. */
const fs = require("node:fs"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
module.exports = (file) => {
  const target = file + ".sqlite";
  let legacy = { values: {}, boards: {} },
    blocked = false;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2000000) throw Error();
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    legacy = saved.version === 2 ? saved : { values: saved, boards: {} };
    if (
      !legacy.values ||
      Array.isArray(legacy.values) ||
      typeof legacy.values !== "object" ||
      Object.keys(legacy.values).length > 16384 ||
      Object.values(legacy.values).some((n) => !Number.isSafeInteger(n) || Math.abs(n) > 1e9) ||
      !legacy.boards ||
      typeof legacy.boards !== "object" ||
      Array.isArray(legacy.boards) ||
      Object.keys(legacy.boards).length > 256 ||
      Object.values(legacy.boards).some(
        (board) =>
          !board ||
          typeof board.label !== "string" ||
          board.label.length > 64 ||
          !/^[a-z][a-z0-9_]{0,23}$/i.test(board.field || "") ||
          !Array.isArray(board.entries) ||
          board.entries.length > 10 ||
          board.entries.some(
            (row) =>
              !/^[a-z0-9_]{1,25}$/i.test(row?.player || "") || !Number.isSafeInteger(row.value),
          ),
      )
    )
      throw Error();
  } catch (error) {
    if (error.code !== "ENOENT") blocked = true;
  }
  const parts = (name) => /^player ([a-z0-9_]{1,25}) ([a-z][a-z0-9_]{0,23})$/i.exec(name);
  function withDB(write, work) {
    if (blocked) throw Error("Counter storage unavailable.");
    if (!write && !fs.existsSync(target)) return work(null);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    for (const name of [target, target + "-journal", target + "-wal", target + "-shm"]) {
      if (fs.existsSync(name)) {
        const stat = fs.lstatSync(name);
        if (!stat.isFile() || stat.isSymbolicLink()) throw Error("Counter storage unavailable.");
      }
    }
    const db = new DatabaseSync(target);
    try {
      db.exec("PRAGMA busy_timeout=3000; PRAGMA cache_size=-2048; PRAGMA mmap_size=0;");
      if (write)
        db.exec(
          "CREATE TABLE IF NOT EXISTS values_store(owner TEXT NOT NULL,name TEXT NOT NULL,value INTEGER NOT NULL,player TEXT,field TEXT,PRIMARY KEY(owner,name)); CREATE INDEX IF NOT EXISTS leaders ON values_store(owner,field,value DESC,player); CREATE TABLE IF NOT EXISTS boards(owner TEXT NOT NULL,name TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,name)); CREATE TABLE IF NOT EXISTS revisions(owner TEXT PRIMARY KEY,version INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value INTEGER);",
        );
      if (write)
        db.exec(
          "INSERT OR IGNORE INTO metadata VALUES('rows',0); CREATE TRIGGER IF NOT EXISTS record_insert AFTER INSERT ON values_store BEGIN UPDATE metadata SET value=value+1 WHERE key='rows'; END; CREATE TRIGGER IF NOT EXISTS record_delete AFTER DELETE ON values_store BEGIN UPDATE metadata SET value=value-1 WHERE key='rows'; END;",
        );
      return work(db);
    } finally {
      db.close();
    }
  }
  function imported(db) {
    return db && db.prepare("SELECT value FROM metadata WHERE key='imported'").get()?.value === 1;
  }
  function read(work, fallback) {
    return withDB(false, (db) => (imported(db) ? work(db) : fallback()));
  }
  function set(db, owner, name, value) {
    const match = parts(name);
    db.prepare(
      "INSERT INTO values_store VALUES(?,?,?,?,?) ON CONFLICT(owner,name) DO UPDATE SET value=excluded.value,player=excluded.player,field=excluded.field",
    ).run(owner, name, value, match?.[1] || null, match?.[2] || null);
  }
  function commit(owner, version, writes, resets, boards) {
    withDB(true, (db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!imported(db)) {
          for (const [key, value] of Object.entries(legacy.values)) {
            const at = key.indexOf(":");
            if (at < 1) throw Error("Invalid saved counter name.");
            set(db, key.slice(0, at), key.slice(at + 1), value);
          }
          for (const [key, board] of Object.entries(legacy.boards)) {
            const at = key.indexOf(":");
            db.prepare("INSERT OR IGNORE INTO boards VALUES(?,?,?)").run(
              key.slice(0, at),
              key.slice(at + 1),
              JSON.stringify(board),
            );
          }
          db.exec("INSERT INTO metadata VALUES('imported',1)");
        }
        const current =
          db.prepare("SELECT version FROM revisions WHERE owner=?").get(owner)?.version || 0;
        if (current !== version)
          throw Error("Saved values changed during this command. Please try again.");
        for (const [field, value] of resets)
          db.prepare("UPDATE values_store SET value=? WHERE owner=? AND field=?").run(
            value,
            owner,
            field,
          );
        for (const [name, value] of writes) set(db, owner, name, value);
        if (db.prepare("SELECT value FROM metadata WHERE key='rows'").get().value > 1000000)
          throw Error("Counter limit reached.");
        for (const [name, board] of boards)
          db.prepare("INSERT INTO boards VALUES(?,?,?)").run(owner, name, JSON.stringify(board));
        if (db.prepare("SELECT count(*) AS n FROM boards").get().n > 256)
          throw Error("Saved leaderboard limit reached.");
        db.prepare(
          "INSERT INTO revisions VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET version=excluded.version",
        ).run(owner, version + 1);
        db.exec("COMMIT");
        legacy = { values: {}, boards: {} };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
    try {
      if (fs.existsSync(file) && !fs.existsSync(file + ".migrated"))
        fs.renameSync(file, file + ".migrated");
    } catch {
      /* The committed database stays authoritative; leave the recovery source intact. */
    }
    return version + 1;
  }
  return {
    commit,
    version: (owner) =>
      read(
        (db) => db.prepare("SELECT version FROM revisions WHERE owner=?").get(owner)?.version || 0,
        () => 0,
      ),
    readMany(owner, names) {
      names = [...new Set(names)];
      if (names.length > 16384) throw Error("Too many selected saved values.");
      return read(
        (db) => {
          const query = db.prepare("SELECT value FROM values_store WHERE owner=? AND name=?");
          return new Map(names.map((name) => [name, query.get(owner, name)?.value ?? 0]));
        },
        () => new Map(names.map((name) => [name, legacy.values[owner + ":" + name] ?? 0])),
      );
    },
    get: (owner, name) =>
      read(
        (db) =>
          db.prepare("SELECT value FROM values_store WHERE owner=? AND name=?").get(owner, name)
            ?.value,
        () =>
          Object.hasOwn(legacy.values, owner + ":" + name)
            ? legacy.values[owner + ":" + name]
            : undefined,
      ),
    leaders(owner, field, limit, reset) {
      return read(
        (db) =>
          db
            .prepare(
              "SELECT name,value,player FROM values_store WHERE owner=? AND field=? ORDER BY " +
                (reset === undefined ? "value DESC,player" : "player") +
                " LIMIT ?",
            )
            .all(owner, field, limit)
            .map((row) => ({ ...row, value: reset ?? row.value })),
        () =>
          Object.entries(legacy.values)
            .filter(([key]) => key.startsWith(owner + ":player ") && key.endsWith(" " + field))
            .map(([key, value]) => {
              const name = key.slice(owner.length + 1);
              return { name, value: reset ?? value, player: parts(name)?.[1] };
            })
            .sort((a, b) => b.value - a.value || a.player.localeCompare(b.player))
            .slice(0, limit),
      );
    },
    board: (owner, name) =>
      read(
        (db) => {
          const row = db
            .prepare("SELECT payload FROM boards WHERE owner=? AND name=?")
            .get(owner, name);
          return row ? JSON.parse(row.payload) : null;
        },
        () => legacy.boards[owner + ":" + name],
      ),
    boards: (owner) =>
      read(
        (db) =>
          db
            .prepare("SELECT payload FROM boards WHERE owner=? ORDER BY rowid")
            .all(owner)
            .map((row) => JSON.parse(row.payload)),
        () =>
          Object.entries(legacy.boards)
            .filter(([key]) => key.startsWith(owner + ":"))
            .map(([, row]) => row),
      ),
  };
};
