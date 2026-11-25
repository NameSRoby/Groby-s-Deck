/** Setup history is presentation data. Reads never pair devices, start players or run actions. */
const fs = require("node:fs"),
  path = require("node:path");
const { writeJsonFile } = require("../../shared/fs/json-file-store");
const features = ["lights", "twitch", "music", "deck", "overlays"];
module.exports = ({ runtimeDir, readFacts }) => {
  const file = path.join(runtimeDir, "system", "setup-progress.json");
  let state = {
      version: 1,
      revision: 0,
      dismissed: false,
      completed: false,
      skipped: [],
      done: [],
    },
    invalid = false,
    flight = null;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16000) throw Error();
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      saved.version !== 1 ||
      !Number.isSafeInteger(saved.revision) ||
      saved.revision < 0 ||
      typeof saved.dismissed !== "boolean" ||
      typeof saved.completed !== "boolean" ||
      !Array.isArray(saved.skipped) ||
      !Array.isArray(saved.done) ||
      [...saved.skipped, ...saved.done].some((id) => !features.includes(id)) ||
      new Set(saved.skipped).size !== saved.skipped.length ||
      new Set(saved.done).size !== saved.done.length
    )
      throw Error();
    if (
      Object.keys(saved).some(
        (k) => !["version", "revision", "dismissed", "completed", "skipped", "done"].includes(k),
      )
    )
      throw Error();
    state = {
      version: 1,
      revision: saved.revision,
      dismissed: saved.dismissed,
      completed: saved.completed,
      skipped: saved.skipped,
      done: saved.done,
    };
  } catch (error) {
    invalid = error.code !== "ENOENT";
  }
  function commit(next) {
    if (invalid) throw Error("setup_progress_unavailable");
    next = { ...next, revision: state.revision + 1 };
    writeJsonFile(file, next, { mode: 0o600 });
    state = next;
  }
  async function snapshot() {
    if (invalid) return { ok: false, error: "setup_progress_unavailable" };
    if (flight) return flight;
    flight = Promise.resolve()
      .then(readFacts)
      .then((facts) => {
        const nextDone = features.filter((id) => state.done.includes(id) || facts[id] === true);
        const complete = features.every(
          (id) => nextDone.includes(id) || state.skipped.includes(id),
        );
        if (
          JSON.stringify(nextDone) !== JSON.stringify(state.done) ||
          (!state.completed && complete)
        )
          commit({ ...state, done: nextDone, completed: complete });
        return {
          ok: true,
          ...state,
          features: features.map((id) => ({
            id,
            done: state.done.includes(id),
            skipped: state.skipped.includes(id),
          })),
        };
      })
      .finally(() => {
        flight = null;
      });
    return flight;
  }
  async function update(input) {
    if (
      !input ||
      Object.keys(input).some((k) => !["action", "feature", "revision"].includes(k)) ||
      !["dismiss", "show", "skip", "restore"].includes(input.action) ||
      (["skip", "restore"].includes(input.action)
        ? !features.includes(input.feature)
        : input.feature !== undefined)
    )
      throw Error("setup_progress_invalid");
    if (input.revision !== state.revision) throw Error("setup_progress_conflict");
    const next = structuredClone(state);
    if (input.action === "dismiss") next.dismissed = true;
    if (input.action === "show") {
      next.dismissed = false;
      next.completed = false;
      next.skipped = [];
      next.done = [];
    }
    if (input.action === "skip") next.skipped = [...new Set([...next.skipped, input.feature])];
    if (input.action === "restore") {
      next.skipped = next.skipped.filter((id) => id !== input.feature);
      next.completed = false;
      next.dismissed = false;
    }
    commit(next);
    return snapshot();
  }
  return { snapshot, update };
};
