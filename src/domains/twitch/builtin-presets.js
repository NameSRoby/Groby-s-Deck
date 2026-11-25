/** Public feature controls; account bindings and personal settings live elsewhere. */
module.exports = [
  {
    id: "builtin-lights",
    name: "Change lights",
    handler: "lights",
    command: "!color",
    aliases: ["!colour", "!lights"],
    description:
      "Apply a color to configured stream lights. Uses chat while no Channel Points reward is bound.",
  },
  {
    id: "builtin-teach",
    name: "Teach color",
    handler: "teach",
    command: "!teachcolor",
    aliases: ["!teach", "!teachcolour"],
    description:
      "Teach a named color, for example !teachcolor ocean glow #12ABEF. Uses chat while no reward is bound.",
  },
  {
    id: "builtin-song-request",
    name: "Song Request",
    handler: "song_request",
    command: "!sr",
    aliases: ["!songrequest"],
    description:
      "Request a song on the selected player. Uses chat while no Song Request reward is bound.",
  },
  {
    id: "builtin-add-to-playlist",
    name: "Add to playlist",
    handler: "add_to_playlist",
    command: "!addtoplaylist",
    aliases: ["!playlistadd", "!addsong"],
    description:
      "Add a song to the selected request playlist using the same validation and limits as a reward.",
  },
].map((preset) => ({
  ...preset,
  group: "Built-in features",
  trigger: { type: "reward", rewardId: "" },
  steps: [],
  role: "viewer",
  cooldownSeconds: 0,
  userCooldownSeconds: 15,
}));
