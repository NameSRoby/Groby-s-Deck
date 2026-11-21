/** Local documents, bounded writes and optimistic concurrency; no account secrets. */
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readJsonFile, writeJsonFile } = require("../../shared/fs/json-file-store");
const model = require("../../../public/core/overlay-model");
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
  return {
    snapshot,
    revision: () => state.revision,
    widgets: () => state.documents.flatMap((doc) => doc.widgets),
    gameDocuments: () =>
      state.documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        widgets: doc.widgets.filter((w) => ["wheel", "bingo", "chat-vote"].includes(w.type)),
      })),
    get: (id) => structuredClone(state.documents.find((row) => row.id === id) || null),
    save(input) {
      if (Buffer.byteLength(JSON.stringify(input.document), "utf8") > 240000)
        throw Error("This overlay is too large. Keep custom code under 240 KB in total.");
      const doc = model.document(input.document),
        documents = structuredClone(state.documents);
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
