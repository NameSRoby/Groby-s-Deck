/** Local documents, bounded writes and optimistic concurrency; no account secrets. */
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readJsonFile, writeJsonFile } = require("../../shared/fs/json-file-store");
const model = require("../../../public/core/overlay-model");
const { types: gameTypes } = require("../../../public/core/overlay-game-rules");
module.exports = function overlayStore(runtimeDir) {
  const file = path.join(runtimeDir, "system", "stream-overlays.json");
  let state = { revision: 0, documents: [] };
  const saved = readJsonFile(file, null);
  if (saved && Number.isSafeInteger(saved.revision) && Array.isArray(saved.documents)) {
    try {
      state = {
        revision: saved.revision,
        documents: saved.documents.slice(0, 20).map(model.document),
      };
    } catch {
      /* Retain the unreadable file for recovery. */
    }
  }
  function commit(documents, expectedRevision) {
    if (expectedRevision !== state.revision)
      throw Error("This overlay library changed in another window. Reload before saving.");
    const next = { revision: state.revision + 1, documents };
    writeJsonFile(file, next);
    state = next;
    return snapshot();
  }
  function snapshot() {
    return structuredClone(state);
  }
  const stored = (id) => state.documents.find((row) => row.id === id);
  return {
    snapshot,
    revision: () => state.revision,
    widgets: (id) =>
      id === undefined ? state.documents.flatMap((doc) => doc.widgets) : stored(id)?.widgets,
    gameDocuments: (id) =>
      (id === undefined ? state.documents : state.documents.filter((doc) => doc.id === id)).map(
        (doc) => ({
          id: doc.id,
          name: doc.name,
          widgets: doc.widgets.filter((w) => gameTypes.includes(w.type)),
        }),
      ),
    get: (id) => structuredClone(stored(id) || null),
    save(input) {
      if (Buffer.byteLength(JSON.stringify(input.document), "utf8") > 240000)
        throw Error("This overlay exceeds 240 KB. Shorten tile labels, image URLs or custom code.");
      const doc = model.document(input.document),
        documents = [...state.documents];
      const index = documents.findIndex((row) => row.id === doc.id);
      if (doc.id && index < 0)
        throw Error("That overlay no longer exists. Save it as a new overlay.");
      if (index < 0) {
        if (documents.length >= 20) throw Error("The overlay library is full (20 overlays).");
        doc.id = randomUUID();
        documents.push(doc);
      } else documents[index] = doc;
      return { ...commit(documents, input.expectedRevision), selectedId: doc.id };
    },
    remove(input) {
      return commit(
        state.documents.filter((row) => row.id !== input.id),
        input.expectedRevision,
      );
    },
  };
};
