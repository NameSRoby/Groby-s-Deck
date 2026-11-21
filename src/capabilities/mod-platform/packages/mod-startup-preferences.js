/** Remember only explicit mod switches; missing or invalid state never enables a mod. */
const fs = require("node:fs");
const { writeJsonFile } = require("../../../shared/fs/json-file-store");
const idPattern = /^[a-z0-9][a-z0-9-]{0,31}\.[a-z0-9][a-z0-9-]{0,31}$/;
module.exports = (file) => {
  let values = {},
    consent = {};
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw Error();
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      ![1, 2].includes(saved.version) ||
      !saved.enabled ||
      Array.isArray(saved.enabled) ||
      typeof saved.enabled !== "object" ||
      Object.keys(saved.enabled).length > 256 ||
      Object.entries(saved.enabled).some(
        ([id, value]) => !idPattern.test(id) || typeof value !== "boolean",
      )
    )
      throw Error();
    values = saved.enabled;
    if (
      saved.version === 2 &&
      saved.runtimeConsent &&
      typeof saved.runtimeConsent === "object" &&
      !Array.isArray(saved.runtimeConsent)
    )
      consent = Object.fromEntries(
        Object.entries(saved.runtimeConsent)
          .filter(([id, hash]) => idPattern.test(id) && /^[a-f0-9]{64}$/.test(hash))
          .slice(0, 256),
      );
  } catch {}
  return {
    get: (id) => values[id] === true,
    hasConsent: (id, fingerprint) =>
      /^[a-f0-9]{64}$/.test(fingerprint || "") && consent[id] === fingerprint,
    set(id, enabled, fingerprint) {
      if (!idPattern.test(id) || typeof enabled !== "boolean") throw Error("Invalid mod switch.");
      const nextConsent = { ...consent };
      if (fingerprint !== undefined) {
        if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw Error("Invalid mod review identity.");
        nextConsent[id] = fingerprint;
      }
      if (values[id] === enabled && nextConsent[id] === consent[id]) return;
      if (!Object.hasOwn(values, id) && Object.keys(values).length >= 256)
        throw Error("Mod switch limit reached.");
      const next = { ...values, [id]: enabled };
      if (
        fs.existsSync(file) &&
        (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())
      )
        throw Error("Mod switch storage unavailable.");
      writeJsonFile(
        file,
        { version: 2, enabled: next, runtimeConsent: nextConsent },
        { mode: 0o600, backup: false },
      );
      values = next;
      consent = nextConsent;
    },
  };
};
