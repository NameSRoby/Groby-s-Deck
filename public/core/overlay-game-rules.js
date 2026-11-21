/** Pure game rules shared by local previews and the authoritative server. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OverlayGameRules = factory();
})(globalThis, function () {
  function bingoLayout(w) {
    const columns = Number(w.gridSize),
      rows = Number(w.gridRows) || columns,
      count = rows * columns;
    const center =
      w.freeCenter && count > 1 && rows % 2 && columns % 2 ? Math.floor(count / 2) : -1;
    return { rows, columns, count, center };
  }
  const signature = (w) => {
    if (w.type !== "bingo") return JSON.stringify([w.type, w.items, w.entrySource]);
    const { rows, columns } = bingoLayout(w);
    return JSON.stringify(rows === columns ? [w.type, columns] : [w.type, columns, rows]);
  };
  function bingoBoard(w, marks = []) {
    const { rows, columns, count, center } = bingoLayout(w),
      marked = new Set(marks);
    if (center >= 0) marked.add(center);
    const complete = (length, at) =>
      Array.from({ length }, (_, i) => at(i)).every((i) => marked.has(i));
    const won =
      (columns > 1 &&
        Array.from({ length: rows }, (_, r) => complete(columns, (c) => r * columns + c)).some(
          Boolean,
        )) ||
      (rows > 1 &&
        Array.from({ length: columns }, (_, c) => complete(rows, (r) => r * columns + c)).some(
          Boolean,
        )) ||
      (rows === columns &&
        rows > 1 &&
        (complete(rows, (i) => i * columns + i) ||
          complete(rows, (i) => i * columns + columns - 1 - i))) ||
      (count === 1 && marked.has(0));
    return {
      rows,
      columns,
      won,
      cells: Array.from({ length: count }, (_, index) => ({
        text: index === center ? "FREE" : w.items[index] || "Square " + (index + 1),
        marked: marked.has(index),
        free: index === center,
      })),
    };
  }
  function initial(w) {
    return {
      signature: signature(w),
      version: 0,
      votes: {},
      voterCount: 0,
      counts: w.items.map(() => 0),
      open: false,
      endsAt: 0,
      marks: [],
      entries: w.entrySource === "chat" ? [] : [...w.items],
      collecting: false,
      entrants: {},
      winner: "",
      spunAt: 0,
      spinSeconds: w.spinSeconds,
      turns: 0,
    };
  }

  function control(current, w, operation, input = {}, at = Date.now(), random) {
    const s = structuredClone(current);
    if (operation === "reset") return { ...initial(w), version: s.version + 1 };
    else if (w.type === "wheel" && operation === "collect" && w.entrySource === "chat")
      s.collecting = true;
    else if (w.type === "wheel" && operation === "close-entries") s.collecting = false;
    else if (w.type === "wheel" && operation === "spin") {
      if (s.spunAt && at < s.spunAt + s.spinSeconds * 1000)
        throw Error("Wait for this spin to finish.");
      if (w.removeWinner && s.winner) s.entries.splice(s.winnerIndex, 1);
      if (!s.entries.length) throw Error("No entries remain. Reset the wheel to restore them.");
      s.collecting = false;
      s.winnerIndex = random(s.entries.length);
      s.winner = s.entries[s.winnerIndex];
      s.startAngle = s.angle || 0;
      s.angle =
        Math.ceil((s.startAngle + 2520) / 360) * 360 -
        ((s.winnerIndex + 0.5) * 360) / s.entries.length;
      s.spunAt = at;
      s.spinSeconds = w.spinSeconds;
      s.turns++;
    } else if (w.type === "chat-vote" && operation === "start") {
      if (w.items.length < 2 || w.items.length > 10) throw Error("Add 2 to 10 voting choices.");
      s.votes = {};
      s.voterCount = 0;
      s.counts = w.items.map(() => 0);
      s.open = true;
      s.endsAt = at + w.duration * 1000;
    } else if (w.type === "chat-vote" && operation === "close") s.open = false;
    else if (w.type === "bingo" && operation === "mark") {
      const index = Number(input.cell) - 1;
      const { count, center } = bingoLayout(w);
      if (!Number.isInteger(index) || index < 0 || index >= count)
        throw Error("Choose a square number on this board.");
      if (index === center)
        throw Error("The free center is always marked. Turn off Free center to mark it manually.");
      s.marks = s.marks.includes(index) ? s.marks.filter((n) => n !== index) : [...s.marks, index];
    } else throw Error("That control is not available for this widget.");

    s.version = current.version + 1;
    return s;
  }
  return { initial, signature, control, bingoLayout, bingoBoard };
});
