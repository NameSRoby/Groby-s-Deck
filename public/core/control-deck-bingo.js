/** One tile per saved overlay square. All edits go through the overlay game owner. */
export function createDeckBingo({ host, workspace, request, visible, onOpen, openDesigner }) {
  const tab = document.createElement("button"),
    panel = document.createElement("section");
  tab.type = "button";
  tab.textContent = "Bingo";
  tab.setAttribute("aria-controls", "deckBingo");
  tab.setAttribute("aria-pressed", "false");
  panel.id = "deckBingo";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Bingo controls");
  panel.innerHTML = `
    <div class="deckBingoBar">
      <label>Saved board <select aria-label="Saved Bingo board"></select></label>
      <button type="button" data-reset>Reset board</button>
      <button type="button" data-designer>Overlay designer</button>
      <button type="button" data-retry hidden>Retry</button>
    </div>
    <div class="deckBingoStage"><div class="deckBingoGrid" role="group" aria-label="Bingo squares"></div></div>
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
  const notice = (message) => {
    if (status.textContent !== message) status.textContent = message;
  };
  function paint() {
    const board = value?.board;
    if (value && JSON.stringify(value.boards) !== optionsKey) {
      optionsKey = JSON.stringify(value.boards);
      picker.replaceChildren(...value.boards.map((row) => new Option(row.label, key(row))));
    }
    picker.disabled = !value?.boards.length || sending;
    reset.disabled =
      !board || Boolean(value.error) || sending || !board.cells.some((c) => c.marked && !c.free);
    if (board) picker.value = key(board);
    const cells = board?.cells || [];
    grid.style.setProperty("--bingo-columns", String(board?.columns || 1));
    while (grid.children.length > cells.length) grid.lastElementChild.remove();
    for (const [index, cell] of cells.entries()) {
      let button = grid.children[index];
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.onclick = () => void act("mark", index + 1);
        grid.append(button);
      }
      if (button.textContent !== cell.text) button.textContent = cell.text;
      button.setAttribute("aria-pressed", String(cell.marked));
      button.setAttribute("aria-label", "Square " + (index + 1) + ": " + cell.text);
      button.disabled = cell.free || Boolean(value.error);
    }
    grid.setAttribute("aria-busy", String(sending));
    notice(
      error ||
        value?.error ||
        (board
          ? (board.won ? "Bingo! " : "") +
            cells.filter((cell) => cell.marked).length +
            " of " +
            cells.length +
            " marked."
          : value
            ? "Save a visible Bingo board in Overlay designer to play here."
            : "Loading saved Bingo boards…"),
    );
  }
  function schedule(delay = 1000) {
    clearTimeout(timer);
    if (browsing()) timer = setTimeout(() => void refresh(), delay);
  }
  async function refresh() {
    if (!browsing() || pending || sending) {
      schedule();
      return;
    }
    pending = true;
    const selected = target,
      priorWrites = writeCount;
    const [documentId, widgetId] = selected ? JSON.parse(selected) : ["", ""];
    try {
      const next = await request(
        "/api/stream-overlays/bingo-deck?" + new URLSearchParams({ documentId, widgetId }),
      );
      if (selected === target && !sending && priorWrites === writeCount) {
        value = next;
        target = next.board ? key(next.board) : "";
        retry.hidden = true;
        paint();
      }
    } catch {
      if (selected === target && !sending && priorWrites === writeCount) {
        retry.hidden = false;
        value = null;
        paint();
        notice("Could not load Bingo boards. Check that Core is up to date and connected.");
      }
    } finally {
      pending = false;
      schedule(selected && selected !== target ? 0 : 1000);
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
  return {
    tab,
    sync: () => schedule(0),
    set(open) {
      if (active === open) return;
      active = open;
      panel.hidden = !open;
      host.dataset.bingoPage = String(open);
      tab.setAttribute("aria-pressed", String(open));
      if (open) {
        paint();
        schedule(0);
      } else {
        clearTimeout(timer);
        if (dialog.open) dialog.close();
      }
    },
  };
}
