/** One tile per saved overlay square. All edits go through the overlay game owner. */
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
        board.operation === "flip" ? !c.covered || board.attempts : c.marked && !c.free,
      );
    if (board) picker.value = key(board);
    const cells = board?.cells || [];
    grid.classList.toggle("freeform", board?.freeform === true);
    grid.style.setProperty("--bingo-columns", String(board?.columns || 1));
    grid.style.aspectRatio = board?.freeform ? board.width + " / " + board.height : "";
    grid.style.setProperty("--board-aspect", board?.freeform ? board.width / board.height : "");
    grid.style.backgroundImage = board?.image ? `url(${JSON.stringify(board.image)})` : "";
    grid.style.backgroundSize = board?.imageFit || "";
    grid.style.setProperty("--board-mark-color", board?.markColor || "");
    grid.style.setProperty("--board-mark-opacity", (board?.markOpacity ?? 100) / 100);
    grid.style.setProperty("--board-symbol-color", board?.markSymbolColor || "");
    grid.style.setProperty("--board-back-color", board?.matchBackColor || "");
    grid.dataset.markMode = board?.markMode || "color";
    while (grid.children.length > cells.length) grid.lastElementChild.remove();
    for (const [index, cell] of cells.entries()) {
      let button = grid.children[index];
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.onclick = () => void act(value?.board?.operation || "mark", index + 1);
        const image = document.createElement("img"),
          label = document.createElement("span"),
          symbol = document.createElement("span");
        image.alt = "";
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
      label.hidden =
        !cell.covered &&
        (cell.labelHidden ||
          (board.showLabels === false && (Boolean(cell.image) || board.operation !== "flip")));
      const text = cell.covered ? board.matchBack : cell.text;
      if (label.textContent !== text) label.textContent = text;
      symbol.hidden = !cell.marked || board.markMode === "color";
      if (symbol.textContent !== board.markSymbol) symbol.textContent = board.markSymbol;
      if (board.freeform)
        Object.assign(button.style, {
          left: cell.x + "%",
          top: cell.y + "%",
          width: cell.width + "%",
          height: cell.height + "%",
          transform: `rotate(${cell.rotation}deg)`,
        });
      else button.removeAttribute("style");
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
  async function act(operation, cell, confirmed = null) {
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
    value = null;
    error = "";
    paint();
    schedule(0);
  };
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
