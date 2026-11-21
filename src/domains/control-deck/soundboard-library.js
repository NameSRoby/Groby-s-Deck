/** Audio stays on disk. Only bounded metadata and the first 4 KiB enter memory. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { fault } = require("./control-deck-config");
const validId = (id) => typeof id === "string" && /^[a-f0-9]{64}\.(wav|mp3)$/.test(id);
module.exports = function library(runtimeDir) {
  const directory = path.join(runtimeDir, "soundboard"),
    index = path.join(directory, "library.json");
  let rows = [],
    uploading = false;
  const safe = (file, optional = false) => {
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw fault("soundboard_storage_invalid");
      return stat;
    } catch (error) {
      if (optional && error.code === "ENOENT") return null;
      throw error;
    }
  };
  function prepare() {
    fs.mkdirSync(runtimeDir, { recursive: true });
    if (!safe(runtimeDir).isDirectory()) throw fault("soundboard_storage_invalid");
    fs.mkdirSync(directory, { recursive: true });
    if (!safe(directory).isDirectory()) throw fault("soundboard_storage_invalid");
  }
  try {
    safe(runtimeDir, true);
    if (fs.existsSync(directory)) safe(directory);
    const stat = safe(index, true);
    if (stat) {
      if (!stat.isFile() || stat.size > 262144) throw Error();
      rows = JSON.parse(fs.readFileSync(index, "utf8"));
      if (
        !Array.isArray(rows) ||
        rows.length > 512 ||
        rows.some(
          (row) =>
            !validId(row.id) ||
            typeof row.name !== "string" ||
            row.name.length > 80 ||
            !Number.isSafeInteger(row.bytes) ||
            row.bytes < 1,
        )
      )
        throw Error();
    }
  } catch {
    throw fault("soundboard_storage_invalid");
  }
  function save(next) {
    prepare();
    const temp = path.join(directory, crypto.randomUUID() + ".tmp");
    try {
      fs.writeFileSync(temp, JSON.stringify(next) + "\n", { flag: "wx", mode: 0o600 });
      safe(index, true);
      fs.renameSync(temp, index);
      rows = next;
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  function read(id) {
    if (!validId(id) || !rows.some((row) => row.id === id)) throw fault("soundboard_clip_missing");
    prepare();
    const file = path.join(directory, id),
      stat = safe(file);
    if (!stat.isFile()) throw fault("soundboard_storage_invalid");
    return file;
  }
  const name = (value) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 80 ||
      /[\x00-\x1f]/.test(value)
    )
      throw fault("soundboard_name_invalid");
    return value.trim();
  };
  return {
    list: () => rows.map((row) => ({ ...row })),
    read,
    async upload(stream, label) {
      label = name(label);
      if (uploading) throw fault("soundboard_upload_busy");
      uploading = true;
      let temp;
      try {
        prepare();
        temp = path.join(directory, crypto.randomUUID() + ".upload");
        let size = 0,
          header = Buffer.alloc(0);
        const hash = crypto.createHash("sha256");
        const inspect = new Transform({
          transform(chunk, _encoding, done) {
            size += chunk.length;
            if (size > 32 * 1024 ** 2) return done(fault("soundboard_file_too_large"));
            if (header.length < 4096)
              header = Buffer.concat([header, chunk.subarray(0, 4096 - header.length)]);
            hash.update(chunk);
            done(null, chunk);
          },
        });
        await pipeline(stream, inspect, fs.createWriteStream(temp, { flags: "wx", mode: 0o600 }));
        const wav =
          header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WAVE";
        const mp3 =
          header.toString("ascii", 0, 3) === "ID3" ||
          (header[0] === 255 && (header[1] & 0xe0) === 0xe0);
        if (size < 16 || (!wav && !mp3)) throw fault("soundboard_format_invalid");
        const id = hash.digest("hex") + (wav ? ".wav" : ".mp3"),
          old = rows.find((row) => row.id === id);
        if (old) return { ...old };
        if (rows.length >= 512 || rows.reduce((sum, row) => sum + row.bytes, 0) + size > 1024 ** 3)
          throw fault("soundboard_library_full");
        const file = path.join(directory, id);
        safe(file, true);
        fs.renameSync(temp, file);
        const row = { id, name: label, bytes: size };
        try {
          save([...rows, row]);
        } catch (error) {
          fs.rmSync(file, { force: true });
          throw error;
        }
        return { ...row };
      } finally {
        uploading = false;
        if (temp) fs.rmSync(temp, { force: true });
      }
    },
    rename(id, label) {
      read(id);
      label = name(label);
      save(rows.map((row) => (row.id === id ? { ...row, name: label } : row)));
      return { ok: true };
    },
    remove(id) {
      const file = read(id);
      save(rows.filter((row) => row.id !== id));
      fs.rmSync(file);
      return { ok: true };
    },
  };
};
