(() => {
  // Reward transport is configured once, alongside widget deployment.
  const rewardSourcePanel = document.createElement("section");
  rewardSourcePanel.className = "cluster";
  rewardSourcePanel.innerHTML =
    '<h3>Reward event source</h3><label>Use<select><option value="auto">Automatic: prefer Twitch Integration</option><option value="native">Twitch Integration</option><option value="streamelements">StreamElements widget</option></select></label><button type="button">Save event source</button><p role="status"></p>';
  document.querySelector('[data-panel="widget"]').prepend(rewardSourcePanel);
  async function refreshRewardSource() {
    try {
      const response = await fetch("/api/request-intake");
      if (!response.ok) {
        rewardSourcePanel.querySelector("[role=status]").textContent =
          "Restart Core to load event-source settings.";
        rewardSourcePanel.querySelector("button").disabled = true;
        return;
      }
      const state = await response.json();
      rewardSourcePanel.querySelector("select").value = state.source;
      rewardSourcePanel.querySelector("[role=status]").textContent =
        state.effectiveSource === "native"
          ? "Twitch Integration receives rewards."
          : "Widget fallback receives rewards.";
    } catch {}
  }
  rewardSourcePanel.querySelector("button").onclick = async () => {
    try {
      const response = await fetch("/api/request-intake", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: rewardSourcePanel.querySelector("select").value }),
      });
      if (!response.ok) throw Error("Could not save event source.");
      await refreshRewardSource();
    } catch (error) {
      rewardSourcePanel.querySelector("[role=status]").textContent = error.message;
    }
  };
  void refreshRewardSource();
})();
