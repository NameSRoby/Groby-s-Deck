/** Operator-editable Helix fields; omitted values preserve existing reward settings. */
module.exports = function rewardFields(input, create = false) {
  const body = {};
  for (const [key, api, max] of [
    ["title", "title", 45],
    ["prompt", "prompt", 200],
  ])
    if (input[key] !== undefined) {
      if (
        typeof input[key] !== "string" ||
        input[key].length > max ||
        (key === "title" && !input[key].trim())
      )
        throw Error("twitch_reward_fields_invalid");
      body[api] = input[key].trim();
    }
  if (input.cost !== undefined) {
    if (!Number.isSafeInteger(input.cost) || input.cost < 1 || input.cost > 1000000000)
      throw Error("twitch_reward_fields_invalid");
    body.cost = input.cost;
  }
  for (const [key, api] of [
    ["enabled", "is_enabled"],
    ["userInputRequired", "is_user_input_required"],
    ["paused", "is_paused"],
  ])
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") throw Error("twitch_reward_fields_invalid");
      body[api] = input[key];
    }
  if (input.backgroundColor !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(input.backgroundColor)) throw Error("twitch_reward_fields_invalid");
    body.background_color = input.backgroundColor;
  }
  for (const [key, enabled, value] of [
    ["maxPerStream", "is_max_per_stream_enabled", "max_per_stream"],
    ["maxPerUser", "is_max_per_user_per_stream_enabled", "max_per_user_per_stream"],
    ["cooldownSeconds", "is_global_cooldown_enabled", "global_cooldown_seconds"],
  ])
    if (input[key] !== undefined) {
      const n = input[key];
      if (
        !Number.isSafeInteger(n) ||
        n < 0 ||
        n > (key === "cooldownSeconds" ? 604800 : 1000000000)
      )
        throw Error("twitch_reward_fields_invalid");
      body[enabled] = n > 0;
      if (n > 0) body[value] = n;
    }
  if (create) {
    if (input.paused === true) throw Error("twitch_reward_pause_after_create");
    delete body.is_paused;
    if (!body.title || !body.cost) throw Error("twitch_reward_fields_invalid");
    body.is_user_input_required ??= true;
    body.should_redemptions_skip_request_queue = false;
  }
  return body;
};
