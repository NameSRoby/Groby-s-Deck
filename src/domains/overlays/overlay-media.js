/** Bounded media uploads with generated filenames and signature-checked formats. */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const formats = new Map(
  Object.entries({
    "audio/mpeg": [
      "mp3",
      (b) => b.toString("ascii", 0, 3) === "ID3" || (b[0] === 255 && (b[1] & 224) === 224),
    ],
    "audio/wav": [
      "wav",
      (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE",
    ],
    "audio/ogg": ["ogg", (b) => b.toString("ascii", 0, 4) === "OggS"],
    "audio/mp4": ["m4a", (b) => b.toString("ascii", 4, 8) === "ftyp"],
    "image/png": [
      "png",
      (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    ],
    "image/jpeg": ["jpg", (b) => b[0] === 255 && b[1] === 216 && b[2] === 255],
    "image/gif": ["gif", (b) => /^GIF8[79]a/.test(b.toString("ascii", 0, 6))],
    "image/webp": [
      "webp",
      (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
    ],
    "video/mp4": ["mp4", (b) => b.toString("ascii", 4, 8) === "ftyp"],
    "video/webm": ["webm", (b) => b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))],
    "font/woff": ["woff", (b) => b.toString("ascii", 0, 4) === "wOFF"],
    "font/woff2": ["woff2", (b) => b.toString("ascii", 0, 4) === "wOF2"],
    "font/otf": ["otf", (b) => b.toString("ascii", 0, 4) === "OTTO"],
    "font/ttf": ["ttf", (b) => b.readUInt32BE(0) === 0x00010000],
  }),
);
const assetName =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(png|jpg|webp|gif|mp4|webm|mp3|wav|ogg|m4a|woff2?|otf|ttf)$/;
module.exports = function overlayMedia(runtimeDir) {
  function directory(create = false) {
    if (create) fs.mkdirSync(runtimeDir, { recursive: true });
    const root = fs.realpathSync(runtimeDir);
    let dir = root;
    for (const name of ["overlays", "media"]) {
      dir = path.join(dir, name);
      if (create && !fs.existsSync(dir)) fs.mkdirSync(dir);
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error("Overlay media storage is unavailable.");
    }
    dir = fs.realpathSync(dir);
    if (!dir.startsWith(root + path.sep)) throw Error("Overlay media storage is unavailable.");
    return dir;
  }
  return {
    add(type, body) {
      if (typeof type !== "string") throw Error("Choose a supported media content type.");
      const mime = type.split(";", 1)[0].trim().toLowerCase();
      const format = formats.get(mime);
      if (!format || !Buffer.isBuffer(body) || body.length < 12 || !format[1](body))
        throw Error("Choose a valid image, video, MP3/WAV/OGG/M4A sound or supported font file.");
      const limit = mime.startsWith("font/") ? 5 : mime.startsWith("image/") ? 8 : 50;
      if (body.length > limit * 1024 * 1024)
        throw Error("Fonts can be up to 5 MB, images up to 8 MB and audio/video up to 50 MB.");
      let dir;
      try {
        dir = directory(true);
      } catch {
        throw Error("Overlay media storage is unavailable.");
      }
      const files = fs.readdirSync(dir);
      const used = files.reduce((sum, name) => sum + fs.lstatSync(path.join(dir, name)).size, 0);
      if (files.length >= 200 || used + body.length > 500 * 1024 * 1024)
        throw Error("Overlay media storage is full (200 files / 500 MB).");
      const name = randomUUID() + "." + format[0];
      fs.writeFileSync(path.join(dir, name), body, { flag: "wx" });
      return { url: "/api/stream-overlays/media/" + name };
    },
    locate(name) {
      if (typeof name !== "string") return null;
      const match = assetName.exec(name);
      if (!match || match[0] !== name) return null;
      try {
        const root = directory();
        const file = path.resolve(root, name);
        if (!file.startsWith(root + path.sep)) return null;
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) return null;
        const canonical = fs.realpathSync(file);
        if (!canonical.startsWith(root + path.sep)) return null;
        const type = [...formats].find(([, row]) => row[0] === match[1])?.[0];
        return { file: canonical, name, root, type };
      } catch {
        return null;
      }
    },
  };
};
