/** Bounded quote pages and optimistic edits: a renumbered list cannot delete the wrong quote. */
const crypto = require("node:crypto");
const token = (row) =>
  crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 24);
module.exports =
  ({ account, flush, markDirty }) =>
  (owner, input = {}) => {
    const settings = account(owner),
      rows = settings.quotes,
      operation = input.operation || "list";
    if (operation === "settings") {
      if (typeof input.enabled !== "boolean")
        throw Error("Choose whether chat quotes are enabled.");
      const previous = settings.quotesEnabled;
      settings.quotesEnabled = input.enabled;
      markDirty();
      try {
        flush();
      } catch (error) {
        settings.quotesEnabled = previous;
        throw error;
      }
      return { ok: true, enabled: settings.quotesEnabled };
    }
    if (operation === "list") {
      const query = String(input.search || "")
          .trim()
          .toLowerCase(),
        limit = input.limit ?? 25,
        offset = input.offset ?? 0;
      if (
        query.length > 200 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > 10000
      )
        throw Error("Invalid quote list request.");
      const numberQuery = /^#?\d+$/.test(query) ? Number(query.replace(/^#/, "")) : null;
      const matches = rows
        .map((row, index) => ({ row, number: index + 1 }))
        .filter(
          ({ row, number }) =>
            !query ||
            (numberQuery !== null
              ? number === numberQuery
              : (row.text + " " + (row.author || "") + " " + (row.category || ""))
                  .toLowerCase()
                  .includes(query)),
        );
      const start = Math.min(offset, Math.max(0, Math.floor((matches.length - 1) / limit) * limit));
      return {
        ok: true,
        enabled: settings.quotesEnabled !== false,
        total: rows.length,
        matched: matches.length,
        offset: start,
        limit,
        rows: matches.slice(start, start + limit).map(({ row, number }) => ({
          number,
          token: token(row),
          text: row.text,
          author: row.author || "",
          category: row.category || "",
          sourceDate: row.sourceDate || "",
          sourceId: row.sourceId ?? null,
        })),
      };
    }
    if (!["add", "edit", "delete"].includes(operation)) throw Error("Choose add, edit or delete.");
    if (
      operation !== "delete" &&
      (typeof input.text !== "string" || !input.text.trim() || input.text.length > 2000)
    )
      throw Error("Quote text must contain 1 to 2,000 characters.");
    let index = rows.length,
      previous = null;
    if (operation !== "add") {
      index = input.number - 1;
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= rows.length ||
        input.token !== token(rows[index])
      )
        throw Error("The quote list changed. Refresh before editing this quote.");
      previous = rows[index];
    } else if (rows.length >= 10000) throw Error("Quote limit reached.");
    if (operation === "delete") rows.splice(index, 1);
    else if (operation === "edit") rows[index] = { ...previous, text: input.text.trim() };
    else rows.push({ text: input.text.trim(), author: "", createdAt: Date.now() });
    markDirty();
    try {
      flush();
    } catch {
      if (operation === "delete") rows.splice(index, 0, previous);
      else if (operation === "edit") rows[index] = previous;
      else rows.pop();
      throw Error("Could not save quotes. Your existing quotes have been kept.");
    }
    return { ok: true, operation, number: index + 1, total: rows.length };
  };
