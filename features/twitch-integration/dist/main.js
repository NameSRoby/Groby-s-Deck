/**
 * Main.
 * Developer context and change constraints:
 * docs/DEVELOPMENT.md#lighting-and-dynamic-effects
 */
let context;
const counterSyntax = require("./counter-syntax");

async function activate(nextContext) {
  context = nextContext;
}

async function host(method, payload, timeoutMs = 5000) {
  if (!context) throw new Error("feature_not_active");
  return context.callCapability("twitch.host.v1", method, payload, {
    timeoutMs,
  });
}

async function handleRequest(request) {
  if (
    request.capability === "twitch.automations.v1" &&
    [
      "community-preview",
      "community-import",
      "community-quotes",
      "community-tracking",
      "status",
      "catalog",
      "save",
      "remove",
      "reward",
      "cancel",
      "rewards",
      "control",
      "preview",
    ].includes(request.method)
  ) {
    let payload;
    try {
      payload = counterSyntax.fields(request.payload, counterSyntax.display);
    } catch (error) {
      return { ok: false, error: String(error.message).slice(0, 250) };
    }
    const result = await host(
      request.method === "rewards" ? "list-rewards" : "automation-" + request.method,
      payload,
      ["reward", "save"].includes(request.method) ? 29000 : 6000,
    );
    return counterSyntax.fields(result, (text) => {
      try {
        return counterSyntax.display(text);
      } catch {
        // Keep unsupported saved text available for correction; Save reports its error.
        return text;
      }
    });
  }
  const routes = {
    "twitch.connection.read.v1/status": ["status", 1500],
    "twitch.oauth.admin.v1/configure": ["configure", 1500],
    "twitch.monitor.admin.v1/configure": ["configure-monitor", 1500],
    "twitch.oauth.admin.v1/clear": ["clear-client-id", 1500],
    "twitch.oauth.admin.v1/begin": ["begin", 6000],
    "twitch.oauth.admin.v1/poll": ["poll", 6000],
    "twitch.oauth.admin.v1/disconnect": ["disconnect", 1500],
    "twitch.rewards.read.v1/inspect": ["inspect-reward", 6000],
    "twitch.rewards.catalog.v1/list": ["list-rewards", 6000],
    "twitch.rewards.admin.v1/create": ["create-reward", 6000],
    "twitch.redemptions.v1/settle": ["settle", 6000],
    "twitch.redemptions.v1/review": ["review-transactions", 1500],
    "twitch.redemptions.v1/reconcile": ["reconcile-transaction", 29000],
    "twitch.chat.send.v1/send": ["send-chat", 6000],
  };
  const route = routes[`${request.capability}/${request.method}`];
  if (!route) throw new Error("method_unavailable");
  return host(route[0], request.payload, route[1]);
}

async function deactivate() {
  context = null;
}

module.exports = { activate, handleRequest, deactivate };
