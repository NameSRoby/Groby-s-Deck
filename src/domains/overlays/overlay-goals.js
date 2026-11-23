/** Durable, account-scoped goals consume Twitch events and readings, never chat guesses. */
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../../../public/core/overlay-goal-sources");
const { createHash } = require("node:crypto");
module.exports = ({ runtimeDir, now = Date.now, changed = () => {} }) => {
  const file = path.join(runtimeDir, "overlays", "goals.json");
  let state = { version: 1, owners: {} },
    pendingWrite = null,
    blocked = false,
    storageError = "";
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
      throw Error("Invalid goal storage file.");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      saved.version !== 1 ||
      !saved.owners ||
      typeof saved.owners !== "object" ||
      Array.isArray(saved.owners) ||
      Object.keys(saved.owners).length > 32
    )
      throw Error("Invalid goal storage.");
    for (const [owner, value] of Object.entries(saved.owners)) {
      if (
        !/^\d{1,80}$/.test(owner) ||
        !value?.goals ||
        typeof value.goals !== "object" ||
        Array.isArray(value.goals) ||
        Object.keys(value.goals).length > 64 ||
        !Array.isArray(value.seen) ||
        value.seen.length > 1024 ||
        value.seen.some((id) => !/^[a-f0-9]{24}$/.test(id))
      )
        throw Error("Invalid goal account data.");
      for (const [name, row] of Object.entries(value.goals))
        if (
          !/^[a-z0-9][a-z0-9 _-]{0,63}$/.test(name) ||
          row?.name !== name ||
          !catalog.find(row.tracking) ||
          !Number.isFinite(row.current) ||
          row.current < 0 ||
          !Number.isFinite(row.target) ||
          row.target <= 0 ||
          !Number.isFinite(row.endsAt) ||
          !Number.isFinite(row.startedAt)
        )
          throw Error("Invalid saved goal.");
    }
    state = saved;
  } catch (error) {
    if (error.code !== "ENOENT") {
      blocked = true;
      storageError = "Saved goal data could not be read. The original file has been preserved.";
    }
  }
  const get = (v, key) => key.split(".").reduce((row, part) => row?.[part], v);
  function key(name) {
    const value = String(name || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9][a-z0-9 _-]{0,63}$/.test(value))
      throw Error("Use a goal name of 1–64 letters, digits, spaces, _ or -.");
    return value;
  }
  function save(notify = false) {
    if (blocked) throw Error(storageError);
    clearTimeout(pendingWrite);
    pendingWrite = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(state));
    fs.renameSync(file + ".tmp", file);
    storageError = "";
    if (notify) changed();
  }
  function schedule() {
    if (pendingWrite) return;
    pendingWrite = setTimeout(() => {
      try {
        save();
      } catch (error) {
        storageError = "Goal progress could not be saved: " + error.message;
      }
    }, 250);
    pendingWrite.unref?.();
  }
  const ownerRows = (owner) => state.owners[owner]?.goals || {};
  function transaction(owner, preview = false) {
    if (blocked) throw Error(storageError);
    if (!/^\d{1,80}$/.test(owner || "")) throw Error("Connect Twitch before managing goals.");
    const draft = structuredClone(ownerRows(owner));
    const original = structuredClone(draft),
      touched = new Set(),
      reset = new Set();
    let dirty = false;
    return {
      read(name) {
        const id = key(name),
          row = Object.hasOwn(draft, id) ? draft[id] : null;
        return row
          ? row.name +
              ": " +
              row.current +
              " / " +
              row.target +
              (row.currency ? " " + row.currency : "")
          : "No goal named " + name + ".";
      },
      create(input) {
        const name = key(input.name),
          source = catalog.find(input.tracking);
        const target = Number(input.target);
        if (!source) throw Error("Choose a Twitch goal tracking preset.");
        if (!Number.isFinite(target) || target <= 0 || target > 1e9)
          throw Error("Goal amount must be greater than zero and at most 1,000,000,000.");
        if (!Object.hasOwn(draft, name) && Object.keys(draft).length >= 64)
          throw Error("You can keep up to 64 named goals per Twitch account.");
        const prior = Object.hasOwn(draft, name) ? draft[name] : null;
        const endsAt = input.endsAt === undefined ? prior?.endsAt || 0 : Number(input.endsAt);
        if (!Number.isFinite(endsAt) || endsAt < 0 || endsAt > 9999999999999)
          throw Error("Choose a valid goal end time.");
        draft[name] = {
          name,
          tracking: source.id,
          target,
          current: prior?.tracking === source.id ? prior.current : 0,
          startedAt: prior?.tracking === source.id ? prior.startedAt : now(),
          endsAt,
          currency: !source.currency
            ? ""
            : /^[A-Z]{3}$/.test(input.currency || "")
              ? input.currency
              : prior?.tracking === source.id
                ? prior.currency
                : "",
          updatedAt: prior?.updatedAt || 0,
        };
        dirty = true;
        touched.add(name);
        return name + ": " + source.name + " goal set to " + target + ".";
      },
      reset(name) {
        const id = key(name),
          row = Object.hasOwn(draft, id) ? draft[id] : null;
        if (!row) throw Error("No goal with that name exists.");
        row.current = 0;
        row.startedAt = now();
        touched.add(row.name);
        reset.add(row.name);
        dirty = true;
        return row.name + ": progress reset; target kept.";
      },
      commit() {
        if (!dirty || preview) return;
        if (!state.owners[owner] && Object.keys(state.owners).length >= 32)
          throw Error("Goal account storage is full.");
        const current = ownerRows(owner);
        for (const name of touched) {
          if (
            !reset.has(name) &&
            original[name]?.tracking === draft[name].tracking &&
            current[name]?.tracking === draft[name].tracking
          ) {
            draft[name].current = current[name].current;
            draft[name].updatedAt = current[name].updatedAt;
          }
          current[name] = draft[name];
        }
        state.owners[owner] = { goals: current, seen: state.owners[owner]?.seen || [] };
        save(true);
      },
    };
  }
  function receive(owner, type, event = {}, metadata = {}) {
    if (blocked) return;
    let dirty = false;
    const id = metadata.snapshot
      ? ""
      : String(metadata.message_id || event.message_id || event.id || "").slice(0, 160);
    const digest =
      id &&
      createHash("sha256")
        .update(type + ":" + id)
        .digest("hex")
        .slice(0, 24);
    if (digest && state.owners[owner]?.seen?.includes(digest)) return;
    for (const row of Object.values(ownerRows(owner))) {
      const source = catalog.find(row.tracking);
      if (!source || source.event !== type || (row.endsAt && now() >= row.endsAt)) continue;
      if (metadata.snapshot && row.updatedAt > metadata.requestedAt) continue;
      if (source.goalType && source.goalType !== event.type) continue;
      let value = source.field ? get(event, source.field) : 1;
      if (source.field === "votes")
        value = (event.choices || []).reduce((n, c) => n + (Number(c.votes) || 0), 0);
      if (source.field === "points")
        value = (event.outcomes || []).reduce((n, c) => n + (Number(c.channel_points) || 0), 0);
      if (source.currency) {
        if (
          !value ||
          !/^[A-Z]{3}$/.test(value.currency) ||
          !Number.isInteger(value.decimal_places) ||
          value.decimal_places < 0 ||
          value.decimal_places > 6
        )
          continue;
        if (row.currency && row.currency !== value.currency) continue;
        row.currency = value.currency;
        value = Number(value.value) / 10 ** value.decimal_places;
      }
      value = Number(value);
      if (!Number.isFinite(value) || value < 0) continue;
      row.current = Math.min(
        1e9,
        Math.round((source.mode === "total" ? row.current + value : value) * 1e6) / 1e6,
      );
      if (!metadata.snapshot) row.updatedAt = now();
      dirty = true;
    }
    if (dirty) {
      if (digest)
        state.owners[owner].seen = [...(state.owners[owner].seen || []), digest].slice(-1024);
      schedule();
    }
  }
  function update(owner, twitch) {
    if (blocked) return;
    let dirty = false;
    for (const goal of twitch.creatorGoals?.goals || [])
      receive(owner, "channel.goal.progress", goal, {
        snapshot: true,
        requestedAt: twitch.creatorGoals.requestedAt || 0,
      });
    if (twitch.charity?.campaign)
      receive(owner, "channel.charity_campaign.progress", twitch.charity.campaign, {
        snapshot: true,
        requestedAt: twitch.charity.requestedAt || 0,
      });
    for (const row of Object.values(ownerRows(owner))) {
      const source = catalog.find(row.tracking);
      if (!source || source.event || (row.endsAt && now() >= row.endsAt)) continue;
      const group = source.field.split(".")[0];
      if (!twitch[group]?.ok) continue;
      const value =
        source.id === "uptime"
          ? twitch.stream.live && twitch.stream.startedAt
            ? Math.max(0, (now() - twitch.stream.startedAt) / 60000)
            : 0
          : get(twitch, source.field);
      if (Number.isFinite(value) && value >= 0 && value !== row.current) {
        row.current = value;
        dirty = true;
      }
    }
    if (dirty) schedule();
  }
  return {
    transaction,
    receive,
    update,
    catalog: catalog.sources,
    error: () => storageError,
    close() {
      if (pendingWrite) save();
    },
    flush() {
      if (pendingWrite) save();
    },
    snapshot(owner) {
      return Object.fromEntries(
        Object.entries(ownerRows(owner)).map(([name, { seen: _seen, ...row }]) => [
          name,
          {
            ...row,
            complete: row.current >= row.target,
            ended: Boolean(row.endsAt && now() >= row.endsAt),
          },
        ]),
      );
    },
    events(owner) {
      return [
        ...new Set(
          Object.values(ownerRows(owner))
            .filter((r) => !r.endsAt || now() < r.endsAt)
            .map((r) => catalog.find(r.tracking)?.event)
            .filter(Boolean),
        ),
      ];
    },
  };
};
