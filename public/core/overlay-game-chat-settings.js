/** Local permission editor. Chat mutations are authorized on the server. */
globalThis.setupOverlayGameChatSettings = (a) => {
  const dialog = document.createElement("dialog");
  dialog.id = "gameChatDialog";
  dialog.setAttribute("aria-labelledby", "gameChatTitle");
  dialog.innerHTML = `
    <h2 id="gameChatTitle">Game chat commands</h2>
    <p>Use Twitch chat to control one saved game. The broadcaster can use every applicable command when commands are enabled.</p>
    <label class="check"><input type="checkbox" id="gameChatEnabled">Enable game commands</label>
    <label>Game<select id="gameChatTarget"></select></label>
    <p id="gameChatEntries"></p>
    <div class="gameChatPermissions"><table>
      <thead><tr><th scope="col">Command</th><th scope="col">Moderators</th><th scope="col">VIPs</th><th scope="col">Viewers</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <p id="gameChatStatus" role="status"></p>
    <div class="dialogActions"><button type="button" id="saveGameChat">Save permissions</button><button type="button" id="closeGameChat">Close</button></div>`;
  document.body.append(dialog);
  const $ = a.$,
    target = $("gameChatTarget"),
    enable = $("gameChatEnabled"),
    save = $("saveGameChat"),
    status = $("gameChatStatus"),
    rows = dialog.querySelector("tbody");
  let state = null,
    permissions = {},
    busy = false;

  function renderTarget() {
    const game = state?.games.find((row) => row.id === target.value);
    $("gameChatEntries").textContent = game?.entryCommand
      ? "Participation command while this game is open: " + game.entryCommand
      : "";
    for (const row of rows.children) {
      const cmd = state.commands.find((item) => item.id === row.dataset.command);
      row.cells[0].textContent =
        ["cast_vote", "join_wheel"].includes(cmd.id) && game?.entryCommand
          ? game.entryCommand
          : cmd.usage;
      row.hidden = Boolean(
        game &&
        ((cmd.types.length && !cmd.types.includes(game.type)) ||
          (cmd.requiresChatEntries && !game.entryCommand)),
      );
    }
    save.disabled = busy || !state || (enable.checked && !game);
  }

  function show(next) {
    state = next;
    const preferred = a.doc.id + "/" + a.selected()[0]?.id;
    target.replaceChildren(
      new Option("Choose a saved game", ""),
      ...state.games.map((row) => new Option(row.label, row.id)),
    );
    target.value = state.games.some((row) => row.id === state.target)
      ? state.target
      : state.games.some((row) => row.id === preferred)
        ? preferred
        : "";
    enable.checked = state.enabled;
    enable.disabled = target.disabled = false;
    rows.replaceChildren();
    permissions = {};
    for (const command of state.commands) {
      const row = rows.insertRow();
      row.dataset.command = command.id;
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = command.usage;
      row.append(label);
      permissions[command.id] = {};
      for (const role of state.roles) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = command.roles.includes(role);
        checkbox.setAttribute("aria-label", command.usage + " for " + role);
        checkbox.onchange = () => {
          permissions[command.id][role] = checkbox.checked;
        };
        permissions[command.id][role] = checkbox.checked;
        row.insertCell().append(checkbox);
      }
    }
    renderTarget();
  }

  $("openGameChat").onclick = async () => {
    target.disabled = enable.disabled = save.disabled = true;
    status.textContent = "Loading game commands…";
    dialog.showModal();
    try {
      show(await a.request("/game-commands"));
      status.textContent = state.active
        ? "Game commands are enabled for your connected Twitch channel."
        : "Connect Twitch with Read chat commands to use this feature. Send chat messages enables replies.";
    } catch (error) {
      status.textContent = error.message;
    }
  };
  $("closeGameChat").onclick = () => dialog.close();
  target.onchange = enable.onchange = renderTarget;
  save.onclick = async () => {
    busy = save.disabled = true;
    try {
      show(
        await a.request("/game-commands", "PUT", {
          revision: state.revision,
          target: target.value,
          enabled: enable.checked,
          permissions,
        }),
      );
      status.textContent = "Game command permissions saved.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      renderTarget();
    }
  };
};
