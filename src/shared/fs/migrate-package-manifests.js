/** One-time manifest filename migration; never executes packages or grants permissions. */
const fs = require("node:fs"),
  path = require("node:path");
module.exports = async function migratePackageManifests(root, kind, verify) {
  if (!fs.existsSync(root)) return;
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  const oldName = kind === "mod" ? "ravelink.mod.json" : "ravelink.feature.json",
    newName = kind === "mod" ? "groby.mod.json" : "groby.feature.json";
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).slice(0, 256)) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = path.join(root, entry.name),
      oldFile = path.join(directory, oldName),
      newFile = path.join(directory, newName);
    if (!fs.existsSync(oldFile) || fs.existsSync(newFile)) continue;
    const oldStat = fs.lstatSync(oldFile);
    if (!oldStat.isFile() || oldStat.isSymbolicLink() || oldStat.size > 65536) continue;
    let moved = false;
    const original = fs.readFileSync(oldFile);
    try {
      fs.renameSync(oldFile, newFile);
      moved = true;
      if (kind === "feature") {
        const manifest = JSON.parse(original.toString("utf8"));
        if (manifest.publisher === "ravelink") {
          manifest.publisher = "grobys-deck";
          fs.writeFileSync(newFile, JSON.stringify(manifest, null, 2) + "\n");
        }
      }
      const checked = await verify(directory);
      if (!checked.ok) throw Error("Package migration did not verify.");
    } catch {
      if (moved && fs.existsSync(newFile) && !fs.existsSync(oldFile)) {
        fs.writeFileSync(newFile, original);
        fs.renameSync(newFile, oldFile);
      }
    }
  }
};
