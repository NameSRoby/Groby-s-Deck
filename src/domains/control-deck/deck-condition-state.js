/** Read the selected owner's feedback before deciding, rather than awaiting a UI poll. */
module.exports =
  ({ catalog, getMods, rememberFeedback, feedbackEpoch, obs, desktop, refreshSong, fault }) =>
  async (rule) => {
    const { actionId, field } = rule,
      before = catalog().find((row) => row.id === actionId);
    if (field === "available" && !before) return before;
    if (actionId.startsWith("mod:")) {
      const [, modId, id] = actionId.split(":"),
        registry = getMods(),
        epoch = feedbackEpoch.get(actionId) || 0;
      if (!registry?.readActionState) {
        if (field === "available") return before;
        throw fault("control_deck_condition_unavailable");
      }
      const result = await registry.readActionState(modId, id, { timeoutMs: 2500 });
      if ((feedbackEpoch.get(actionId) || 0) !== epoch)
        throw fault("control_deck_condition_unavailable");
      if (!result?.ok) {
        if (field === "available") return { ...before, available: false };
        throw fault("control_deck_condition_unavailable");
      }
      rememberFeedback(actionId, result);
    } else if (actionId.startsWith("obs:")) await obs?.refresh?.(true);
    else if (actionId.startsWith("native.")) await desktop?.refresh?.(true);
    else await refreshSong();
    return catalog().find((row) => row.id === actionId);
  };
