/** Validate whole batches before mutation; quote duplicates are identified by their text. */
module.exports =
  ({ account, viewer, flush, markDirty }) =>
  (bundle, apply = false) => {
    if (
      !bundle ||
      !/^\d{1,80}$/.test(bundle.owner) ||
      ![bundle.watchtime || [], bundle.points || [], bundle.quotes || []].every(Array.isArray)
    )
      throw Error("Invalid import file.");
    const watchtime = bundle.watchtime || [],
      points = bundle.points || [],
      quotes = bundle.quotes || [];
    if (watchtime.length > 25000 || points.length > 25000 || quotes.length > 1000)
      throw Error("Import limit exceeded.");
    for (const row of [...watchtime, ...points]) {
      if (
        !/^[a-z0-9_]{1,25}$/i.test(row?.username || "") ||
        !Number.isSafeInteger(row.minutes ?? row.points) ||
        (row.minutes ?? row.points) < 0 ||
        (row.minutes ?? row.points) > 1000000000
      )
        throw Error("Invalid viewer import row.");
    }
    const cleanQuotes = quotes.map((row) => {
      if (typeof row === "string") row = { text: row };
      if (!row || typeof row.text !== "string" || !row.text.trim() || row.text.length > 2000)
        throw Error("Quote text must contain 1 to 2,000 characters.");
      for (const [field, max] of [
        ["author", 80],
        ["category", 200],
        ["sourceDate", 80],
      ])
        if (row[field] !== undefined && (typeof row[field] !== "string" || row[field].length > max))
          throw Error("Invalid quote " + field + ".");
      if (
        row.id !== undefined &&
        (!Number.isSafeInteger(row.id) || row.id < 1 || row.id > 1000000000)
      )
        throw Error("Invalid quote source number.");
      if (
        row.createdAt !== undefined &&
        (!Number.isSafeInteger(row.createdAt) || row.createdAt < 0)
      )
        throw Error("Invalid quote date.");
      return {
        text: row.text.trim(),
        author: row.author || "",
        createdAt: row.createdAt || 0,
        sourceId: row.id ?? null,
        category: row.category || "",
        sourceDate: row.sourceDate || "",
      };
    });
    const target = account(bundle.owner),
      known = new Set(
        target.quotes.map((row) => row.text.normalize("NFC").replace(/\s+/g, " ").trim()),
      );
    const fresh = cleanQuotes.filter((row) => {
      const key = row.text.normalize("NFC").replace(/\s+/g, " ").trim();
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    if (fresh.length + target.quotes.length > 10000) throw Error("Quote limit reached.");
    const digest = require("node:crypto")
      .createHash("sha256")
      .update(JSON.stringify(bundle))
      .digest("hex");
    const summary = {
      watchtime: watchtime.length,
      points: points.length,
      quotes: fresh.length,
      duplicates: quotes.length - fresh.length,
      alreadyImported: target.imports.includes(digest),
    };
    if (!apply || summary.alreadyImported) return summary;
    for (const row of watchtime)
      viewer(bundle.owner, row.username).importedMinutes = Math.max(
        viewer(bundle.owner, row.username).importedMinutes,
        row.minutes,
      );
    for (const row of points)
      viewer(bundle.owner, row.username).importedPoints = Math.max(
        viewer(bundle.owner, row.username).importedPoints,
        row.points,
      );
    target.quotes.push(...fresh);
    target.imports.push(digest);
    target.imports = target.imports.slice(-10000);
    markDirty();
    flush();
    return summary;
  };
