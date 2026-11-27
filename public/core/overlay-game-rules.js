/** Pure game rules shared by local previews and the authoritative server. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OverlayGameRules = factory();
})(globalThis, function () {
  const markTypes = ["bingo", "challenge-board"];
  const boardTypes = [...markTypes, "tile-match"];
  const types = ["wheel", "chat-vote", ...boardTypes];
  const responsive = (w) =>
    w.visible && (["alerts", "credits"].includes(w.type) || types.includes(w.type));
  function bingoLayout(w) {
    const columns = Number(w.gridSize),
      rows = Number(w.gridRows) || columns,
      count = rows * columns;
    const center =
      w.freeCenter && count > 1 && rows % 2 && columns % 2 ? Math.floor(count / 2) : -1;
    return { rows, columns, count, center };
  }
  const signature = (w) => {
    if (w.type === "challenge-board") return w.type;
    if (w.type === "tile-match")
      return JSON.stringify([w.type, w.matchPairs.map((pair) => pair.id)]);
    if (w.type !== "bingo") return JSON.stringify([w.type, w.items, w.entrySource]);
    const { rows, columns } = bingoLayout(w);
    return JSON.stringify(rows === columns ? [w.type, columns] : [w.type, columns, rows]);
  };
  function bingoWins(w, layout, marked) {
    const { rows, columns, count, center } = layout;
    if (center >= 0) marked.add(center);
    const patterns = w.bingoPatterns;
    const wins = [];
    function line(id, length, start, stride) {
      for (let i = 0; i < length; i++) if (!marked.has(start + i * stride)) return;
      wins.push(id);
    }
    if (patterns.includes("rows") && (columns > 1 || count === 1))
      for (let row = 0; row < rows; row++) line("row" + row, columns, row * columns, 1);
    if (patterns.includes("columns") && (rows > 1 || count === 1))
      for (let column = 0; column < columns; column++)
        line("column" + column, rows, column, columns);
    if (patterns.includes("diagonals") && rows === columns && rows > 1) {
      line("diagonal", rows, 0, columns + 1);
      line("reverse", rows, columns - 1, columns - 1);
    }
    if (patterns.includes("all")) line("all", count, 0, 1);
    return wins;
  }
  function bingoBoard(w, marks = []) {
    const layout = bingoLayout(w),
      { rows, columns, count, center } = layout,
      marked = new Set(marks),
      wins = bingoWins(w, layout, marked);
    return {
      rows,
      columns,
      won: wins.length > 0,
      cells: Array.from({ length: count }, (_, index) => ({
        text: index === center ? "FREE" : w.items[index] || "Square " + (index + 1),
        image: w.boardImages[index] || "",
        ...(index !== center && w.boardHiddenLabels?.[index] ? { labelHidden: true } : {}),
        marked: marked.has(index),
        free: index === center,
      })),
    };
  }
  function matchFaces(s, at) {
    const flipped = s.matchUntil && at >= s.matchUntil ? [] : s.matchOpen || [];
    return Object.fromEntries(
      [...(s.marks || []), ...flipped].map((index) => [index, s.matchOrder?.[index]]),
    );
  }
  function matchBoard(w, s, at) {
    const faces = s.matchFaces || matchFaces(s, at),
      marked = new Set(s.marks),
      count = w.matchPairs.length * 2,
      columns = Math.min(count, w.matchColumns),
      waiting = Boolean(s.matchUntil && at < s.matchUntil);
    return {
      operation: "flip",
      columns,
      rows: Math.ceil(count / columns),
      matched: marked.size / 2,
      attempts: s.turns || 0,
      waiting,
      won: marked.size === count,
      cells: Array.from({ length: count }, (_, index) => {
        const revealed = marked.has(index) || waiting || !s.matchUntil;
        const pair = revealed ? w.matchPairs[faces[index]] : null;
        return {
          text: pair ? pair.text || "Pair " + (faces[index] + 1) : "Tile " + (index + 1),
          image: pair?.image || "",
          ...(pair?.labelHidden ? { labelHidden: true } : {}),
          marked: marked.has(index),
          covered: !pair,
          free: Boolean(pair),
        };
      }),
    };
  }
  function showLabel(cell, showLabels, isMatch) {
    return (
      cell.covered || (!cell.labelHidden && (showLabels !== false || (isMatch && !cell.image)))
    );
  }
  const challengeCount = (w) =>
    w.challengeLayout === "grid" ? w.gridSize * w.gridRows : w.tiles.length;
  function challengeGeometry(w, tile, index) {
    if (w.challengeLayout !== "grid") return tile;
    const width = (tile.gridWidth ?? w.challengeTileWidth) / w.gridSize;
    const height = (tile.gridHeight ?? w.challengeTileHeight) / w.gridRows;
    return {
      x: (((index % w.gridSize) + 0.5) * 100) / w.gridSize - width / 2,
      y: ((Math.floor(index / w.gridSize) + 0.5) * 100) / w.gridRows - height / 2,
      width,
      height,
      rotation: 0,
    };
  }
  function board(w, s = {}, at = Date.now()) {
    if (w.type === "bingo") return bingoBoard(w, s.marks);
    if (w.type === "tile-match") return matchBoard(w, s, at);
    const marked = new Set(s.marks);
    return {
      freeform: true,
      cells: w.tiles.slice(0, challengeCount(w)).map((tile, index) => ({
        ...tile,
        ...challengeGeometry(w, tile, index),
        text: tile.text || "Tile " + (index + 1),
        marked: marked.has(tile.id),
      })),
    };
  }
  function flip(s, w, cell, at, random) {
    const index = Number(cell) - 1,
      count = w.matchPairs.length * 2;
    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw Error("Choose a tile on this board.");
    if (s.matchUntil > at) throw Error("Wait for the mismatched tiles to flip back.");
    if (!s.matchOrder) {
      s.matchOrder = Array.from({ length: count }, (_, i) => i % w.matchPairs.length);
      for (let i = count - 1; i > 0; i--) {
        const j = random(i + 1);
        [s.matchOrder[i], s.matchOrder[j]] = [s.matchOrder[j], s.matchOrder[i]];
      }
    }
    s.matchOpen = s.matchUntil ? [] : s.matchOpen || [];
    s.matchUntil = 0;
    if (s.marks.includes(index) || s.matchOpen.includes(index))
      throw Error("That tile is already face up.");
    s.matchOpen.push(index);
    if (s.matchOpen.length === 1) return;
    s.turns++;
    const [first, second] = s.matchOpen;
    if (s.matchOrder[first] === s.matchOrder[second]) {
      s.marks.push(first, second);
      s.matchOpen = [];
    } else s.matchUntil = at + w.matchRevealSeconds * 1000;
  }
  function initial(w) {
    return {
      signature: signature(w),
      version: 0,
      votes: {},
      voterCount: 0,
      counts: w.type === "chat-vote" ? w.items.map(() => 0) : [],
      open: false,
      endsAt: 0,
      marks: [],
      entries: w.type === "wheel" && w.entrySource !== "chat" ? [...w.items] : [],
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
    else if (w.type === "tile-match" && operation === "flip") flip(s, w, input.cell, at, random);
    else if (markTypes.includes(w.type) && ["mark", "complete", "uncomplete"].includes(operation)) {
      const index = Number(input.cell) - 1;
      const layout = w.type === "bingo" ? bingoLayout(w) : { count: challengeCount(w), center: -1 };
      const { count, center } = layout;
      if (!Number.isInteger(index) || index < 0 || index >= count)
        throw Error("Choose a square number on this board.");
      if (index === center)
        throw Error("The free center is always marked. Turn off Free center to mark it manually.");
      const tile = w.type === "challenge-board" ? w.tiles[index] : null;
      const key = tile?.id ?? index;
      if (tile) {
        const ids = new Set(w.tiles.map((row) => row.id));
        s.marks = s.marks.filter((id) => ids.has(id));
      } else {
        s.entries = [];
        s.counts = [];
      }
      const before = new Set(s.marks);
      const wasMarked = before.has(key);
      const marked = operation === "mark" ? !wasMarked : operation === "complete";
      if (marked === wasMarked) return current;
      if (!marked) before.delete(key);
      else before.add(key);
      s.marks = [...before];
      if (!tile) {
        const previous = new Set(bingoWins(w, layout, new Set(current.marks)));
        const completed = bingoWins(w, layout, new Set(s.marks)).some((win) => !previous.has(win));
        if (completed) s.bingoAt = at;
      }
    } else throw Error("That control is not available for this widget.");

    s.version = current.version + 1;
    return s;
  }
  return {
    initial,
    signature,
    control,
    bingoLayout,
    showLabel,
    bingoBoard,
    challengeCount,
    challengeGeometry,
    board,
    boardTypes,
    markTypes,
    matchFaces,
    types,
    responsive,
  };
});
