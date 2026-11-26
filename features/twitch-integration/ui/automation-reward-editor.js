/** Populate and read the Channel Points settings independently of the automation editor. */
window.createAutomationRewardEditor = ($, cooldown) => ({
  createValue: "new-builtin-reward",
  options(value, rewards, feature, bound) {
    const picker = $("rewardId");
    picker.replaceChildren(
      new Option(
        feature ? "Chat command (" + feature.command + ")" : "Create a new Twitch reward",
        "",
      ),
    );
    if (feature && !bound) picker.add(new Option("Create a new Twitch reward", this.createValue));
    const manageable = rewards.filter((row) => row.manageable);
    for (const reward of manageable) picker.add(new Option(reward.title, reward.id));
    if (value && !manageable.some((row) => row.id === value))
      picker.add(new Option("Bound reward · refresh to check availability", value));
    picker.value = value || "";
  },
  fill(row = {}, { name, livePaused, copyTitle }) {
    for (const [id, key, fallback] of [
      ["rewardTitle", "title", name],
      ["cost", "cost", 100],
      ["prompt", "prompt", ""],
      ["color", "backgroundColor", "#9146ff"],
      ["maxStream", "maxPerStream", 0],
      ["maxUser", "maxPerUser", 0],
    ])
      $(id).value = row[key] ?? fallback;
    cooldown.set(row.cooldownSeconds ?? 0);
    for (const [id, key, fallback] of [
      ["rewardEnabled", "enabled", true],
      ["paused", "paused", false],
      ["userInput", "userInputRequired", false],
    ])
      $(id).checked =
        id === "paused" && livePaused?.includes(row.id) ? false : (row[key] ?? fallback);
    $("rewardTitle").dataset.automatic = String(!row.title);
    if (copyTitle && row.title) $("name").value = row.title;
  },
  read() {
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
      cooldownSeconds: cooldown.read(),
    };
  },
});
