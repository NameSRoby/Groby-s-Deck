/** Compare saved records, independently of their physical storage format. */
const fs = require("node:fs"),
  { DatabaseSync } = require("node:sqlite");
module.exports = (file) => {
  if (!fs.existsSync(file + ".sqlite"))
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}";
  const db = new DatabaseSync(file + ".sqlite", { readOnly: true });
  try {
    return JSON.stringify({
      values: Object.fromEntries(
        db
          .prepare("SELECT owner,name,value FROM values_store ORDER BY owner,name")
          .all()
          .map((row) => [row.owner + ":" + row.name, row.value]),
      ),
      boards: Object.fromEntries(
        db
          .prepare("SELECT owner,name,payload FROM boards ORDER BY owner,name")
          .all()
          .map((row) => [row.owner + ":" + row.name, JSON.parse(row.payload)]),
      ),
    });
  } finally {
    db.close();
  }
};
