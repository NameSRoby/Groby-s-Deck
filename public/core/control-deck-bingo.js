/** One tile per saved overlay square. All edits go through the overlay game owner. */
/* global boardImageTint */
export function createDeckBingo({
  host,
  workspace,
  request,
  visible,
  onOpen,
  openDesigner,
  onClose,
}) {
  const tab = document.createElement("button"),
    panel = document.createElement("section");
  tab.type = "button";
  tab.textContent = "Game boards";
  tab.setAttribute("aria-controls", "deckBingo");
  tab.setAttribute("aria-pressed", "false");
  const fullscreenTabs = document.createElement("nav");
  fullscreenTabs.className = "deckFullscreenTabs";
  fullscreenTabs.setAttribute("aria-label", "Fullscreen views");
  fullscreenTabs.hidden = true;
  const buttonView = document.createElement("button");
  const gameView = document.createElement("button");
  buttonView.type = gameView.type = "button";
  buttonView.textContent = "Button pages";
  gameView.textContent = tab.textContent;
  gameView.setAttribute("aria-controls", "deckBingo");
  buttonView.onclick = onClose;
  gameView.onclick = onOpen;
  fullscreenTabs.append(buttonView, gameView);
  panel.id = "deckBingo";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Game board controls");
  panel.innerHTML = `
    <div class="deckBingoBar">
      <label>Saved board <select aria-label="Saved game board"></select></label>
      <label data-mark-picker hidden>Mark as <select aria-label="Mark as"></select></label>
      <label data-completed-picker hidden><input type="checkbox" aria-label="Show completed tiles"> Show completed tiles</label>
      <button type="button" data-reset>Reset board</button>
      <button type="button" data-designer>Overlay designer</button>
      <button type="button" data-retry hidden>Retry</button>
    </div>
    <div class="deckBingoStage"><div class="deckBingoGrid" role="group" aria-label="Board squares"></div></div>
    <p class="deckBingoStatus" role="status"></p>
    <dialog class="deckBingoConfirm">
      <p>Clear every mark on this board?</p>
      <form method="dialog"><button value="cancel">Cancel</button><button value="reset">Clear marks</button></form>
    </dialog>`;
  workspace.after(panel);
  const picker = panel.querySelector("select"),
    markPicker = panel.querySelector("[data-mark-picker] select"),
    reveal = panel.querySelector("[data-completed-picker] input"),
    grid = panel.querySelector(".deckBingoGrid"),
    status = panel.querySelector(".deckBingoStatus"),
    reset = panel.querySelector("[data-reset]"),
    retry = panel.querySelector("[data-retry]"),
    dialog = panel.querySelector("dialog");
  let active = false,
    available = false,
    pending = false,
    sending = false,
    timer,
    target = "",
    optionsKey = "",
    conditionKey = "",
    value = null,
    writeCount = 0,
    error = "";
  const key = (row) => JSON.stringify([row.documentId, row.widgetId]);
  const browsing = () => active && visible();
  const watching = () => visible() && (active || host.dataset.focus === "true");
  function syncTabs() {
    fullscreenTabs.hidden = !available && !active;
    buttonView.setAttribute("aria-pressed", String(!active));
    gameView.setAttribute("aria-pressed", String(active));
  }
  function setAvailability(value) {
    available = value;
    syncTabs();
  }
  const notice = (message) => {
    if (status.textContent !== message) status.textContent = message;
  };
  function progress(board) {
    if (board.operation === "flip") {
      return board.won
        ? "All pairs matched in " + board.attempts + " attempts."
        : board.matched + " of " + board.cells.length / 2 + " pairs matched.";
    }
    return (
      (board.won ? "Bingo! " : "") +
      board.cells.filter((cell) => cell.marked).length +
      " of " +
      board.cells.length +
      " marked."
    );
  }
  function paint() {
    const board = value?.board;
    if (value && JSON.stringify(value.boards) !== optionsKey) {
      optionsKey = JSON.stringify(value.boards);
      picker.replaceChildren(...value.boards.map((row) => new Option(row.label, key(row))));
    }
    picker.disabled = !value?.boards.length || sending;
    reset.disabled =
      !board ||
      Boolean(value.error) ||
      sending ||
      !board.cells.some((c) =>
        board.operation === "flip"
          ? !c.covered || board.attempts
          : !c.free && (c.marked || (c.condition && c.condition !== "pending")),
      );
    if (board) picker.value = key(board);
    const conditions = new Map((board?.conditions || []).map((item) => [item.id, item]));
    markPicker.parentElement.hidden = !conditions.size || board?.operation === "flip";
    markPicker.disabled = sending;
    reveal.parentElement.hidden = !board?.hideCompletedTiles;
    const options = JSON.stringify([...conditions.values()].map(({ id, name }) => [id, name]));
    if (options !== conditionKey) {
      const previous = markPicker.value;
      conditionKey = options;
      markPicker.replaceChildren(
        new Option("Toggle completion", ""),
        ...[...conditions.values()].map(({ id, name }) => new Option(name, id)),
      );
      markPicker.value = conditions.has(previous) ? previous : "";
    }
    const cells = board?.cells || [];
    grid.classList.toggle("freeform", board?.freeform === true);
    grid.style.setProperty("--bingo-columns", String(board?.columns || 1));
    grid.style.aspectRatio = board?.freeform ? board.width + " / " + board.height : "";
    grid.style.setProperty("--board-aspect", board?.freeform ? board.width / board.height : "");
    grid.style.backgroundImage = board?.image ? `url(${JSON.stringify(board.image)})` : "";
    grid.style.backgroundSize = board?.imageFit || "";
    grid.style.setProperty("--board-back-color", board?.matchBackColor || "");
    grid.dataset.markMode = board?.markMode || "color";
    while (grid.children.length > cells.length) grid.lastElementChild.remove();
    for (const [index, cell] of cells.entries()) {
      let button = grid.children[index];
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.onclick = () => {
          const condition = value?.board?.operation !== "flip" ? markPicker.value : "";
          void act(
            condition ? "condition" : value?.board?.operation || "mark",
            index + 1,
            null,
            condition,
          );
        };
        const image = document.createElement("img"),
          label = document.createElement("span"),
          symbol = document.createElement("span");
        image.alt = "";
        label.className = "deckBoardLabel";
        symbol.className = "deckBoardSymbol";
        symbol.setAttribute("aria-hidden", "true");
        button.append(image, label, symbol);
        grid.append(button);
      }
      const [image, label, symbol] = button.children;
      image.hidden = !cell.image;
      if (cell.image && image.getAttribute("src") !== cell.image) image.src = cell.image;
      image.style.objectFit = board.cellImageFit;
      button.classList.toggle("covered", cell.covered === true);
      button.dataset.condition = cell.condition || (cell.marked ? "completed" : "pending");
      button.dataset.labelPosition = cell.covered ? "center" : cell.labelPosition || "center";
      button.classList.toggle(
        "border-hidden",
        board.showBorders === false || cell.borderHidden === true,
      );
      button.classList.toggle(
        "completed-hidden",
        board.hideCompletedTiles &&
          !reveal.checked &&
          cell.marked &&
          (board.operation === "flip" || !cell.free),
      );
      label.hidden =
        !cell.covered &&
        (cell.labelHidden ||
          (board.showLabels === false && (Boolean(cell.image) || board.operation !== "flip")));
      const text = cell.covered ? board.matchBack : cell.text;
      if (label.textContent !== text) label.textContent = text;
      const style =
        conditions.get(button.dataset.condition) ||
        (cell.marked
          ? {
              mode: board.markMode,
              color: board.markColor,
              opacity: board.markOpacity,
              tintTarget: board.markTintTarget,
              symbol: board.markSymbol,
              symbolColor: board.markSymbolColor,
            }
          : {});
      symbol.hidden = !style.symbol || !["symbol", "both"].includes(style.mode);
      if (symbol.textContent !== (style.symbol || "")) symbol.textContent = style.symbol || "";
      symbol.style.color = style.symbolColor || "";
      if (board.freeform)
        Object.assign(button.style, {
          left: cell.x + "%",
          top: cell.y + "%",
          width: cell.width + "%",
          height: cell.height + "%",
          transform: `rotate(${cell.rotation}deg)`,
        });
      else button.removeAttribute("style");
      image.style.filter = boardImageTint(style);
      if (style.tintTarget !== "image" && ["color", "both"].includes(style.mode)) {
        button.style.setProperty("--board-mark-color", style.color);
        button.style.setProperty("--board-mark-opacity", (style.opacity ?? 100) / 100);
      } else {
        button.style.removeProperty("--board-mark-color");
        button.style.removeProperty("--board-mark-opacity");
      }
      button.setAttribute("aria-pressed", String(cell.marked));
      button.setAttribute(
        "aria-label",
        board.operation === "flip"
          ? cell.covered
            ? "Flip tile " + (index + 1)
            : "Tile " + (index + 1) + ": " + cell.text
          : "Square " + (index + 1) + ": " + cell.text,
      );
      button.disabled = cell.free || board.waiting === true || Boolean(value.error);
    }
    for (const position of ["above", "below"])
      grid.classList.toggle(
        "labels-" + position,
        Array.from(grid.children).some(
          (button) =>
            button.dataset.labelPosition === position &&
            !button.querySelector(".deckBoardLabel").hidden,
        ),
      );
    grid.setAttribute("aria-busy", String(sending));
    notice(
      error ||
        value?.error ||
        (board
          ? progress(board)
          : value
            ? "Save a visible board in Overlay Designer to play here."
            : "Loading saved boards…"),
    );
  }
  function schedule(delay = 1000) {
    clearTimeout(timer);
    if (watching()) timer = setTimeout(() => void refresh(), delay);
  }
  async function refresh() {
    if (!watching() || pending || sending) {
      schedule();
      return;
    }
    pending = true;
    if (!active) {
      try {
        const result = await request("/api/stream-overlays/bingo-deck?availableOnly=1");
        if (!active) setAvailability(result.available === true);
      } catch {
        // Keep the last known availability during a connection interruption.
      } finally {
        pending = false;
        schedule(active ? 0 : 3000);
      }
      return;
    }
    const selected = target,
      priorWrites = writeCount;
    const [documentId, widgetId] = selected ? JSON.parse(selected) : ["", ""];
    try {
      const next = await request(
        "/api/stream-overlays/bingo-deck?" + new URLSearchParams({ documentId, widgetId }),
      );
      if (selected === target && !sending && priorWrites === writeCount) {
        value = next;
        setAvailability(next.boards.length > 0);
        target = next.board ? key(next.board) : "";
        retry.hidden = true;
        paint();
      }
    } catch {
      if (selected === target && !sending && priorWrites === writeCount) {
        retry.hidden = false;
        value = null;
        paint();
        notice("Could not load saved boards. Check that Core is up to date and connected.");
      }
    } finally {
      pending = false;
      schedule(selected && selected !== target ? 0 : value?.board?.waiting ? 250 : 1000);
    }
  }
  async function act(operation, cell, confirmed = null, condition = "") {
    const board = value?.board;
    if (!browsing() || sending || !board || value.error) return;
    if (
      confirmed &&
      (key(board) !== confirmed.target ||
        board.version !== confirmed.version ||
        value.revision !== confirmed.revision)
    ) {
      error = "The board changed while you were confirming. Review it before resetting.";
      paint();
      return;
    }
    sending = true;
    writeCount++;
    error = "";
    paint();
    try {
      value = await request("/api/stream-overlays/game-control", "POST", {
        documentId: board.documentId,
        widgetId: board.widgetId,
        operation,
        cell,
        ...(condition ? { condition } : {}),
        version: board.version,
        revision: value.revision,
        returnBingo: true,
      });
    } catch (failure) {
      error = failure.message;
    } finally {
      sending = false;
      paint();
      schedule(0);
    }
  }
  tab.onclick = onOpen;
  picker.onchange = () => {
    target = picker.value;
    reveal.checked = false;
    markPicker.value = "";
    value = null;
    error = "";
    paint();
    schedule(0);
  };
  reveal.onchange = paint;
  reset.onclick = () => {
    const board = value?.board;
    if (!board) return;
    const confirmed = { target: key(board), version: board.version, revision: value.revision };
    dialog.querySelector("p").textContent =
      board.operation === "flip"
        ? "Shuffle the tiles and start a new round?"
        : "Clear every mark on this board?";
    dialog.querySelector('[value="reset"]').textContent =
      board.operation === "flip" ? "New round" : "Clear marks";
    dialog.returnValue = "";
    dialog.onclose = () => {
      if (dialog.returnValue === "reset") void act("reset", undefined, confirmed);
    };
    dialog.showModal();
  };
  retry.onclick = () => schedule(0);
  panel.querySelector("[data-designer]").onclick = openDesigner;
  addEventListener("pagehide", () => {
    clearTimeout(timer);
    if (dialog.open) dialog.close();
  });
  new MutationObserver(() => schedule(0)).observe(host, {
    attributes: true,
    attributeFilter: ["data-focus"],
  });
  return {
    tab,
    fullscreenTabs,
    focusTab: () => (host.dataset.focus === "true" ? gameView : tab).focus(),
    sync: () => schedule(0),
    set(open) {
      if (active === open) return;
      active = open;
      panel.hidden = !open;
      host.dataset.bingoPage = String(open);
      tab.setAttribute("aria-pressed", String(open));
      syncTabs();
      if (open) paint();
      else if (dialog.open) dialog.close();
      schedule(0);
    },
  };
}
