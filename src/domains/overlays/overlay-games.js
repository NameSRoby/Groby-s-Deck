/** Saved overlay games share one owner across OBS, editors, buttons and chat. */
const fs = require("node:fs");
const path = require("node:path");
const { randomInt } = require("node:crypto");
const { writeJsonFile } = require("../../shared/fs/json-file-store");
const TYPES = ["wheel", "bingo", "chat-vote"];
module.exports = ({ runtimeDir, documents, now = Date.now, random = randomInt }) => {
  const file = path.join(runtimeDir, "system", "overlay-games.json");
  let states = {},
    timer,
    dirty = false,
    blocked = false;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32000000) throw Error();
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      value.version !== 1 ||
      !value.states ||
      typeof value.states !== "object" ||
      Array.isArray(value.states) ||
      Object.keys(value.states).length > 1280
    )
      throw Error();
    for (const s of Object.values(value.states))
      if (
        !s ||
        typeof s.signature !== "string" ||
        !Number.isSafeInteger(s.version) ||
        !Array.isArray(s.entries) ||
        s.entries.length > 100 ||
        !Array.isArray(s.marks) ||
        s.marks.length > 100 ||
        !Array.isArray(s.counts) ||
        s.counts.length > 100 ||
        !s.votes ||
        typeof s.votes !== "object" ||
        Object.keys(s.votes).length > 20000 ||
        !s.entrants ||
        typeof s.entrants !== "object"
      )
        throw Error();
    states = value.states;
  } catch (error) {
    if (error.code !== "ENOENT") blocked = true;
  }
  let totalVoters = Object.values(states).reduce((sum, s) => sum + (s.voterCount || 0), 0);
  const key = (doc, w) => doc.id + ":" + w.id;
  const rules = require("../../../public/core/overlay-game-rules"),
    { signature, initial } = rules;
  function state(doc, w) {
    const id = key(doc, w);
    if (!states[id] || states[id].signature !== signature(w)) {
      totalVoters -= states[id]?.voterCount || 0;
      states[id] = initial(w);
    }
    return states[id];
  }
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!dirty || blocked) return;
    const keep = new Set(
      documents().flatMap((doc) =>
        doc.widgets.filter((w) => TYPES.includes(w.type)).map((w) => key(doc, w)),
      ),
    );
    states = Object.fromEntries(Object.entries(states).filter(([id]) => keep.has(id)));
    writeJsonFile(file, { version: 1, states }, { mode: 0o600, backup: false });
    dirty = false;
  }
  function changed() {
    dirty = true;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        try {
          flush();
        } catch {
          blocked = true;
        }
      }, 1000);
      timer.unref?.();
    }
  }
  function control(docId, widgetId, operation, input = {}, owner = "") {
    if (blocked) throw Error("Overlay game storage needs recovery before changes can be saved.");
    const doc = documents().find((d) => d.id === docId),
      w = doc?.widgets.find((w) => w.id === widgetId);
    if (!w || !TYPES.includes(w.type)) throw Error("Choose a saved game widget first.");
    const s = state(doc, w);
    if (input.version !== undefined && input.version !== s.version)
      throw Error("This game changed in another window. Try again.");
    const before =
      ["start", "collect"].includes(operation) && s.owner && s.owner !== owner ? initial(w) : s;
    states[key(doc, w)] = rules.control(before, w, operation, input, now(), random);
    totalVoters += (states[key(doc, w)].voterCount || 0) - (s.voterCount || 0);
    if (["start", "collect"].includes(operation)) states[key(doc, w)].owner = owner;
    states[key(doc, w)].version = s.version + 1;
    changed();
    flush();
    return { ok: true };
  }
  function receive(event, metadata, owner) {
    if (
      blocked ||
      metadata?.isAppMessage ||
      event.broadcaster_user_id !== owner ||
      !/^\d{1,80}$/.test(event.chatter_user_id || "")
    )
      return;
    for (const doc of documents())
      for (const w of doc.widgets) {
        if (!w.visible || !["chat-vote", "wheel"].includes(w.type)) continue;
        const s = state(doc, w);
        if (s.owner !== owner) continue;
        if (w.type === "wheel") {
          const login = String(event.chatter_user_login || "").toLowerCase();
          if (
            w.entrySource === "chat" &&
            s.collecting &&
            String(event.message?.text || "")
              .trim()
              .toLowerCase() === w.joinCommand &&
            /^[a-z0-9_]{1,25}$/.test(login) &&
            !Object.hasOwn(s.entrants, event.chatter_user_id) &&
            s.entries.length < 100
          ) {
            s.entrants[event.chatter_user_id] = login;
            s.entries.push(login);
            s.version++;
            changed();
          }
          continue;
        }
        if (!s.open || s.endsAt <= now()) continue;
        const words = String(event.message?.text || "")
          .trim()
          .split(/\s+/);
        if (words.length !== 2 || words[0].toLowerCase() !== w.votePrefix.toLowerCase()) continue;
        const choice = Number(words[1]) - 1,
          voter = event.chatter_user_id;
        if (
          !Number.isInteger(choice) ||
          choice < 0 ||
          choice >= w.items.length ||
          Object.hasOwn(s.votes, voter) ||
          (s.voterCount || 0) >= 20000 ||
          totalVoters >= 100000
        )
          continue;
        s.votes[voter] = choice;
        s.voterCount = (s.voterCount || 0) + 1;
        totalVoters++;
        s.counts[choice]++;
        s.version++;
        changed();
      }
  }
  function snapshot(owner) {
    const result = {};
    for (const doc of documents())
      for (const w of doc.widgets) {
        if (!TYPES.includes(w.type) || !w.visible) continue;
        const s = state(doc, w),
          {
            votes: _private,
            entrants: _entrants,
            signature: _config,
            owner: _account,
            ...publicState
          } = s;
        if (w.type === "chat-vote" && s.owner !== owner) {
          publicState.open = false;
          publicState.counts = w.items.map(() => 0);
        } else if (publicState.endsAt <= now()) publicState.open = false;
        if (w.type === "wheel" && w.entrySource === "chat" && s.owner !== owner) {
          publicState.entries = [];
          publicState.winner = "";
          publicState.collecting = false;
          publicState.spunAt = 0;
        }
        (result[doc.id] ??= {})[w.id] = structuredClone(publicState);
      }
    return result;
  }
  function reconcile() {
    const keep = new Set(documents().flatMap((doc) => doc.widgets.map((w) => key(doc, w))));
    for (const id of Object.keys(states))
      if (!keep.has(id)) {
        totalVoters -= states[id].voterCount || 0;
        delete states[id];
        dirty = true;
      }
    if (dirty) {
      try {
        flush();
      } catch {
        blocked = true;
      }
    }
  }
  return {
    control,
    bingo(doc, widget) {
      const current = state(doc, widget);
      return { ...rules.bingoBoard(widget, current.marks), version: current.version };
    },
    receive,
    snapshot,
    flush,
    reconcile,
    error: () =>
      blocked
        ? "Overlay game storage is unavailable. Check runtime storage before changing games."
        : "",
    close: () => flush(),
  };
};
