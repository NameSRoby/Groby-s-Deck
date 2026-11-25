/** Operator UI. Capabilities cross the sandbox bridge; credentials never enter it. */
/* global DeckFlow, GrobyVariablePresets, GrobyAutomationPresets, GrobyBuiltinPresets, createDurationInput, createPillInput, createVisibleDialog, calendarDateAfter */
(() => {
  const $ = (id) => document.getElementById(id),
    CHANNEL = "ravelink-feature-ui-v1",
    pending = new Map();
  const confirmation = createVisibleDialog($("confirm"));
  const connectLink = document.createElement("button");
  connectLink.type = "button";
  connectLink.className = "subtle";
  connectLink.textContent = "Connect Twitch";
  connectLink.hidden = true;
  connectLink.onclick = () =>
    parent.postMessage(
      { channel: "ravelink-feature-ui-v1", type: "setup-link", destination: "twitch" },
      "*",
    );
  $("connection").after(connectLink);
  const triggerPills = {
    aliases: createPillInput($("commandAliases"), {
      label: "Other command names",
      normalize: (value) => {
        const name = value.trim().toLowerCase();
        return name && (name.startsWith("!") ? name : "!" + name);
      },
      validate: (value) =>
        /^![a-z0-9][a-z0-9_?' -]{0,79}$/.test(value)
          ? ""
          : "Use a command name such as !hello or !hello there.",
      onChange: (values) =>
        ($("aliasCount").textContent = values.length
          ? values.length + (values.length === 1 ? " name" : " names")
          : ""),
    }),
    keywords: createPillInput($("commandKeywords"), {
      label: "Exact chat phrases",
      normalize: (value) => value.trim().toLowerCase(),
      onChange: (values) =>
        ($("phraseCount").textContent = values.length
          ? values.length + (values.length === 1 ? " phrase" : " phrases")
          : ""),
    }),
  };
  const durations = {
    cooldown: createDurationInput($("cooldown"), { label: "Command cooldown", max: 86400 }),
    userCooldown: createDurationInput($("userCooldown"), {
      label: "Per-user cooldown",
      max: 86400,
    }),
    rewardCooldown: createDurationInput($("rewardCooldown"), {
      label: "Global reward cooldown",
      max: 604800,
    }),
    timerInterval: createDurationInput($("timerInterval"), {
      label: "Timer interval",
      min: 1,
      max: 86400,
      precision: 0.001,
      initial: 1800,
    }),
  };
  let sequence = 0,
    snapshot = { revision: 0, rows: [], running: [], history: [] },
    rewards = [],
    catalog = [],
    eventCatalog = [],
    selected = null,
    editRevision = 0,
    builder = null,
    busy = false,
    connected = false,
    rewardResultUnknown = "",
    confirmAction = null;
  const notice = (text) => {
    $("notice").textContent = text;
    $("editorNotice").textContent = text;
    $("notice").style.color = /failed|error|unavailable/i.test(text)
      ? "var(--bad,#ef7489)"
      : "var(--muted)";
  };
  function closeEditor() {
    selected = null;
    $("editor").hidden = true;
  }
  function height() {
    parent.postMessage(
      { channel: CHANNEL, type: "feature-height", height: document.documentElement.scrollHeight },
      "*",
    );
  }
  new ResizeObserver(height).observe(document.body);
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.channel !== CHANNEL) return;
    if (event.data.type === "presentation") {
      for (const [key, value] of Object.entries(event.data.theme || {}))
        if (/^#[0-9a-f]{3,8}$/i.test(value))
          document.documentElement.style.setProperty("--" + key, value);
      return;
    }
    const item = pending.get(event.data.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(event.data.id);
    event.data.ok && event.data.value?.ok !== false
      ? item.resolve(event.data.value)
      : item.reject(
          Error(event.data.value?.error || event.data.error || "twitch_automation_unavailable"),
        );
  });
  function call(method, payload = {}, capability = "twitch.automations.v1") {
    const id = "twa-" + ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("twitch_automation_response_unknown"));
      }, 35000);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage(
        {
          channel: CHANNEL,
          type: "call",
          id,
          capability,
          method,
          payload,
        },
        window.location.origin,
      );
    });
  }
  const messages = {
    twitch_automation_revision_conflict:
      "The automation list changed. Reopen this automation before saving again.",
    twitch_automation_trigger_exists:
      "That reward or command already has an automation. Edit the existing one.",
    twitch_automation_command_reserved:
      "Choose a new command name. Built-in song and clip commands keep their shared moderation.",
    twitch_reward_not_manageable:
      "Twitch only lets this app edit rewards created with its own Twitch application.",
    twitch_automation_response_unknown:
      "The result is not confirmed. Refresh and check Twitch before repeating the operation.",
    twitch_automation_store_unavailable:
      "The saved automation file could not be read. No automations will run until it is recovered.",
    control_deck_busy: "This automation is running. Stop it before changing its reward.",
    twitch_connection_required: "Connect Twitch on the Connection page first.",
    twitch_scope_missing: "Grant Channel Points access on the Twitch Connection page.",
    twitch_reward_purpose_exists:
      "This automation already has a reward on Twitch. Refresh and select that reward.",
    twitch_reward_creation_in_progress:
      "Twitch is still creating this reward. Wait, then refresh to check its result.",
    twitch_automation_flow_empty: "Add at least one action before enabling this flow.",
    twitch_action_cooldown:
      "Twitch's cooldown is still active for this action. It was not retried.",
    twitch_action_unavailable:
      "Grant this action's permission on Twitch Connection before running it.",
    twitch_event_value_missing:
      "This action needs information from its matching Twitch event. Automatic raider targets require an Incoming raid trigger.",
  };
  async function task(fn) {
    if (busy) return;
    busy = true;
    document
      .querySelectorAll("#save,#remove,#deleteReward,#newAutomation,#refresh")
      .forEach((node) => (node.disabled = true));
    notice("Working…");
    try {
      await fn();
    } catch (error) {
      notice(messages[error.message] || error.message.replaceAll("_", " "));
    } finally {
      busy = false;
      updateControls();
    }
  }
  function updateControls() {
    for (const id of ["save", "newAutomation", "refresh"]) $(id).disabled = busy;
    $("remove").disabled =
      busy || !selected || !snapshot.rows.some((row) => row.id === selected.id);
    const reward = selected && $("triggerType").value === "reward",
      saved = snapshot.rows.find((row) => row.id === selected?.id),
      bound = saved?.trigger.rewardId;
    $("save").disabled = busy || !connected || rewardResultUnknown === selected?.id;
    $("save").textContent = reward
      ? $("rewardId").value
        ? "Save automation & reward"
        : "Save & create Twitch reward"
      : "Save automation";
    $("rewardPrerequisite").textContent = reward
      ? $("rewardId").value
        ? "Save updates this automation and its reward on Twitch together."
        : "Save creates this reward on Twitch and connects it to the flow below."
      : "";
    $("deleteReward").disabled = busy || !connected || !bound || !reward;
    $("deleteReward").hidden = !bound || !reward;
    height();
  }
  $("automationList").before($("editorParking"));
  const drawRows = window.createAutomationRows({
    host: $("automationList"),
    parking: $("editorParking"),
    edit: (row) => {
      if (busy) return;
      if (selected?.id === row.id) {
        selected = null;
        $("editor").hidden = true;
        render();
      } else open(row);
    },
    toggle: (row) =>
      task(async () => {
        const before = snapshot.rows.find((item) => item.id === selected?.id);
        snapshot = await call("control", { id: row.id, operation: "toggle" });
        const after = snapshot.rows.find((item) => item.id === selected?.id);
        editRevision =
          before &&
          after &&
          JSON.stringify({ ...before, enabled: false }) ===
            JSON.stringify({ ...after, enabled: false })
            ? snapshot.revision
            : editRevision;
        render();
        notice(
          "Automation " +
            (snapshot.rows.find((item) => item.id === row.id)?.enabled ? "started." : "paused."),
        );
      }),
    remove: (row) => {
      if (busy) return;
      removeAutomation(row);
    },
  });
  $("automationSearch").oninput = () => {
    closeEditor();
    render();
  };
  $("automationFilter").onchange = () => {
    closeEditor();
    render();
  };

  document.querySelectorAll("[data-automation-category]").forEach(
    (button) =>
      (button.onclick = () => {
        closeEditor();
        $("automationFilter").value = button.dataset.automationCategory;
        $("automationSearch").value = "";
        render();
      }),
  );
  function render() {
    document
      .querySelectorAll("[data-automation-category]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(
            button.dataset.automationCategory ===
              (["timer", "event"].includes($("automationFilter").value)
                ? "automation"
                : $("automationFilter").value),
          ),
        ),
      );
    drawRows(
      snapshot,
      selected,
      $("editor"),
      $("automationSearch").value,
      $("automationFilter").value,
    );
    $("runs").replaceChildren();
    if (snapshot.shoutouts?.pending) {
      const p = document.createElement("p"),
        count = snapshot.shoutouts.pending,
        seconds = Math.max(0, Math.ceil((snapshot.shoutouts.nextAt - Date.now()) / 1000));
      p.textContent =
        count +
        (count === 1 ? " native shoutout is" : " native shoutouts are") +
        " waiting. Next attempt in " +
        Math.floor(seconds / 60) +
        "m " +
        (seconds % 60) +
        "s.";
      $("runs").append(p);
    }
    if (snapshot.shoutouts?.lastError) {
      const p = document.createElement("p");
      p.textContent =
        snapshot.shoutouts.lastError === "twitch_shoutout_not_live"
          ? "Waiting shoutouts were cleared because the stream is offline or its live status could not be confirmed."
          : snapshot.shoutouts.lastError === "twitch_shoutout_outcome_unknown"
            ? "Twitch did not confirm the last shoutout. It was not repeated."
            : "Twitch could not send the last native shoutout. Check its access, live requirements and cooldown.";
      $("runs").append(p);
    }
    for (const run of snapshot.running || []) {
      const p = document.createElement("p");
      p.textContent = run.name + " is running";
      const stop = document.createElement("button");
      stop.textContent = "Stop & restore";
      stop.onclick = () =>
        task(async () => {
          await call("cancel", { runId: run.runId });
          notice("Stopping. Saved values will be restored where supported.");
        });
      p.append(stop);
      $("runs").append(p);
    }
    $("history").replaceChildren();
    for (const row of snapshot.history || []) {
      const li = document.createElement("li");
      li.textContent =
        row.name +
        " · " +
        (row.ok ? "Completed" : messages[row.code] || row.code.replaceAll("_", " "));
      $("history").append(li);
    }
    updateControls();
  }
  function initializeExamples() {
    const presets = [
      ...GrobyBuiltinPresets,
      ...GrobyAutomationPresets,
      ...GrobyVariablePresets.map((row) => ({
        ...row,
        group: "Chat commands",
        trigger: { type: "command", command: row.command },
        steps: [{ actionId: "twitch.action.chat", params: { message: row.message }, delayMs: 0 }],
      })),
    ];
    $("commandExamples").replaceChildren();
    const presetGroups = new Map();
    for (const preset of presets) {
      if (!presetGroups.has(preset.group)) {
        const group = document.createElement("optgroup");
        group.label = preset.group;
        presetGroups.set(preset.group, group);
        $("commandExamples").append(group);
      }
      presetGroups
        .get(preset.group)
        .append(
          new Option(
            (preset.trigger.command ? preset.trigger.command + " · " : "") + preset.name,
            preset.id,
          ),
        );
    }
    const showExample = () => {
      $("commandExampleHelp").textContent =
        presets.find((row) => row.id === $("commandExamples").value)?.description || "";
    };
    $("commandExamples").onchange = showExample;
    showExample();
    $("useCommandExample").onclick = () => {
      if (busy) return;
      const preset = presets.find((row) => row.id === $("commandExamples").value);
      if (!preset) return;
      loadPreset(preset);
    };
  }
  async function refresh() {
    // Public examples and the action catalog do not require an account. A
    // disconnected Twitch session must not leave a fresh install empty.
    const choices = await call("catalog");
    catalog = choices.actions;
    $("commandOffline").disabled = choices.supportsOfflinePolicy !== true;
    $("commandOffline").title = choices.supportsOfflinePolicy
      ? ""
      : "Restart Core to load offline-command settings. Existing commands already work offline.";
    eventCatalog = choices.events || [];
    $("eventType").replaceChildren(
      ...eventCatalog.map(
        (event) =>
          new Option(event.label + (event.available ? "" : " · permission needed"), event.type),
      ),
    );
    connected = true;
    try {
      snapshot = await call("status");
      connected = snapshot.connected !== false;
    } catch (error) {
      if (error.message !== "twitch_connection_required") throw error;
      connected = false;
      snapshot = { revision: 0, rows: [], running: [], history: [] };
    }
    rewards = [];
    if (connected) {
      try {
        rewards = (await call("rewards")).rewards || [];
      } catch (error) {
        if (!["twitch_scope_missing", "twitch_connection_required"].includes(error.message))
          throw error;
      }
    }
    if (selected?.id === rewardResultUnknown) {
      const saved = snapshot.rows.find((row) => row.id === selected.id);
      const recovered =
        saved?.trigger.rewardId ||
        rewards.find(
          (row) =>
            row.manageable &&
            (row.managedPurpose === "automation:" + selected.id ||
              row.managedPurpose === selected.handler),
        )?.id;
      if (saved) {
        selected = {
          ...selected,
          trigger: { ...saved.trigger, ...(recovered ? { rewardId: recovered } : {}) },
        };
        editRevision = snapshot.revision;
        rewardOptions(selected.trigger.rewardId);
      }
    }
    rewardResultUnknown = "";
    $("connection").textContent = connected ? "Twitch connected" : "Twitch not connected";
    connectLink.hidden = connected;
    render();
    renderLibrary();
    notice(
      connected
        ? "Ready. Twitch actions need the permissions selected on the Connection page."
        : "Ready. Public presets are available to edit. Connect Twitch to save or activate automations.",
    );
  }
  function loadPreset(preset) {
    if (!preset || busy) return;
    if (preset.handler && preset.handler !== "flow") {
      const existing = snapshot.rows.find((row) => row.handler === preset.handler);
      if (existing) {
        open(existing);
        notice(preset.description);
        return;
      }
    }
    $("newAutomation").click();
    $("automationFilter").value = preset.trigger.type === "command" ? "command" : "automation";
    $("automationSearch").value = "";
    open({
      ...selected,
      name: preset.name,
      enabled: false,
      trigger: preset.trigger,
      handler: preset.handler || "flow",
      role: preset.role,
      cooldownSeconds: preset.cooldownSeconds,
      userCooldownSeconds: preset.userCooldownSeconds,
      steps: structuredClone(preset.steps),
    });
    notice(
      "Example loaded as a disabled draft. Review its text and roles, save it, then activate it with the list switch.",
    );
  }
  function fillReward(row = {}) {
    for (const [id, key, fallback] of [
      ["rewardTitle", "title", selected?.name || ""],
      ["cost", "cost", 100],
      ["prompt", "prompt", ""],
      ["color", "backgroundColor", "#9146ff"],
      ["maxStream", "maxPerStream", 0],
      ["maxUser", "maxPerUser", 0],
    ])
      $(id).value = row[key] ?? fallback;
    durations.rewardCooldown.set(row.cooldownSeconds ?? 0);
    for (const [id, key, fallback] of [
      ["rewardEnabled", "enabled", true],
      ["paused", "paused", false],
      ["userInput", "userInputRequired", false],
    ])
      $(id).checked =
        id === "paused" && snapshot.livePausedRewardIds?.includes(row.id)
          ? false
          : (row[key] ?? fallback);
    $("rewardTitle").dataset.automatic = String(!row.title);
    if ($("triggerType").value === "reward" && row.title) $("name").value = row.title;
  }
  function rewardOptions(value) {
    $("rewardId").replaceChildren(new Option("Create a new Twitch reward", ""));
    for (const reward of rewards.filter((row) => row.manageable))
      $("rewardId").add(new Option(reward.title, reward.id));
    if (value && !rewards.some((row) => row.manageable && row.id === value))
      $("rewardId").add(new Option("Bound reward · refresh to check availability", value));
    $("rewardId").value = value || "";
  }
  function open(row) {
    editRevision = snapshot.revision;
    selected = structuredClone(row);
    $("editor").hidden = false;
    $("editorTitle").textContent = snapshot.rows.some((item) => item.id === row.id)
      ? "Edit automation"
      : "New automation";
    $("name").value = row.name;
    $("triggerType").value = row.trigger.type;
    $("command").value = row.trigger.command || "!studiochange";
    $("commandOffline").checked = row.trigger.onlyLive !== true;
    triggerPills.aliases.set(row.trigger.aliases || []);
    triggerPills.keywords.set(row.trigger.keywords || []);
    $("role").value = row.role || "moderator";
    durations.cooldown.set(row.cooldownSeconds ?? 30);
    durations.userCooldown.set(row.userCooldownSeconds ?? 15);
    $("handler").value = row.handler;
    $("eventType").value = row.trigger.event || "channel.subscribe";
    durations.timerInterval.set((row.trigger.intervalMs || 1800000) / 1000);
    $("timerSchedule").value = row.trigger.calendarMonths ? "calendar" : "interval";
    $("calendarMonths").value = row.trigger.calendarMonths || 2;
    $("calendarNext").value = new Date(
      row.trigger.nextAt || calendarDateAfter(Date.now(), Number($("calendarMonths").value)),
    )
      .toISOString()
      .slice(0, 16);
    switchTimerSchedule();
    $("timerCount").value = row.trigger.repeatLimit || 0;
    $("timerLive").checked = row.trigger.onlyLive !== false;
    $("timerMessages").value = row.trigger.minMessages || 0;
    rewardOptions(row.trigger.rewardId);
    fillReward(rewards.find((reward) => reward.id === row.trigger.rewardId));
    $("editor").querySelector(".library").open = !(row.steps || []).length;
    $("flow").replaceChildren();
    builder = DeckFlow.buildActionSteps(
      $("flow"),
      "Automation flow",
      row.steps || [],
      catalog,
      null,
      {
        triggerLabel: "WHEN · Twitch trigger",
        trigger: () => ({ type: $("triggerType").value, event: $("eventType").value }),
      },
    );
    switchTrigger();
    render();
  }
  function switchTrigger() {
    const type = $("triggerType").value,
      chat = type === "command",
      reward = type === "reward";
    for (const id of ["commandField", "roleField", "commandExtras", "commandOfflineField"])
      $(id).hidden = !chat;
    $("userCooldownField").hidden = !chat;
    $("cooldownField").hidden = !chat && type !== "event";
    $("cooldownField").firstChild.textContent = chat ? "Command cooldown" : "Event cooldown";
    $("nameLabel").textContent = reward ? "Reward name on Twitch" : "Name";
    $("name").maxLength = reward ? 45 : 80;
    $("rewardChoice").hidden = !reward;
    $("rewardFields").hidden = !reward;
    $("rewardFields").disabled = !reward;
    $("eventField").hidden = type !== "event";
    $("timerFields").hidden = type !== "timer";
    if (!reward) $("handler").value = "flow";
    $("handlerField").hidden = !reward;
    $("flowArea").hidden = $("handler").value !== "flow";
    const label =
      type === "event"
        ? eventCatalog.find((row) => row.type === $("eventType").value)?.label || "Twitch event"
        : type === "timer"
          ? "Timer"
          : chat
            ? "Chat command"
            : "Channel Points redemption";
    const trigger = $("flow").querySelector(".deckFlowTrigger");
    if (trigger) trigger.textContent = "WHEN · " + label;
    updateControls();
  }
  function switchTimerSchedule() {
    const calendar = $("timerSchedule").value === "calendar";
    $("timerIntervalField").hidden = calendar;
    $("calendarMonthsField").hidden = !calendar;
    $("calendarNextField").hidden = !calendar;
    $("timerLiveLabel").textContent = calendar
      ? "Only run while live"
      : "Only count time while live";
    $("timerHelp").textContent = calendar
      ? "Uses calendar dates in UTC and remembers the next date across restarts. If the app is closed or paused past a date, it runs once when available; missed dates never produce a burst."
      : "When the interval ends, wait for this many new viewer messages before running once. Pause keeps the remaining time; Restart resets the count and interval. A Core restart starts a fresh interval without replaying missed runs.";
  }
  $("timerSchedule").onchange = switchTimerSchedule;
  function readTimerTrigger() {
    const base = {
      type: "timer",
      repeatLimit: Number($("timerCount").value),
      onlyLive: $("timerLive").checked,
      minMessages: Number($("timerMessages").value),
    };
    if ($("timerSchedule").value !== "calendar")
      return { ...base, intervalMs: Math.round(durations.timerInterval.read() * 1000) };
    const nextAt = Date.parse($("calendarNext").value + "Z");
    if (!Number.isFinite(nextAt)) throw Error("Choose the next calendar run date and time.");
    return {
      ...base,
      calendarMonths: Number($("calendarMonths").value),
      nextAt,
      calendarDay:
        selected?.trigger?.nextAt === nextAt
          ? selected.trigger.calendarDay
          : new Date(nextAt).getUTCDate(),
    };
  }
  function renderLibrary() {
    const query = $("search").value.trim().toLowerCase();
    $("actionChoice").replaceChildren();
    const groups = new Map();
    for (const action of catalog.filter(
      (row) =>
        row.id !== "deck.wait" &&
        row.kind !== "condition" &&
        (!query ||
          (row.label + " " + row.group + " " + row.description).toLowerCase().includes(query)),
    )) {
      let group = groups.get(action.group);
      if (!group) {
        group = document.createElement("optgroup");
        group.label = action.group;
        groups.set(action.group, group);
        $("actionChoice").append(group);
      }
      group.append(
        new Option(action.label + (action.available ? "" : " · unavailable"), action.id),
      );
    }
  }
  function draft() {
    const type = $("triggerType").value,
      chat = type === "command",
      reward = type === "reward";
    const aliases = chat ? triggerPills.aliases.read() : [],
      keywords = chat ? triggerPills.keywords.read() : [];
    return {
      id: selected.id,
      name: $("name").value.trim(),
      enabled: snapshot.rows.find((row) => row.id === selected.id)?.enabled ?? selected.enabled,
      trigger: chat
        ? {
            type: "command",
            command: $("command").value.trim().toLowerCase(),
            ...(!$("commandOffline").checked ? { onlyLive: true } : {}),
            ...(aliases.length ? { aliases } : {}),
            ...(keywords.length ? { keywords } : {}),
          }
        : type === "timer"
          ? readTimerTrigger()
          : type === "event"
            ? { type, event: $("eventType").value }
            : { type: "reward", rewardId: $("rewardId").value },
      handler: !reward ? "flow" : $("handler").value,
      steps: $("handler").value === "flow" || !reward ? builder.read() : [],
      role: $("role").value,
      cooldownSeconds: durations.cooldown.read(),
      userCooldownSeconds: durations.userCooldown.read(),
    };
  }
  function rewardFields() {
    return {
      title: $("rewardTitle").value.trim() || $("name").value.trim(),
      cost: Number($("cost").value),
      prompt: $("prompt").value,
      userInputRequired: $("userInput").checked,
      enabled: $("rewardEnabled").checked,
      paused: $("paused").checked,
      backgroundColor: $("color").value,
      maxPerStream: Number($("maxStream").value),
      maxPerUser: Number($("maxUser").value),
      cooldownSeconds: durations.rewardCooldown.read(),
    };
  }
  function confirm(title, text, action) {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    confirmAction = action;
    void confirmation.open();
  }
  $("confirmCancel").onclick = () => {
    $("confirm").close();
    confirmAction = null;
  };
  $("confirmProceed").onclick = () => {
    const action = confirmAction;
    $("confirm").close();
    confirmAction = null;
    if (action) void task(action);
  };
  $("confirm").addEventListener("close", () => {
    confirmAction = null;
  });
  $("newAutomation").onclick = () => {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    open({
      id: [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(""),
      name: "",
      enabled: true,
      trigger:
        $("automationFilter").value === "command"
          ? { type: "command", command: "!newcommand" }
          : $("automationFilter").value === "reward"
            ? { type: "reward", rewardId: "" }
            : $("automationFilter").value === "event"
              ? { type: "event", event: "channel.subscribe" }
              : {
                  type: "timer",
                  intervalMs: 1800000,
                  repeatLimit: 0,
                  onlyLive: true,
                  minMessages: 0,
                },
      handler: "flow",
      steps: [],
      role: "moderator",
      cooldownSeconds: 30,
    });
    notice(
      "Choose a trigger and build its flow. Save will also create or update its Twitch reward.",
    );
  };
  $("refresh").onclick = () => task(refresh);
  for (const [button, id] of [
    ["presetTimer", "chat-reminder"],
    ["presetSub", "subscriber-thanks"],
    ["presetRaid", "raid-native"],
  ]) {
    $(button).onclick = () => loadPreset(GrobyAutomationPresets.find((row) => row.id === id));
  }
  $("search").oninput = renderLibrary;
  $("triggerType").onchange = () => {
    switchTrigger();
    const category = $("triggerType").value,
      group = ["timer", "event"].includes(category) ? "automation" : category;
    if ($("automationFilter").value !== group) {
      $("automationFilter").value = group;
      $("automationSearch").value = "";
      render();
    }
  };
  $("eventType").onchange = switchTrigger;
  $("handler").onchange = switchTrigger;
  $("rewardId").onchange = () => {
    fillReward(rewards.find((row) => row.id === $("rewardId").value));
    updateControls();
  };
  $("name").oninput = () => {
    if ($("triggerType").value === "reward" || $("rewardTitle").dataset.automatic === "true")
      $("rewardTitle").value = $("name").value.slice(0, 45);
  };
  $("rewardTitle").oninput = () => {
    if ($("triggerType").value === "reward") $("name").value = $("rewardTitle").value;
    $("rewardTitle").dataset.automatic = String(!$("rewardTitle").value.trim());
  };
  $("addAction").onclick = () => {
    const action = catalog.find((row) => row.id === $("actionChoice").value);
    if (!action || !builder) return;
    try {
      builder.append({
        actionId: action.id,
        params: structuredClone(action.defaults || {}),
        delayMs: 0,
      });
      notice("Action added. Choose Add actions here to target a branch.");
    } catch (error) {
      notice(error.message);
    }
  };
  const saveAutomation = () => {
    if (!$("automationForm").reportValidity()) {
      notice("Check the highlighted fields before saving.");
      return;
    }
    void task(async () => {
      const value = draft(),
        fields = value.trigger.type === "reward" ? rewardFields() : null;
      snapshot = await call("save", { revision: editRevision, automation: value });
      editRevision = snapshot.revision;
      selected = snapshot.rows.find((row) => row.id === value.id) || value;
      $("editorTitle").textContent = "Edit automation";
      render();
      if (!fields) {
        notice(
          "Automation saved." +
            (selected.enabled ? "" : " Paused; activate it with the list switch."),
        );
        return;
      }
      const operation = selected.trigger.rewardId ? "update" : "create";
      notice(
        operation === "create"
          ? "Automation saved. Creating its Twitch reward..."
          : "Automation saved. Updating its Twitch reward...",
      );
      try {
        snapshot = await call("reward", {
          revision: editRevision,
          id: selected.id,
          operation,
          fields,
        });
        const saved = snapshot.rows.find((row) => row.id === value.id);
        rewards = rewards.filter((row) => row.id !== saved.trigger.rewardId);
        rewards.push({ ...fields, id: saved.trigger.rewardId, manageable: true });
        open(saved);
        notice(
          operation === "create"
            ? "Automation saved. Twitch reward created and connected."
            : "Automation and Twitch reward saved.",
        );
      } catch (error) {
        if (error.message === "twitch_automation_response_unknown") {
          rewardResultUnknown = selected.id;
          notice(
            "Automation saved. Twitch has not confirmed the reward result. Refresh to check before trying again.",
          );
        } else {
          notice(
            "Automation saved, but its Twitch reward could not be " +
              (operation === "create" ? "created" : "updated") +
              ". " +
              (messages[error.message] || error.message.replaceAll("_", " ")) +
              " Your settings are kept; save again to retry.",
          );
        }
      }
    });
  };
  $("save").onclick = saveAutomation;
  $("automationForm").onsubmit = (event) => {
    event.preventDefault();
    saveAutomation();
  };
  $("automationForm").addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.target.closest(".pillInput")) return;
    if (
      event.key === "Enter" &&
      event.target.tagName === "INPUT" &&
      !["checkbox", "color"].includes(event.target.type)
    ) {
      event.preventDefault();
      saveAutomation();
    }
  });
  $("deleteReward").onclick = () => {
    const saved = snapshot.rows.find((row) => row.id === selected?.id);
    if (!saved?.trigger.rewardId) return;
    confirm(
      "Delete this reward on Twitch?",
      "This removes the actual Channel Points reward from Twitch. The automation stays as a disabled draft. Twitch may fulfil outstanding redemptions when deleting a reward.",
      async () => {
        snapshot = await call("reward", {
          revision: snapshot.revision,
          id: saved.id,
          operation: "delete",
          confirmRewardId: saved.trigger.rewardId,
        });
        rewards = (await call("rewards")).rewards || [];
        open(snapshot.rows.find((row) => row.id === saved.id));
        notice("Reward deleted on Twitch.");
      },
    );
  };
  function removeAutomation(row) {
    const id = row.id,
      reward = row.trigger.type === "reward";
    confirm(
      "Remove " + (row.trigger.type === "command" ? row.trigger.command : row.name) + "?",
      reward
        ? "Its Channel Points reward stays on Twitch. Future redemptions will not run this flow and are refunded. The built-in handler choices stay available."
        : "Remove this automation and its saved flow? This cannot be undone.",
      async () => {
        snapshot = await call("remove", { revision: snapshot.revision, id });
        if (selected?.id === id) closeEditor();
        render();
        notice(reward ? "Automation removed. Its Twitch reward was kept." : "Automation removed.");
      },
    );
  }
  $("remove").onclick = () => {
    if (selected) removeAutomation(selected);
  };
  initializeExamples();
  void task(refresh);
  const poll = setInterval(() => {
    if (busy) return;
    void call("status")
      .then((value) => {
        snapshot = value;
        render();
      })
      .catch(() => {});
  }, 2000);
  window.addEventListener("pagehide", () => {
    clearInterval(poll);
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
  });
})();
