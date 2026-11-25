/** Compact operator rows; keep the active editor DOM intact between status polls. */
window.createAutomationRows = ({ host, parking, edit, toggle, remove }) => {
  let key = "";
  const el = (tag, css, text) => {
    const node = document.createElement(tag);
    node.className = css || "";
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const roles = {
    viewer: "Everyone",
    subscriber: "Subscribers+",
    vip: "VIPs+",
    moderator: "Moderators+",
    broadcaster: "Broadcaster",
  };
  function summary(row) {
    const steps = row.steps || [],
      message =
        steps.length === 1 && steps[0].actionId === "twitch.action.chat"
          ? steps[0].params.message
          : null;
    return (
      (message && (message.length > 500 ? "Editable recipe - open to view all steps" : message)) ||
      (row.handler !== "flow"
        ? {
            lights: "Lighting request",
            teach: "Teach a colour",
            song_request: "Song Request",
            add_to_playlist: "Add to playlist",
          }[row.handler] || row.handler
        : "Flow · " + steps.length + " blocks")
    );
  }
  return (snapshot, selected, editor, query = "", type = "command") => {
    if (!["command", "reward", "automation", "timer", "event"].includes(type)) type = "command";
    const next = JSON.stringify([snapshot.rows, selected?.id, query, type]);
    if (next !== key) {
      key = next;
      parking.append(editor);
      host.replaceChildren();
      const heading = el("div", "automationColumns automationColumnLabels");
      for (const text of [
        "Enabled",
        "Trigger / name",
        "Response / flow",
        "Global cooldown",
        "User cooldown",
        "Access",
        "Manage",
      ])
        heading.append(el("span", "", text));
      host.append(heading);
      const builtin = (row) => Boolean(snapshot.builtinPolicies?.[row.handler]);
      const group = (row) =>
        builtin(row)
          ? "builtin"
          : row.trigger.type === "command"
            ? "command"
            : row.trigger.type === "reward"
              ? "reward"
              : "automation";
      const order = { builtin: -1, command: 0, reward: 1, automation: 2 },
        labels = {
          builtin: "Built-in features",
          command: "Chat commands",
          reward: "Channel Points",
          automation: "Timers & events",
        };
      const search = query.toLowerCase();
      const visible = snapshot.rows
        .filter(
          (row) =>
            (builtin(row) ||
              row.trigger.type === type ||
              (type === "automation" && group(row) === "automation")) &&
            [row.name, row.trigger.command, row.trigger.event, summary(row)]
              .join(" ")
              .toLowerCase()
              .includes(search),
        )
        .sort(
          (a, b) =>
            order[group(a)] - order[group(b)] ||
            (a.trigger.command || a.name).localeCompare(b.trigger.command || b.name, undefined, {
              numeric: true,
              sensitivity: "base",
            }) ||
            a.id.localeCompare(b.id),
        );
      let priorGroup = "";
      for (const row of visible) {
        if (group(row) !== priorGroup) {
          priorGroup = group(row);
          const label = el(
            "h3",
            "automationGroupHeading",
            labels[priorGroup] +
              " · " +
              visible.filter((item) => group(item) === priorGroup).length,
          );
          host.append(label);
        }
        const item = el("div", "automationItem"),
          line = el("div", "automationColumns"),
          control = el("button", "automationEnable");
        control.type = "button";
        control.disabled = snapshot.connected === false;
        control.setAttribute("role", "switch");
        control.setAttribute("aria-checked", String(row.enabled));
        control.setAttribute("aria-label", row.enabled ? "Pause automation" : "Start automation");
        control.title = row.enabled ? "Pause " + row.name : "Enable " + row.name;
        control.onclick = () => toggle(row);
        control.append(el("span"));
        const title = el("button", "automationRowTitle");
        title.type = "button";
        title.setAttribute("aria-expanded", String(selected?.id === row.id));
        title.setAttribute("aria-pressed", String(selected?.id === row.id));
        title.append(
          el("strong", "", row.trigger.type === "command" ? row.trigger.command : row.name),
          el(
            "small",
            "",
            row.trigger.type === "command"
              ? row.name
              : row.trigger.type === "timer"
                ? row.trigger.calendarMonths
                  ? "Every " + row.trigger.calendarMonths + " calendar months"
                  : "Every " + row.trigger.intervalMs / 60000 + " min"
                : row.trigger.type === "event"
                  ? row.trigger.event
                  : "Channel Points",
          ),
        );
        if (row.trigger.type === "command" && row.name === row.trigger.command)
          title.querySelector("small").remove();
        title.onclick = () => edit(row);
        if (builtin(row)) {
          const preset = GrobyBuiltinPresets.find((preset) => preset.handler === row.handler);
          const policy = snapshot.builtinPolicies[row.handler];
          title.querySelector("small").textContent = policy.chatEnabled
            ? "Chat · " +
              preset.command +
              (policy.commandPreferred ? " · selected in Song Request Setup" : " · no reward bound")
            : policy.enabled && row.trigger.rewardId
              ? "Channel Points"
              : "Chat fallback · " + preset.command;
        }
        const description = summary(row);
        const response = el("span", "automationResponse", description);
        response.title = description;
        const actions = el("div", "automationManage"),
          expand = el("button", "", selected?.id === row.id ? "Close editor" : "Edit"),
          trash = el("button", "automationRemove", "Remove");
        expand.type = trash.type = "button";
        expand.onclick = () => edit(row);
        trash.setAttribute("aria-label", "Remove " + row.name);
        trash.onclick = () => remove(row);
        actions.append(expand);
        if (!builtin(row)) actions.append(trash);
        line.append(
          control,
          title,
          response,
          el(
            "span",
            "automationGlobal",
            row.trigger.type === "command" || row.trigger.type === "event"
              ? row.cooldownSeconds + "s"
              : "—",
          ),
          el(
            "span",
            "automationUser",
            row.trigger.type === "command" ? (row.userCooldownSeconds ?? 15) + "s" : "—",
          ),
          el(
            "span",
            "automationRole",
            row.trigger.type === "command" ? roles[row.role] : "Reward / event",
          ),
          actions,
        );
        item.addEventListener("click", (event) => {
          if (event.target.closest("#editor")) return;
          if (!event.target.closest("button,input,select,textarea,a")) edit(row);
        });
        item.append(line);
        if (row.trigger.type === "timer") {
          const timer = el("small", "automationTimer");
          timer.dataset.timerId = row.id;
          item.append(timer);
        }
        if (selected?.id === row.id) item.append(editor);
        host.append(item);
      }
      if (!visible.length)
        host.append(
          el(
            "p",
            "automationEmpty",
            snapshot.rows.length
              ? "No matching automations."
              : "No automations yet. Add one or choose an example.",
          ),
        );
    }
    for (const timer of snapshot.timers || []) {
      const node = host.querySelector('[data-timer-id="' + timer.id + '"]');
      if (node)
        node.textContent =
          timer.phase.replaceAll("_", " ") +
          " · " +
          timer.count +
          " runs · " +
          Math.ceil(timer.remaining / 1000) +
          "s left · " +
          timer.messages +
          " new chat messages";
    }
  };
};
