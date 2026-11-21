/** Short-lived editor interests extend live feeds without saving a document. */
module.exports = ({ now, changed }) => {
  const sessions = new Map();
  let timer;
  function prune() {
    clearTimeout(timer);
    for (const [id, row] of sessions) if (row.until <= now()) sessions.delete(id);
    if (sessions.size) {
      const delay = Math.max(
        1,
        Math.min(...[...sessions.values()].map((row) => row.until)) - now(),
      );
      timer = setTimeout(() => {
        prune();
        changed();
      }, delay);
      timer.unref?.();
    }
  }
  return {
    set(id, widgets) {
      if (!/^[a-f0-9-]{36}$/.test(id || "")) throw Error("Invalid editor session.");
      prune();
      if (!sessions.has(id) && sessions.size >= 8)
        throw Error("Close an unused overlay editor and try again.");
      const previous = JSON.stringify(this.widgets());
      sessions.set(id, { widgets, until: now() + 15000 });
      prune();
      if (JSON.stringify(this.widgets()) !== previous) changed();
    },
    remove(id) {
      if (sessions.delete(id)) {
        prune();
        changed();
      }
    },
    widgets() {
      return [...sessions.values()]
        .filter((row) => row.until > now())
        .flatMap((row) => row.widgets);
    },
    close() {
      clearTimeout(timer);
      sessions.clear();
    },
  };
};
