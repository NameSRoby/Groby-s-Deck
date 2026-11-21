/** Indexed, disk-backed user history. Memory holds at most one bounded import batch. */
const fs = require("node:fs"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const DEFAULT_LIMIT = 8 * 1024 ** 3;
module.exports = (file, options = {}) => {
  const pending = new Map(),
    cache = new Map();
  const budgetFile = file + ".budget.json";
  let limit = options.limitBytes || DEFAULT_LIMIT,
    initialized = false;
  try {
    const stat = fs.lstatSync(budgetFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error();
    const saved = JSON.parse(fs.readFileSync(budgetFile, "utf8"));
    if (
      Number.isSafeInteger(saved.limitBytes) &&
      saved.limitBytes >= 65536 &&
      saved.limitBytes <= DEFAULT_LIMIT * 128
    )
      limit = saved.limitBytes;
  } catch (error) {
    if (error.code !== "ENOENT") throw Error("Runtime data budget is unavailable.");
  }
  function withDB(work) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const name of [file, file + "-journal", file + "-wal", file + "-shm"])
      if (
        fs.existsSync(name) &&
        (!fs.lstatSync(name).isFile() || fs.lstatSync(name).isSymbolicLink())
      )
        throw Error("Invalid watchtime storage.");
    const db = new DatabaseSync(file);
    try {
      db.exec(
        "PRAGMA busy_timeout=3000; PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA auto_vacuum=INCREMENTAL;",
      );
      if (!initialized) {
        db.exec(
          "CREATE TABLE IF NOT EXISTS viewers(owner TEXT NOT NULL, login TEXT NOT NULL, active INTEGER NOT NULL, subscribed INTEGER NOT NULL, payload TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(owner,login)); CREATE INDEX IF NOT EXISTS oldest_viewers ON viewers(active,owner,login);            CREATE TABLE IF NOT EXISTS storage_totals(id INTEGER PRIMARY KEY, bytes INTEGER NOT NULL);            INSERT OR IGNORE INTO storage_totals SELECT 1,coalesce(sum(bytes),0) FROM viewers;            CREATE TRIGGER IF NOT EXISTS viewer_insert AFTER INSERT ON viewers BEGIN UPDATE storage_totals SET bytes=bytes+new.bytes WHERE id=1; END;            CREATE TRIGGER IF NOT EXISTS viewer_delete AFTER DELETE ON viewers BEGIN UPDATE storage_totals SET bytes=bytes-old.bytes WHERE id=1; END;            CREATE TRIGGER IF NOT EXISTS viewer_update AFTER UPDATE ON viewers BEGIN UPDATE storage_totals SET bytes=bytes+new.bytes-old.bytes WHERE id=1; END;",
        );
        initialized = true;
      }
      return work(db);
    } finally {
      db.close();
    }
  }
  function key(owner, login) {
    login = String(login).replace(/^@/, "").toLowerCase();
    if (!/^\d{1,80}$/.test(owner) || !/^[a-z0-9_]{1,25}$/.test(login))
      throw Error("Invalid watchtime user.");
    return [owner, login, owner + ":" + login];
  }
  function peek(owner, login) {
    const [o, l, id] = key(owner, login);
    if (pending.has(id)) return pending.get(id).row;
    if (cache.has(id)) return cache.get(id);
    const saved = withDB((db) =>
      db.prepare("SELECT payload FROM viewers WHERE owner=? AND login=?").get(o, l),
    );
    const row = saved ? JSON.parse(saved.payload) : null;
    if (row) {
      cache.set(id, row);
      while (cache.size > 512) cache.delete(cache.keys().next().value);
    }
    return row;
  }
  function put(owner, login, value) {
    const [o, l, id] = key(owner, login);
    const row = value ||
      peek(o, l) || { minutes: 0, points: 0, importedMinutes: 0, importedPoints: 0 };
    pending.set(id, { owner: o, login: l, row });
    cache.delete(id);
    return row;
  }
  function evict(db, reserve = 0) {
    const protectedBytes = options.protectedBytes?.() || 0;
    let used = Number(db.prepare("SELECT bytes AS n FROM storage_totals WHERE id=1").get().n);
    const target = Math.max(0, limit - protectedBytes - 32768 - reserve);
    let removed = 0;
    while (used > target) {
      const rows = db
        .prepare("SELECT owner,login,bytes FROM viewers ORDER BY active,owner,login LIMIT 256")
        .all();
      if (!rows.length) break;
      const remove = db.prepare("DELETE FROM viewers WHERE owner=? AND login=?");
      for (const row of rows) {
        if (used <= target) break;
        remove.run(row.owner, row.login);
        cache.delete(row.owner + ":" + row.login);
        used -= row.bytes;
        removed++;
      }
    }
    return removed;
  }
  function flush() {
    return withDB((db) => {
      db.exec("BEGIN IMMEDIATE");
      let removed;
      try {
        const write = db.prepare(
          "INSERT INTO viewers VALUES(?,?,?,?,?,?) ON CONFLICT(owner,login) DO UPDATE SET active=excluded.active,subscribed=excluded.subscribed,payload=excluded.payload,bytes=excluded.bytes",
        );
        for (const { owner, login, row } of pending.values()) {
          const payload = JSON.stringify(row);
          if (payload.length > 4096) throw Error("Watchtime record is too large.");
          write.run(
            owner,
            login,
            Number.isFinite(row.lastActiveAt) ? row.lastActiveAt : Date.now(),
            row.everSubscribed === true ? 1 : 0,
            payload,
            Buffer.byteLength(payload) + 256,
          );
        }
        removed = evict(db);
        db.exec("COMMIT");
        pending.clear();
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      db.exec("PRAGMA incremental_vacuum");
      // Reclaim reusable pages before enforcing a lowered physical cap.
      if (fs.statSync(file).size + (options.protectedBytes?.() || 0) > limit) {
        db.exec("BEGIN IMMEDIATE");
        try {
          removed += evict(db, Math.min(limit / 10, 1048576));
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        db.exec("VACUUM");
      }
      return removed;
    });
  }
  return {
    leaders(owner, metric, limit) {
      if (!["watchtime", "points"].includes(metric) || !/^\d{1,80}$/.test(owner))
        throw Error("Invalid leaderboard.");
      const expression =
        metric === "watchtime"
          ? "coalesce(json_extract(payload,'$.minutes'),0)+coalesce(json_extract(payload,'$.importedMinutes'),0)"
          : "coalesce(json_extract(payload,'$.points'),0)+coalesce(json_extract(payload,'$.importedPoints'),0)";
      if (pending.size) flush();
      return withDB((db) => {
        db.exec(
          "CREATE INDEX IF NOT EXISTS leaderboard_" +
            metric +
            " ON viewers(owner,(" +
            expression +
            ") DESC,login)",
        );
        return db
          .prepare(
            "SELECT login AS player,(" +
              expression +
              ") AS value FROM viewers WHERE owner=? ORDER BY (" +
              expression +
              ") DESC,login LIMIT ?",
          )
          .all(owner, Math.max(1, Math.min(20, limit)));
      });
    },
    subscribedLogins(owner, logins) {
      return withDB((db) => {
        const result = new Set(),
          query = db.prepare("SELECT subscribed FROM viewers WHERE owner=? AND login=?");
        for (const login of logins) {
          const row = pending.get(owner + ":" + login)?.row;
          if (row?.everSubscribed === true || query.get(owner, login)?.subscribed === 1)
            result.add(login);
        }
        return result;
      });
    },
    peek,
    put,
    flush,
    forget(owner, login) {
      const [o, l, id] = key(owner, login);
      pending.delete(id);
      cache.delete(id);
      withDB((db) => db.prepare("DELETE FROM viewers WHERE owner=? AND login=?").run(o, l));
    },
    count(owner) {
      flush();
      return Number(
        withDB((db) => db.prepare("SELECT count(*) AS n FROM viewers WHERE owner=?").get(owner)).n,
      );
    },
    dropUnsubscribed(owner) {
      flush();
      cache.clear();
      withDB((db) => db.prepare("DELETE FROM viewers WHERE owner=? AND subscribed=0").run(owner));
    },
    budget(value) {
      if (value !== undefined) {
        if (!Number.isSafeInteger(value) || value < 65536 || value > DEFAULT_LIMIT * 128)
          throw Error("Choose a runtime storage cap between 64 KiB and 1 TiB.");
        require("../../shared/fs/json-file-store").writeJsonFile(
          budgetFile,
          { limitBytes: value },
          { mode: 0o600, backup: false },
        );
        limit = value;
      }
      flush();
      return {
        limitBytes: limit,
        usedBytes: fs.statSync(file).size + (options.protectedBytes?.() || 0),
        retention: "until-capacity",
        cleanup: "least-recently-active",
      };
    },
  };
};
