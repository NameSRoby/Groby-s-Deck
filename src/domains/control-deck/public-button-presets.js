/** Editable button drafts. Selecting a preset never executes its actions. */
const action = (actionId, params = {}) => ({ actionId, params, delayMs: 0 });
const single = (id, name, group, actionId, symbol, params = {}) => ({
  id,
  name,
  group,
  symbol,
  steps: [action(actionId, params)],
});
const presets = [
  single("playback", "Pause / resume playback", "Music", "song.playback-toggle", "\u23ef"),
  single("previous", "Previous song", "Music", "native.player.previous", "\u23ee"),
  single("next", "Next song", "Music", "native.player.next", "\u23ed"),
  single("skip", "Skip current request", "Requests", "song.skip", "\u23ed"),
  single(
    "request-intake",
    "Pause / resume song requests",
    "Requests",
    "song.intake-toggle",
    "\u23ef",
  ),
  single(
    "request-mode",
    "Switch Channel Points / chat requests",
    "Requests",
    "song.request-mode-toggle",
    "\u21c4",
  ),
  single(
    "viewer-intake",
    "Pause / resume rewards and chat",
    "Requests",
    "rewards.toggle",
    "\u23ef",
  ),
  single("ban-song", "Ban current song", "Moderation", "song.ban-current", "\u2298"),
  single("ban-requester", "Ban current requester", "Moderation", "song.ban-requester", "\u2297"),
  single("favorite", "Favorite current song", "Music", "song.favorite", "\u2665"),
  single("unfavorite", "Remove current favorite", "Music", "song.unfavorite", "\u2661"),
  single("music-lights", "Toggle music-reactive lights", "Lights", "music.toggle", "\u266b"),
  single("auto-rave", "Toggle Auto-Rave", "Lights", "music.auto-toggle", "\u21bb"),
  single("rave", "Start / restore Rave", "Lights", "music.rave-toggle", "\u03df"),
  single("clip", "Clip the broadcast", "Stream", "mod:groby.twitch-clips:create", "\u2702", {
    duration: 30,
  }),
  single("timestamp", "Save a stream timestamp", "Stream", "stream.timestamp", "\u25f7"),
  single("windows", "Open Windows controls", "Setup", "view.windows", "\u229e"),
  ...require("../fixtures/public-lighting-profiles").map((profile) =>
    single(
      profile.id,
      profile.name + " lights",
      "Light profiles",
      "lighting.profile:" + profile.id,
      "\u2600",
    ),
  ),
  ...[
    ["hydrate", "Hydration reminder", "Take a moment to hydrate and rest your eyes."],
    [
      "rules",
      "Community rules reminder",
      "Be kind, respect other viewers, and ask before sharing links.",
    ],
    [
      "thanks",
      "Thank viewers",
      "Thanks for spending time with the stream. Your support means a lot!",
    ],
    ["brb-message", "Announce a break", "Taking a short break. Back soon!"],
    ["back-message", "Announce return", "We are back! Thanks for waiting."],
  ].map(([id, name, message]) =>
    single(id, name, "Chat announcements", "twitch.action.chat", "\u25c6", { message }),
  ),
  {
    id: "break",
    name: "Break: pause requests and playback",
    group: "Stream routines",
    symbol: "\u23f8",
    steps: [action("song.pause"), action("song.playback-pause")],
  },
  {
    id: "return",
    name: "Return: resume requests and playback",
    group: "Stream routines",
    symbol: "\u25b6",
    steps: [action("song.resume"), action("song.playback-resume")],
  },
];
module.exports = (actions) => {
  const available = new Map(actions.map((action) => [action.id, action]));
  return presets.map((preset) => ({
    ...structuredClone(preset),
    public: true,
    configurable: preset.steps.every((step) => available.has(step.actionId)),
    available: preset.steps.every(
      (step) => available.has(step.actionId) && available.get(step.actionId).available !== false,
    ),
  }));
};
