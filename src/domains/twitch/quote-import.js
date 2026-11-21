/** Parse copied quote rows without treating page metadata as another quote. No network or DOM. */
function parse(source, mode = "auto") {
  if (typeof source !== "string" || source.length > 100000)
    throw Error("Paste up to 100,000 characters at a time.");
  const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  const decode = (text) =>
    text
      .replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (token, key) => {
        if (key[0] !== "#") return entities[key.toLowerCase()] || token;
        const n =
          key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : token;
      })
      .replace(/\\([_*])/g, "$1")
      .trim();
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const marker = (line) => /^(?:\|\s*)?#(\d+)(?:\s*\|[\s|]*)?$/.exec(line.trim());
  const numbered = mode !== "lines" && lines.some(marker);
  const rows = [],
    warnings = [];
  let current = null,
    ignored = 0;
  const date =
    /^(?:\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2})$/i;
  function finish() {
    if (!current) return;
    const text = current.parts.join(" ").replace(/\s+/g, " ").trim();
    if (text) rows.push({ text, ...current.metadata, ...(current.id ? { id: current.id } : {}) });
    else warnings.push("Quote #" + current.id + " has no text and was skipped.");
    current = null;
  }
  for (const raw of lines) {
    const line = decode(raw);
    if (!line || /^["']$/.test(line)) continue;
    const id = marker(line);
    if (numbered && id) {
      finish();
      current = { id: Number(id[1]), parts: [], metadata: {} };
      continue;
    }
    if (
      /^\|?[\s:|\-]+\|?$/.test(line) ||
      /^(?:quotes|quote|actions|search quotes|add quote)$/i.test(line)
    ) {
      ignored++;
      continue;
    }
    let cells = line.startsWith("|")
      ? line
          .slice(1)
          .replace(/\|$/, "")
          .split("|")
          .map((v) => v.trim())
      : line.split(/\t+|\s{2,}/).map((v) => v.trim());
    if (numbered && date.test(cells[0]) && cells.length >= 2) {
      if (current)
        current.metadata = {
          sourceDate: cells[0],
          category: cells[1] === "-" ? "" : cells[1],
          author: cells[2] === "-" ? "" : cells[2] || "",
        };
      ignored++;
      continue;
    }
    if (
      numbered &&
      /^(?:quote|added|date|game|category|added by|user)(?:\s|\||\t)/i.test(line) &&
      line.includes("|")
    ) {
      ignored++;
      continue;
    }
    if (!numbered) {
      rows.push({ text: line });
      continue;
    }
    if (!current) {
      ignored++;
      continue;
    }
    current.parts.push(line);
  }
  finish();
  if (rows.length > 1000) throw Error("Import at most 1,000 quotes per batch.");
  const seen = new Set();
  const quotes = rows.filter((row) => {
    const key = row.text.normalize("NFC");
    if (seen.has(key)) {
      warnings.push("A repeated quote in this paste was skipped.");
      return false;
    }
    seen.add(key);
    return true;
  });
  if (numbered) quotes.sort((a, b) => a.id - b.id);
  for (const row of quotes)
    if (row.text.length > 2000)
      throw Error("A quote exceeds 2,000 characters. Edit it before importing.");
  return { quotes, ignored, warnings, format: numbered ? "copied rows" : "one quote per line" };
}
module.exports = { parse };
