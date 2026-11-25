/* global call, createVisibleDialog */
/** Quote text is plain data. UI writes use the exact record token that was displayed. */
(() => {
  const q = (id) => document.getElementById(id),
    rpc = (payload) => call("community-quotes", payload);
  const deleteDialog = createVisibleDialog(q("quoteDeleteDialog"));
  let state = { offset: 0, limit: 25, total: 0, matched: 0, rows: [] },
    editing = null,
    deleting = null,
    busy = false,
    ready = false,
    searchTimer;
  const status = (text) => {
    q("quoteListStatus").textContent = text;
  };
  function controls() {
    q("quoteChatEnabled").disabled = busy || state.enabled === undefined;
    for (const id of ["quoteNew", "quoteRefresh", "quoteSave", "quoteDeleteConfirm"])
      q(id).disabled = busy;
    q("quotePrevious").disabled = busy || state.offset === 0;
    q("quoteNext").disabled = busy || state.offset + state.rows.length >= state.matched;
  }
  async function task(work) {
    if (busy) return;
    busy = true;
    controls();
    try {
      await work();
    } catch (error) {
      status(error.message);
      q("quoteEditStatus").textContent = error.message;
      q("quoteDeleteStatus").textContent = error.message;
    } finally {
      busy = false;
      controls();
    }
  }
  function open(row) {
    editing = row || { number: 0 };
    q("quoteEditorTitle").textContent = row ? "Edit quote #" + row.number : "Add quote";
    q("quoteText").value = row?.text || "";
    q("quoteEditStatus").textContent = "";
    q("quoteEditor").hidden = false;
    q("quoteText").focus();
    q("quoteEditor").scrollIntoView({ block: "nearest" });
  }
  function close() {
    editing = null;
    q("quoteEditor").hidden = true;
  }
  const button = (label, run) => {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.onclick = () => {
      if (!busy) run();
    };
    return el;
  };
  async function load(offset = state.offset) {
    if (!ready) ready = (await call("catalog")).supportsQuoteManagement === true;
    if (!ready)
      throw Error("Restart Core to load the editable quote list. Your saved quotes are kept.");
    state = await rpc({ operation: "list", offset, limit: 25, search: q("quoteSearch").value });
    updateQuoteSetting();
    q("quoteNew").hidden = false;
    q("quoteRows").replaceChildren(
      ...state.rows.map((row) => {
        const article = document.createElement("article"),
          number = document.createElement("strong"),
          text = document.createElement("p"),
          meta = document.createElement("small"),
          actions = document.createElement("div");
        article.className = "quoteRow";
        number.textContent = "#" + row.number;
        text.textContent = row.text;
        meta.textContent = [row.category, row.sourceDate, row.author].filter(Boolean).join(" · ");
        actions.className = "toolbar";
        actions.append(
          button("Edit", () => {
            if (editing) {
              status("Save or cancel your current edit first.");
              return;
            }
            open(row);
          }),
          button("Delete", () => {
            deleting = row;
            q("quoteDeleteText").textContent =
              "Delete quote #" + row.number + "? Remaining quotes will be renumbered.";
            q("quoteDeleteStatus").textContent = "";
            void deleteDialog.open();
          }),
        );
        article.append(number, text, meta, actions);
        return article;
      }),
    );
    q("quoteCount").textContent =
      state.matched === state.total
        ? state.total + " quotes"
        : state.matched + " of " + state.total + " quotes match";
    q("quotePage").textContent = state.matched
      ? state.offset + 1 + "–" + (state.offset + state.rows.length)
      : "";
    status(
      !state.total
        ? "No quotes yet. Add one or open Import quotes below."
        : !state.matched
          ? "No matching quotes."
          : "",
    );
    controls();
  }
  function browse(offset) {
    if (editing) {
      status("Save or cancel your current edit first.");
      return;
    }
    void task(() => load(offset));
  }
  function updateQuoteSetting() {
    q("quoteChatEnabled").checked = state.enabled === true;
    q("quoteChatStatus").textContent = state.enabled
      ? "!quote, !quote add and !deletequote are enabled in chat."
      : "Chat quote commands are off. You can still manage saved quotes here.";
  }
  q("quoteChatEnabled").onchange = () => {
    const enabled = q("quoteChatEnabled").checked;
    void task(async () => {
      try {
        const result = await rpc({ operation: "settings", enabled });
        state.enabled = result.enabled;
      } finally {
        updateQuoteSetting();
      }
    });
  };
  q("quoteRefresh").onclick = () => browse(state.offset);
  q("quotePrevious").onclick = () => browse(Math.max(0, state.offset - 25));
  q("quoteNext").onclick = () => browse(state.offset + 25);
  q("quoteSearch").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => browse(0), 250);
  };
  q("quoteNew").onclick = () => {
    if (editing) {
      status("Save or cancel your current edit first.");
      return;
    }
    open();
  };
  q("quoteCancel").onclick = close;
  q("quoteSave").onclick = () =>
    task(async () => {
      if (!editing) return;
      const text = q("quoteText").value.trim();
      if (!text) throw Error("Enter the quote text before saving.");
      await rpc({
        operation: editing.number ? "edit" : "add",
        text,
        ...(editing.number ? { number: editing.number, token: editing.token } : {}),
      });
      close();
      await load();
      status("Quote saved.");
    });
  q("quoteDeleteCancel").onclick = () => q("quoteDeleteDialog").close();
  q("quoteDeleteConfirm").onclick = () =>
    task(async () => {
      await rpc({ operation: "delete", number: deleting.number, token: deleting.token });
      q("quoteDeleteDialog").close();
      close();
      await load();
      status("Quote deleted. Numbers updated.");
    });
  window.addEventListener("quotes-imported", () => {
    if (!editing) void task(() => load(0));
  });
  void task(async () => {
    const catalog = await call("catalog");
    if (!catalog.supportsQuoteManagement) {
      status("Restart Core to load the editable quote list. Your saved quotes are kept.");
      q("quoteNew").hidden = true;
      return;
    }
    ready = true;
    await load(0);
  });
})();
