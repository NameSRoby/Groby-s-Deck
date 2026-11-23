/** Saved Twitch triggers use the deck's Core-owned, cancellable flow runner. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { normalize, HANDLERS } = require("./twitch-automation-config");
const { fault } = require("../control-deck/control-deck-config");
const {
  roleFromEvent,
} = require("../../capabilities/feature-platform/providers/twitch-chat-command-router");
module.exports = ({
  file,
  getProvider,
  deck,
  legacy,
  getShoutouts = () => null,
  now = Date.now,
}) => {
  let data = { version: 1, revision: 0, rows: [], detached: [], receipts: [] },
    closed = false,
    mutation = Promise.resolve();
  const community = require("./community-commands")({
    file: file.replace(/\.json$/, ".community.json"),
    getProvider,
    manageCommand: require("./chat-command-management")({ status, save, remove }),
    now,
  });
  const liveRewards = require("./live-reward-policy")({
    file: file.replace(/\.json$/, ".live-rewards.json"),
    getProvider,
    getRows: () => rows(account()),
    getCatalog: () => deck.catalog().actions || [],
    now,
    isLive: (owner) => commandLive(owner),
    observeLive: (owner, live) => commandLive.setLive(owner, live),
  });
  const commandLive = require("./command-live-policy")({ getProvider, now });
  const cooldowns = new Map(),
    history = [],
    runs = new Map();
  const eventBacklog = require("./event-flow-backlog")({
    isBusy: (id) => runs.has(id),
    getRows: () => data.rows,
    getOwner: () => account(),
    launch: (row, context) => launch(row, null, context),
    now,
  });
  let playerMigrationError = "";
  try {
    require("./command-player-migration")(file);
  } catch (error) {
    playerMigrationError = error.message;
  }
  const counterOwner = require("./command-counters")(file.replace(/\.json$/, ".counters.json"));
  let templateChain = Promise.resolve();
  function templateContext(context, owner, preview = false) {
    const status = getProvider().status();
    context = {
      ...context,
      channel: context?.channel || status.login || "sample_channel",
      target: context?.argv?.[0]?.replace(/^@/, "") || context?.raider || context?.user,
    };
    const lookup = preview
      ? async () => ({
          game: "Sample category",
          title: "Sample stream title",
          live: true,
          viewers: 25,
          startedAt: now() - 3600000,
        })
      : (name) =>
          getProvider()
            .templateChannel({ login: name })
            .then((row) => (row.ok ? row : null));
    return {
      ...context,
      render: (source, signal) => {
        const operation = async () => {
          if (signal?.aborted || account() !== owner) throw fault("control_deck_cancelled");
          const counter = counterOwner(owner, preview, true);
          if (playerMigrationError) throw Error(playerMigrationError);
          const text = await require("./command-template").render(source, {
            context,
            lookup,
            counter,
            preview,
            now,
          });
          if (signal?.aborted || account() !== owner) throw fault("control_deck_cancelled");
          counter.commit();
          return text;
        };
        const promise = templateChain.then(operation);
        templateChain = promise.catch(() => {});
        return promise;
      },
    };
  }
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2000000) throw Error();
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      saved.version !== 1 ||
      !Array.isArray(saved.rows) ||
      saved.rows.length > 128 ||
      !Array.isArray(saved.detached) ||
      saved.detached.length > 512 ||
      !Array.isArray(saved.receipts) ||
      saved.receipts.length > 8192 ||
      !Number.isSafeInteger(saved.revision) ||
      saved.revision < 0 ||
      saved.rows.some((row) => typeof row?.accountId !== "string" || row.accountId.length > 80) ||
      saved.detached.some(
        (row) =>
          typeof row?.accountId !== "string" ||
          typeof row?.rewardId !== "string" ||
          row.rewardId.length > 160,
      ) ||
      saved.receipts.some(
        (row) => !/^([a-f0-9]{64})$/.test(row?.hash || "") || !Number.isFinite(row.at),
      )
    )
      throw Error();
    data = {
      ...saved,
      rows: saved.rows.map((row) =>
        normalize(
          Object.fromEntries(Object.entries(row).filter(([key]) => key !== "accountId")),
          row.accountId,
          { canonicalize: false },
        ),
      ),
    };
  } catch (error) {
    if (error.code !== "ENOENT") closed = true;
  }
  const account = () => {
    const status = getProvider().status();
    if (!status.connected || !status.userId) throw fault("twitch_connection_required");
    return status.userId;
  };
  const triggers = require("./twitch-automation-triggers")({
    rows: () => (closed ? [] : data.rows),
    account,
    getProvider,
    launch,
    receipt,
    now,
    advanceCalendar: (row, nextAt) =>
      serial(() => {
        if (closed || !data.rows.includes(row) || !row.trigger.calendarMonths) return;
        row.trigger = { ...row.trigger, nextAt };
        data.revision++;
        persist();
      }),
  });
  const controls = require("./twitch-automation-controls")({ getRows: rows, account, control });
  function persist() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(data) + "\n", { mode: 0o600 });
      fs.renameSync(file + ".tmp", file);
    } catch {
      closed = true;
      throw fault("twitch_automation_store_unavailable");
    }
  }
  if (!closed) {
    try {
      const imported = require("./command-pending-import").apply(file, data);
      if (imported.changed) {
        data = imported.data;
        persist();
        imported.finish();
      }
      const migrated = data.rows.map((row) => {
        const steps = require("../../shared/fs/migrate-action-references")(row.steps);
        try {
          return { ...row, steps: require("./command-source-fields").messages(steps) };
        } catch {
          // An unsupported old template must remain editable, without disabling other flows.
          return { ...row, steps };
        }
      });
      if (JSON.stringify(migrated) !== JSON.stringify(data.rows)) {
        require("./command-source-fields").backup(file, data);
        data = { ...data, rows: migrated, revision: data.revision + 1 };
        persist();
      }
    } catch {
      closed = true;
    }
  }
  const legacyId = (owner, reward) =>
    crypto
      .createHash("sha256")
      .update(owner + ":" + reward)
      .digest("hex")
      .slice(0, 24);
  function rows(owner) {
    const own = data.rows.filter((row) => row.accountId === owner),
      detached = new Set(
        data.detached.filter((row) => row.accountId === owner).map((row) => row.rewardId),
      );
    return [
      ...own,
      ...getProvider()
        .status()
        .managedRewards.filter(
          (row) =>
            HANDLERS.includes(row.purpose) &&
            row.purpose !== "flow" &&
            !detached.has(row.rewardId) &&
            !own.some((flow) => flow.trigger.rewardId === row.rewardId),
        )
        .map((row) => ({
          id: legacyId(owner, row.rewardId),
          accountId: owner,
          name: row.title,
          enabled: true,
          trigger: { type: "reward", rewardId: row.rewardId },
          handler: row.purpose,
          steps: [],
          cooldownSeconds: 0,
          role: "viewer",
          legacy: true,
        })),
    ];
  }
  function status() {
    const owner = account();
    return {
      ok: !closed,
      error: closed ? "twitch_automation_store_unavailable" : "",
      revision: data.revision,
      shoutouts: getShoutouts()?.snapshot(),
      livePausedRewardIds: liveRewards.pausedIds(),
      rows: rows(owner).map(({ accountId, ...row }) => row),
      timers: triggers
        .snapshot()
        .filter((timer) => data.rows.some((row) => row.id === timer.id && row.accountId === owner)),
      history: history.filter((row) => row.accountId === owner).map(({ accountId, ...row }) => row),
      running: [...runs.values()]
        .filter((row) => row.accountId === owner)
        .map(({ accountId, ...row }) => row),
    };
  }
  const check = (revision) => {
    if (closed) throw fault("twitch_automation_store_unavailable");
    if (revision !== data.revision) throw fault("twitch_automation_revision_conflict");
    return account();
  };
  function serial(operation) {
    const task = mutation.then(operation);
    mutation = task.catch(() => {});
    return task;
  }
  function save(input) {
    return serial(async () => {
      const owner = check(input.revision),
        row = normalize(input.automation, owner),
        existing = rows(owner).find((other) => other.id === row.id);
      if (data.rows.some((other) => other.id === row.id && other.accountId !== owner))
        throw fault("twitch_automation_account_changed");
      if (runs.has(row.id)) throw fault("control_deck_busy");
      if (
        JSON.stringify([...data.rows.filter((other) => other.id !== row.id), row]).length > 200000
      )
        throw fault("twitch_automation_limit");
      if (
        rows(owner).some(
          (other) =>
            other.id !== row.id &&
            other.trigger.type === row.trigger.type &&
            (row.trigger.type === "reward"
              ? row.trigger.rewardId && other.trigger.rewardId === row.trigger.rewardId
              : row.trigger.type === "command" &&
                require("./command-triggers").overlaps(other.trigger, row.trigger)),
        )
      )
        throw fault("twitch_automation_trigger_exists");
      if (row.trigger.rewardId) {
        const bound = await getProvider().bindReward({
          purpose: "automation:" + row.id,
          rewardId: row.trigger.rewardId,
        });
        if (!bound.ok) throw fault(bound.error);
        if (account() !== owner) throw fault("twitch_automation_account_changed");
      }
      if (data.rows.length >= 128 && !data.rows.some((other) => other.id === row.id))
        throw fault("twitch_automation_limit");
      if (existing?.trigger.rewardId && existing.trigger.rewardId !== row.trigger.rewardId)
        detach(owner, existing.trigger.rewardId);
      data.rows = data.rows.filter((other) => other.id !== row.id);
      data.rows.push(row);
      data.revision++;
      persist();
      triggers.sync();
      getProvider().refreshSubscriptions?.();
      return status();
    });
  }
  function detach(owner, rewardId) {
    if (!data.detached.some((row) => row.accountId === owner && row.rewardId === rewardId)) {
      if (data.detached.length >= 512) throw fault("twitch_automation_detached_limit");
      data.detached.push({ accountId: owner, rewardId });
    }
  }
  function remove(input) {
    return serial(() => {
      const owner = check(input.revision),
        row = rows(owner).find((row) => row.id === input.id);
      if (!row) throw fault("twitch_automation_missing");
      if (runs.has(row.id)) throw fault("control_deck_busy");
      if (row.trigger.rewardId) detach(owner, row.trigger.rewardId);
      data.rows = data.rows.filter((other) => other.id !== row.id);
      data.revision++;
      persist();
      triggers.sync();
      getProvider().refreshSubscriptions?.();
      return status();
    });
  }
  function reward(input) {
    return serial(async () => {
      const owner = check(input.revision),
        row =
          data.rows.find((row) => row.id === input.id && row.accountId === owner) ||
          rows(owner).find((row) => row.id === input.id);
      if (!row || row.trigger.type !== "reward") throw fault("twitch_automation_missing");
      if (runs.has(row.id)) throw fault("control_deck_busy");
      let result;
      if (input.operation === "create") {
        if (row.trigger.rewardId) throw fault("twitch_reward_already_bound");
        result = await getProvider().createReward({
          ...input.fields,
          purpose: "automation:" + row.id,
        });
      } else if (input.operation === "update" && row.trigger.rewardId)
        result = await getProvider().updateReward({
          ...input.fields,
          rewardId: row.trigger.rewardId,
        });
      else if (
        input.operation === "delete" &&
        row.trigger.rewardId &&
        input.confirmRewardId === row.trigger.rewardId
      )
        result = await getProvider().deleteReward({ rewardId: row.trigger.rewardId });
      else throw fault("twitch_reward_operation_invalid");
      if (!result.ok) return result;
      if (account() !== owner) throw fault("twitch_automation_account_changed");
      const next = {
        ...row,
        trigger: { ...row.trigger, rewardId: input.operation === "delete" ? "" : result.rewardId },
      };
      delete next.legacy;
      if (input.operation === "delete") {
        detach(owner, row.trigger.rewardId);
        next.enabled = false;
      }
      data.rows = data.rows.filter((other) => other.id !== row.id);
      data.rows.push(next);
      data.revision++;
      persist();
      liveRewards.edited(result.rewardId || row.trigger.rewardId, input.fields?.paused);
      await liveRewards.sync(true);
      return { ...status(), reward: result };
    });
  }
  function record(row, result) {
    history.unshift({
      id: row.id,
      name: row.name,
      accountId: row.accountId,
      at: now(),
      ok: result.ok === true,
      code: result.code || result.error || "completed",
    });
    history.splice(40);
  }
  function receipt(owner, id) {
    const hash = crypto
      .createHash("sha256")
      .update(owner + ":" + id)
      .digest("hex");
    data.receipts = data.receipts.filter((row) => now() - row.at < 7 * 86400000);
    if (data.receipts.some((row) => row.hash === hash)) return false;
    if (data.receipts.length >= 8192) throw fault("twitch_automation_receipts_full");
    data.receipts.push({ hash, at: now() });
    persist();
    return true;
  }
  function launch(row, event, context) {
    const result = eventBacklog.start(row, context, () => launchNow(row, event, context));
    if (result.result?.code === "twitch_event_queue_full") record(row, result.result);
    return result;
  }
  function launchNow(row, event, context) {
    context = templateContext(
      context ||
        require("./twitch-automation-context").fromEvent(event ? "reward" : "manual", event),
      row.accountId,
    );
    context.isCurrent = () => !closed && row.enabled && data.rows.includes(row);
    let run;
    try {
      run = deck.runAutomation(
        row.id,
        row.steps,
        () => {
          if (account() !== row.accountId) throw fault("twitch_automation_account_changed");
        },
        context ||
          require("./twitch-automation-context").fromEvent(event ? "reward" : "manual", event),
      );
    } catch (error) {
      const result = { ok: false, code: error.code || "twitch_automation_failed" };
      record(row, result);
      return { accepted: false, result };
    }
    runs.set(row.id, { id: row.id, accountId: row.accountId, runId: run.runId, name: row.name });
    const completion = run.completion
      .then(async (result) => {
        runs.delete(row.id);
        record(row, result);
        await require("./command-feedback").notify(result, context, row.accountId, getProvider);
        if (event && result.ok && getProvider().status().userId === row.accountId)
          await getProvider().settle({
            broadcasterId: row.accountId,
            rewardId: event.reward.id,
            redemptionId: event.id,
            status: "FULFILLED",
          });
        return result;
      })
      .catch(() => {
        runs.delete(row.id);
        record(row, { ok: false, code: "twitch_automation_outcome_unknown" });
      })
      .finally(() => eventBacklog.ready());
    void completion;
    return { accepted: true };
  }
  async function redemption(event, managed) {
    const owner = account();
    if (closed)
      return { handled: true, body: { ok: false, code: "twitch_automation_store_unavailable" } };
    if (event?.broadcaster_user_id !== owner) return { handled: false };
    const row = rows(owner).find(
        (row) => row.trigger.type === "reward" && row.trigger.rewardId === event.reward?.id,
      ),
      detached = data.detached.some(
        (row) => row.accountId === owner && row.rewardId === event.reward?.id,
      );
    if (!row && !detached) return { handled: false };
    const liveAllowed = !row || (await liveRewards.allowRedemption(row, owner));
    if (!row?.enabled || !liveAllowed) {
      await getProvider().settle({
        broadcasterId: owner,
        rewardId: event.reward.id,
        redemptionId: event.id,
        status: "CANCELED",
      });
      return {
        handled: true,
        body: {
          ok: false,
          code: liveAllowed ? "twitch_automation_disabled" : "twitch_automation_live_required",
        },
      };
    }
    if (row.handler !== "flow")
      return {
        handled: true,
        ...(await legacy(event, { [row.handler]: { rewardId: event.reward.id } })),
      };
    const started = launch(row, event);
    if (!started.accepted)
      await getProvider().settle({
        broadcasterId: owner,
        rewardId: event.reward.id,
        redemptionId: event.id,
        status: "CANCELED",
      });
    return {
      handled: true,
      body: {
        ok: started.accepted,
        settlement: { pending: started.accepted, reason: "automation_running" },
      },
    };
  }
  async function chat(event) {
    triggers.chat(event);
    const owner = account();
    if (
      closed ||
      event?.broadcaster_user_id !== owner ||
      !event.chatter_user_id ||
      !event.message_id
    )
      return { handled: false };
    if (/^!command(?:\s|$)/i.test(String(event.message?.text || "").trim()))
      return community.chat(event);
    const matched = require("./command-triggers").match(
        rows(owner),
        String(event.message?.text || "")
          .slice(0, 500)
          .trim(),
      ),
      row = matched?.row;
    if (!row) return community.chat(event);
    community.observeChat(event);
    if (!row.enabled) return { handled: true, accepted: false, code: "twitch_automation_disabled" };
    if (!receipt(owner, event.message_id))
      return { handled: true, accepted: false, code: "duplicate" };
    const role =
      event.chatter_user_id === owner
        ? "broadcaster"
        : roleFromEvent(event) === "moderator"
          ? "moderator"
          : roleFromEvent(event) === "vip"
            ? "vip"
            : event.badges?.some((b) => ["subscriber", "founder"].includes(b.set_id))
              ? "subscriber"
              : "viewer";
    const roles = { viewer: 0, subscriber: 1, vip: 2, moderator: 3, broadcaster: 4 };
    if (roles[role] < roles[row.role])
      return { handled: true, accepted: false, code: "twitch_automation_role_required" };
    if ((cooldowns.get(row.id) || 0) > now())
      return { handled: true, accepted: false, code: "twitch_automation_cooldown" };
    const userKey = row.id + ":" + event.chatter_user_id;
    if ((cooldowns.get(userKey) || 0) > now())
      return { handled: true, accepted: false, code: "twitch_automation_user_cooldown" };
    if (row.trigger.onlyLive && !(await commandLive(owner)))
      return { handled: true, accepted: false, code: "twitch_automation_live_required" };
    const result = launch(row, null, {
      ...require("./twitch-automation-context").fromEvent("command", event),
      argv: matched.argv,
      command: row.trigger.command,
      role,
    });
    if (result.accepted) {
      cooldowns.set(row.id, now() + row.cooldownSeconds * 1000);
      cooldowns.set(userKey, now() + (row.userCooldownSeconds ?? 15) * 1000);
      while (cooldowns.size > 2048) cooldowns.delete(cooldowns.keys().next().value);
    }
    return { handled: true, accepted: result.accepted };
  }
  function control(input) {
    return serial(() => {
      const owner = account(),
        row =
          data.rows.find((row) => row.id === input.id && row.accountId === owner) ||
          rows(owner).find((row) => row.id === input.id);
      const trigger = require("./twitch-automation-controls").prepare(
        row,
        input.operation,
        closed,
        now(),
      );
      if (row.legacy) {
        delete row.legacy;
        data.rows.push(row);
      }
      row.trigger = trigger;
      row.enabled =
        input.operation === "pause" ? false : input.operation === "toggle" ? !row.enabled : true;
      if (
        input.operation === "restart" ||
        (row.enabled &&
          row.trigger.type === "timer" &&
          triggers.snapshot().find((timer) => timer.id === row.id)?.phase === "completed")
      )
        triggers.reset(row.id);
      data.revision++;
      persist();
      triggers.sync();
      getProvider().refreshSubscriptions?.();
      return { ok: true, enabled: row.enabled, ...status() };
    });
  }
  function communityImport(input, apply = false) {
    return community.store.import(
      {
        owner: account(),
        quotes: input.quotes.map((row) => (typeof row === "string" ? { text: row } : row)),
        watchtime: [],
        points: [],
      },
      apply,
    );
  }
  return {
    overlayRecords: (widgets) =>
      require("./overlay-command-records")({
        widgets,
        owner: account(),
        counterOwner,
        community: community.store,
      }),
    communityPreview: (input) => ({ ok: true, ...communityImport(input) }),
    communityImport: (input) => ({ ok: true, ...communityImport(input, true) }),
    communityQuotes: (input) => community.store.manageQuotes(account(), input),
    communityTracking: (input) => community.tracking(input),
    status,
    save,
    remove,
    reward,
    redemption,
    chat,
    catalog: () => ({
      supportsOfflinePolicy: true,
      supportsCommunityCommands: true,
      supportsChatCommandManagement: true,
      supportsRichQuoteImport: true,
      supportsQuoteManagement: true,
      supportsPlayerComparison: true,
      supportsShoutoutQueue: true,
      presets: require("./command-presets"),
      templates: require("./command-variable-guide"),
      ok: true,
      ...deck.catalog(),
      events:
        require("../../capabilities/feature-platform/providers/twitch-automation-events").EVENTS.map(
          ([type, label, scope]) => ({
            type,
            label,
            available: !scope || getProvider().status().scopes.includes(scope),
          }),
        ),
    }),
    control,
    renderMessage(source, signal) {
      return templateContext({ event: "button" }, account()).render(source, signal);
    },
    preview(input) {
      const owner = account(),
        context = templateContext(
          {
            user: "sample_viewer",
            sender: "sample_viewer",
            raider: "sample_raider",
            argv: String(input.arguments ?? "sample_target")
              .trim()
              .split(/\s+/)
              .slice(0, 20),
            role: "viewer",
            event: "preview",
            bits: "100",
            months: "3",
            gifts: "5",
            viewers: "25",
          },
          owner,
          true,
        );
      return context
        .render(input.template)
        .then((text) => ({ ok: true, text }))
        .catch((error) => ({
          ok: true,
          text: "",
          validationError: String(error.message).slice(0, 250),
        }));
    },
    actions: controls,
    async tick() {
      await triggers.tick();
      await liveRewards.sync();
    },
    event(type, ...args) {
      eventBacklog.event(type);
      community.observeEvent(type, args[0]);
      liveRewards.observe(type, args[0]);
      return triggers.event(type, ...args);
    },
    events(owner) {
      const configured = data.rows
        .filter((row) => row.accountId === owner && row.enabled)
        .flatMap((row) =>
          row.trigger.type === "event"
            ? [row.trigger.event]
            : (row.trigger.type === "timer" && row.trigger.onlyLive) ||
                liveRewards.requiresLive(row)
              ? ["stream.online", "stream.offline"]
              : [],
        );
      return [...new Set([...community.events(), ...configured])];
    },
    setActive(value) {
      liveRewards.setActive(!closed && value);
      void liveRewards.sync(true).catch(() => {});
      community.setActive(!closed && value);
      triggers.setActive(!closed && value);
      if (!value) {
        eventBacklog.clear();
        for (const run of runs.values()) deck.cancel(run.runId);
      }
    },
    cancel(input) {
      const owner = account(),
        run = [...runs.values()].find(
          (row) => row.runId === input.runId && row.accountId === owner,
        );
      if (!run) throw fault("control_deck_run_invalid");
      return { ok: true, ...deck.cancel(run.runId) };
    },
    shutdown() {
      liveRewards.setActive(false);
      eventBacklog.clear();
      community.shutdown();
      triggers.close();
      closed = true;
      for (const run of runs.values()) deck.cancel(run.runId);
    },
  };
};
