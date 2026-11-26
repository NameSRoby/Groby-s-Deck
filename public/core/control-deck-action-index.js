/** A catalog is replaced as a unit when a new deck status frame arrives. */
const indexes = new WeakMap();

export function findDeckAction(catalog, id) {
  let index = indexes.get(catalog);
  if (!index) {
    index = new Map();
    for (const action of catalog) if (!index.has(action.id)) index.set(action.id, action);
    indexes.set(catalog, index);
  }
  return index.get(id);
}
