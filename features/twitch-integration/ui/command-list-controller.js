/* global setupCommandList */
(() => {
  const CHANNEL = "groby-feature-ui-v1",
    pending = new Map();
  let sequence = 0,
    rows = [],
    community = false;
  const call = (method, payload = {}) =>
    new Promise((resolve, reject) => {
      const id = "command-list-" + ++sequence,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("Commands could not be loaded. Try Refresh commands."));
        }, 35000);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage(
        {
          channel: CHANNEL,
          type: "call",
          id,
          capability: "twitch.automations.v1",
          method,
          payload,
        },
        "*",
      );
    });
  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.channel !== CHANNEL) return;
    const item = pending.get(event.data.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(event.data.id);
    event.data.ok && event.data.value?.ok !== false
      ? item.resolve(event.data.value)
      : item.reject(Error(event.data.error || "Commands could not be loaded."));
  });
  const creator = setupCommandList({
    getRows: () => rows,
    hasCommunity: () => community,
    getReplyExample: async (id) => {
      const row = rows.find((row) => row.id === id);
      const find = (nodes) => {
        for (const node of nodes || []) {
          if (node.actionId === "twitch.action.chat" && typeof node.params?.message === "string")
            return node.params.message;
          const child = find(node.then) || find(node.else) || find(node.steps);
          if (child) return child;
        }
        return "";
      };
      const template = find(row?.steps);
      if (!template) return "";
      const preview = await call("preview", { template, arguments: "sample_target" });
      return preview.validationError ? "" : preview.text;
    },
  });
  async function load() {
    const button = document.getElementById("commandListRefresh");
    button.disabled = true;
    try {
      const [snapshot, catalog] = await Promise.all([call("status"), call("catalog")]);
      rows = snapshot.rows;
      community = !!catalog.supportsCommunityCommands;
      creator.refresh();
    } catch (error) {
      document.getElementById("commandListStatus").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }
  document.getElementById("commandListRefresh").onclick = load;
  addEventListener("pagehide", () => {
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
  });
  void load();
})();
