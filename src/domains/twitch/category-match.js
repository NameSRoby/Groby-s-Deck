const normalize = (value) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
function distance(a, b) {
  let prior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(row[j - 1] + 1, prior[j] + 1, prior[j - 1] + Number(a[i - 1] !== b[j - 1]));
    prior = row;
  }
  return prior[b.length];
}
module.exports = (query, rows) => {
  const term = normalize(query).slice(0, 100);
  const ranked = rows
    .map((row) => {
      const name = normalize(row.name).slice(0, 150);
      const exact = name === term;
      const prefix = name.startsWith(term + " ");
      const score = exact
        ? 1
        : prefix
          ? 0.9
          : 1 - distance(term, name) / Math.max(term.length, name.length, 1);
      return { ...row, score };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (!ranked.length || ranked[0].score < 0.55)
    return { ok: false, error: "No close category found. Try its full Twitch name." };
  if (ranked[0].score < 1 && ranked[1] && ranked[0].score - ranked[1].score < 0.08)
    return {
      ok: false,
      error:
        "Category is ambiguous: " +
        ranked
          .slice(0, 3)
          .map((row) => row.name)
          .join(", ") +
        ". Use a fuller name.",
    };
  return { ok: true, id: ranked[0].id, name: ranked[0].name };
};
