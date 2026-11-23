/** Editable examples use existing actions only; nothing executes when a preset is chosen. */
const chat = (message) => ({ actionId: "twitch.action.chat", params: { message }, delayMs: 0 });
const seasonRecipe = require("../../../public/core/recipes/seasons.json")
  .stages.map((row) => row.source)
  .join("\n\n");
const recordCommand = (id, name, command, description, message) => ({
  id,
  name,
  group: "Seasons & records",
  description,
  trigger: { type: "command", command },
  steps: [chat(message)],
  role: "broadcaster",
  cooldownSeconds: 60,
  userCooldownSeconds: 60,
});
const native = { actionId: "twitch.action.shoutout", params: { target: "raider" }, delayMs: 0 };
const event = (id, name, type, description, steps, group = "Audience events") => ({
  id,
  name,
  group,
  description,
  trigger: { type: "event", event: type },
  steps,
  role: "moderator",
  cooldownSeconds: 0,
  userCooldownSeconds: 0,
});
const timer = (id, name, minutes, message, minMessages = 0) => ({
  id,
  name,
  group: "Timers",
  description:
    "While live, every " +
    minutes +
    " minutes" +
    (minMessages ? " after at least " + minMessages + " new chat messages" : "") +
    ". Edit the message before enabling.",
  trigger: {
    type: "timer",
    intervalMs: minutes * 60000,
    repeatLimit: 0,
    onlyLive: true,
    minMessages,
  },
  steps: [chat(message)],
  role: "moderator",
  cooldownSeconds: 0,
  userCooldownSeconds: 0,
});
const goalRecipe = (message) => ({
  actionId: "twitch.action.recipe",
  params: { message },
  delayMs: 0,
});
const goalControl = (id, name, command, description, source) => ({
  ...recordCommand(id, name, command, description, source),
  group: "Goals",
  cooldownSeconds: 0,
  userCooldownSeconds: 0,
});
module.exports = [
  ...require("./streamer-utility-presets")({ chat, timer, event }),
  ...require("../../../public/core/overlay-goal-sources").sources.map((source) => ({
    id: "track-goal-" + source.id,
    name: source.name + " goal",
    group: "Goals",
    description:
      "One-time setup timer: creates a named goal after one second, then stops. Twitch events or current readings update it automatically. Add a Goal in Overlay Designer and use this name: " +
      source.id +
      ". Adjust its target with !addgoal " +
      source.id +
      " " +
      source.id +
      " " +
      source.target +
      ".",
    trigger: { type: "timer", intervalMs: 1000, repeatLimit: 1, onlyLive: false, minMessages: 0 },
    steps: [goalRecipe("${addgoal " + source.id + " " + source.id + " " + source.target + "}")],
    role: "broadcaster",
    cooldownSeconds: 0,
    userCooldownSeconds: 0,
  })),
  goalControl(
    "add-goal",
    "Create or update a named goal",
    "!addgoal",
    "Broadcaster only. !addgoal name tracking amount. Example: !addgoal community bits 10000. Progress is tracked from Twitch events; an existing goal keeps its progress when its tracking is unchanged.",
    "${addgoal ${1} ${2} ${3}}",
  ),
  goalControl(
    "reset-goal",
    "Reset a named goal",
    "!resetgoal",
    "Broadcaster only. !resetgoal name resets progress and keeps the tracking source and target.",
    "${resetgoal ${1}}",
  ),
  timer(
    "goal-donations",
    "Donation goal progress timer",
    30,
    "Twitch charity goal: ${goal donations}. Thank you for supporting the campaign.",
    5,
  ),
  {
    id: "xp-seasons",
    name: "XP season: every two months",
    group: "Seasons & records",
    description:
      "Save the top three XP records, reset everyone's XP and start the next season without posting chat. Every rule is editable public syntax. Uses two calendar months, not 60 days; review the UTC date before enabling. Other fields are preserved. Add a chat step to announce a new season.",
    trigger: {
      type: "timer",
      calendarMonths: 2,
      nextAt: 0,
      repeatLimit: 0,
      onlyLive: false,
      minMessages: 0,
    },
    steps: [{ actionId: "twitch.action.recipe", params: { message: seasonRecipe }, delayMs: 0 }],
    role: "broadcaster",
    cooldownSeconds: 0,
    userCooldownSeconds: 0,
  },
  recordCommand(
    "new-season",
    "Start the next XP season",
    "!newseason",
    "Broadcaster only. Type !newseason confirm to archive the top three, reset XP and advance the shared season counter. Uses the same generic recipe as the scheduled season.",
    '${if same ${1} "confirm"}' +
      seasonRecipe +
      "${else}Type !newseason confirm to save the leaderboard and reset everyone's XP.${end}",
  ),
  recordCommand(
    "reset-xp",
    "Reset everyone's XP",
    "!resetxp",
    "Broadcaster only. Type !resetxp confirm. Only XP is reset; other fields and saved leaderboards remain. This example does not start a new season.",
    '${if same ${1} "confirm"}${resetstats xp}All player XP has been reset.${else}Type !resetxp confirm to reset everyone\'s XP.${end}',
  ),
  {
    ...recordCommand(
      "season-history",
      "Saved season leaderboards",
      "!season",
      "Type !season to list saved seasons, or !season S1 to see its archived top players.",
      '${if same ${1} ""}${boards}${else}${board ${1}}${end}',
    ),
    role: "viewer",
    cooldownSeconds: 5,
    userCooldownSeconds: 15,
  },
  event(
    "raid-native",
    "Raid: native Twitch shoutout",
    "channel.raid",
    "Automatically shout out the broadcaster who raids you, using Twitch's native API. No username or user ID is needed. Twitch requires you to be live and enforces 2 minutes globally / 60 minutes per broadcaster.",
    [native],
    "Raids",
  ),
  event(
    "raid-native-welcome",
    "Raid: native shoutout + welcome",
    "channel.raid",
    "Send Twitch's native shoutout and a welcome message together. The incoming raid supplies the raider and viewer count; no external bot is needed.",
    [
      {
        type: "parallel",
        steps: [
          native,
          chat(
            "Welcome ${raider} and ${viewers} raiders! Thank you for bringing your community over: ${link user}",
          ),
        ],
      },
    ],
    "Raids",
  ),
  event(
    "raid-welcome",
    "Raid: welcome message",
    "channel.raid",
    "Welcome each incoming raid in chat. The name, audience size and link come from the raid event.",
    [
      chat(
        "Welcome ${raider} and ${viewers} raiders! Make yourselves at home. Follow our raider: ${link user}",
      ),
    ],
    "Raids",
  ),
  event(
    "raid-external-bot",
    "Raid: external bot !so",
    "channel.raid",
    "Optional: send !so for the actual incoming raider. Requires a separate connected bot that handles !so. This is different from Twitch's native shoutout.",
    [
      {
        actionId: "twitch.action.bot-shoutout",
        params: { target: "raider", command: "!so" },
        delayMs: 0,
      },
    ],
    "Raids",
  ),
  event(
    "subscriber-thanks",
    "Subscriber thank-you",
    "channel.subscribe",
    "Thank a new subscriber in chat, using the subscriber from the event.",
    [chat("Thank you, ${user}, for subscribing! Welcome to the community.")],
  ),
  event(
    "resub-thanks",
    "Resubscription thank-you",
    "channel.subscription.message",
    "Thank a returning subscriber and include their cumulative subscription months.",
    [chat("Thank you, ${user}, for ${months} months of support!")],
  ),
  event(
    "gift-thanks",
    "Gift-sub thank-you",
    "channel.subscription.gift",
    "Thank gift subscriptions. The message also works when the sender is anonymous.",
    [chat("Thank you for gifting ${gifts} subscriptions! Enjoy your emotes, everyone.")],
  ),
  event(
    "bits-thanks",
    "Bits thank-you",
    "channel.cheer",
    "Thank a cheer using its actual Bits amount. Also works for anonymous cheers.",
    [chat("Thank you for the ${bits} Bits and for supporting the stream!")],
  ),
  event(
    "follower-thanks",
    "Follower welcome",
    "channel.follow",
    "Welcome the viewer from a new-follow event. Needs Followers & events access.",
    [chat("Welcome, ${user}! Thanks for following.")],
  ),
  timer(
    "chat-reminder",
    "Chat reminder",
    30,
    "Enjoying the stream? Follow the channel and join us again: ${link}",
    5,
  ),
  timer(
    "break-reminder",
    "Hydration & stretch reminder",
    60,
    "A quick reminder to hydrate, rest your eyes and stretch. Take care of yourselves!",
  ),
  timer(
    "rules-reminder",
    "Community rules reminder",
    45,
    "Keep it friendly, respect each other, and ask before posting spoilers or backseating.",
    10,
  ),
  {
    id: "lurk",
    name: "Lurk thank-you",
    group: "Chat commands",
    description:
      "!lurk thanks the person speaking. Everyone can use it; no extra service or URL is required.",
    trigger: { type: "command", command: "!lurk" },
    steps: [chat("Thanks for hanging out, ${sender}! Enjoy your lurk.")],
    role: "viewer",
    cooldownSeconds: 5,
    userCooldownSeconds: 60,
  },
  {
    id: "uptime",
    name: "Stream uptime",
    group: "Chat commands",
    description: "!uptime shows Twitch's current live duration or Offline.",
    trigger: { type: "command", command: "!uptime" },
    steps: [chat("Stream status: ${uptime}")],
    role: "viewer",
    cooldownSeconds: 5,
    userCooldownSeconds: 15,
  },
];
