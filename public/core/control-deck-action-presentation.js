/** Presentation metadata keeps optional/automatic action fields out of the user's way. */
export function presentAction(input) {
  if (!input) return input;
  const action = structuredClone(input),
    fields = action.parameters?.properties;
  if (!fields) return action;
  const annotate = (key, details) => {
    if (fields[key]) Object.assign(fields[key], details);
  };
  if (action.id === "twitch.action.shoutout") {
    action.description =
      "Twitch's native shoutout. An incoming raid supplies the raider automatically when it arrives. Requires a live broadcast and Shoutouts access. Twitch allows one every 2 minutes, and one per broadcaster every 60 minutes.";
    if (action.queueSupported)
      action.description +=
        " Back-to-back raiders wait in a queue automatically. Duplicate and recently shouted-out channels are skipped.";
    annotate("target", {
      title: "Shoutout recipient",
      enumNames: {
        raider: "Incoming raider (automatic)",
        "user-id": "Fixed Twitch user ID (advanced)",
      },
    });
    annotate("userId", {
      title: "Fixed broadcaster ID",
      pattern: "[0-9]{1,80}",
      "x-visibleWhen": { target: "user-id" },
      "x-requiredWhen": { target: "user-id" },
    });
  }
  if (action.id === "twitch.action.bot-shoutout") {
    action.description =
      "Asks an external chat bot to run !so or !shoutout. That bot must be connected and recognise the command. For Twitch's built-in shoutout, choose Send a native shoutout.";
    annotate("target", {
      title: "Shoutout recipient",
      enumNames: { raider: "Incoming raider (automatic)", login: "A specific channel" },
    });
    annotate("login", {
      title: "Channel username",
      pattern: "[A-Za-z0-9_]{1,25}",
      "x-visibleWhen": { target: "login" },
      "x-requiredWhen": { target: "login" },
    });
    annotate("command", { title: "External bot command" });
  }
  if (action.id === "twitch.action.commercial") {
    annotate("length", {
      title: "Ad duration",
      enumNames: Object.fromEntries([30, 60, 90, 120, 150, 180].map((n) => [n, n + " seconds"])),
    });
  }
  if (["twitch.action.chat", "twitch.action.announcement"].includes(action.id)) {
    annotate("message", { title: "Message" });
    annotate("color", { title: "Announcement color" });
    action.description =
      "Write a message and insert variables. Names and event values are filled in when this flow runs.";
  }
  if (action.id === "twitch.action.channel-info") {
    annotate("title", {
      title: "New stream title",
      description: "Leave empty to keep the current title.",
    });
    annotate("gameId", {
      title: "Twitch category ID (advanced)",
      description:
        "For a category name instead, use the moderator chat command !category followed by its name.",
    });
  }
  return action;
}
