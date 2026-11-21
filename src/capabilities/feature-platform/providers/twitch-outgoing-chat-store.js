/** Bounded private echo journal. Stores IDs and hashes, never chat text or tokens. */
module.exports = (file = "") => {
  const fs = require("node:fs"),
    path = require("node:path");
  let blocked = false,
    data = { ids: [], pending: [] };
  const id = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max;
  try {
    if (file && fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2000000) throw Error();
      data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        data.version !== 1 ||
        !Array.isArray(data.ids) ||
        data.ids.length > 4096 ||
        !Array.isArray(data.pending) ||
        data.pending.length > 128 ||
        data.ids.some(
          (row) =>
            !Array.isArray(row) ||
            row.length !== 3 ||
            !id(row[0], 160) ||
            !id(row[1], 80) ||
            !id(row[2], 80),
        ) ||
        data.pending.some(
          (row) =>
            !Array.isArray(row) ||
            row.length !== 4 ||
            !id(row[0], 80) ||
            !id(row[1], 80) ||
            !/^[a-f0-9]{64}$/.test(row[2]) ||
            !Number.isFinite(row[3]),
        )
      )
        throw Error();
    }
  } catch {
    blocked = true;
    data = { ids: [], pending: [] };
  }
  return {
    ...data,
    get blocked() {
      return blocked;
    },
    save(ids, pending) {
      if (!file) return;
      try {
        if (blocked) throw Error();
        const content = JSON.stringify({ version: 1, ids, pending }) + "\n";
        if (Buffer.byteLength(content) > 2000000) throw Error();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + ".tmp", content, { mode: 0o600 });
        fs.renameSync(file + ".tmp", file);
      } catch (error) {
        blocked = true;
        throw error;
      }
    },
  };
};
