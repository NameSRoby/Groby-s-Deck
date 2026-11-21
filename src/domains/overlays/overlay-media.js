/** Bounded media uploads with generated filenames and signature-checked formats. */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const formats = {
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
};
module.exports = function overlayMedia(runtimeDir) {
  const dir = path.join(runtimeDir, "overlays", "media");
  return {
    add(type, body) {
      const format = formats[type];
      if (!format || !Buffer.isBuffer(body) || body.length < 12 || !format[1](body))
        throw Error("Choose a valid image, video or supported font file.");
      const limit = type.startsWith("font/") ? 5 : type.startsWith("image/") ? 8 : 50;
      if (body.length > limit * 1024 * 1024)
        throw Error("Fonts can be up to 5 MB, images up to 8 MB and videos up to 50 MB.");
      fs.mkdirSync(dir, { recursive: true });
      const files = fs.readdirSync(dir);
      const used = files.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);
      if (files.length >= 200 || used + body.length > 500 * 1024 * 1024)
        throw Error("Overlay media storage is full (200 files / 500 MB).");
      const name = randomUUID() + "." + format[0];
      fs.writeFileSync(path.join(dir, name), body, { flag: "wx" });
      return { url: "/api/stream-overlays/media/" + name };
    },
    locate(name) {
      if (!/^[a-f0-9-]{36}\.(png|jpg|webp|gif|mp4|webm|woff2?|otf|ttf)$/.test(name)) return null;
      const type = Object.entries(formats).find(([, row]) => row[0] === name.split(".").pop())?.[0];
      const file = path.join(dir, name);
      return fs.existsSync(file) ? { file, type } : null;
    },
  };
};
