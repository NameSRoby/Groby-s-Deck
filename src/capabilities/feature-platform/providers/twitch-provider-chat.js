/** Authorized chat output and trigger admission share the same echo owner. */
module.exports = ({
  api,
  now,
  options,
  vaultPath,
  withAuthorization,
  canReceive,
  monitorConfig,
}) => {
  const path = require("node:path"),
    outgoing = require("./twitch-outgoing-chat")(now, {
      file:
        options.outgoingChatPath ||
        (vaultPath ? path.join(path.dirname(vaultPath), "twitch-outgoing-chat.json") : ""),
    });
  return {
    send(input) {
      return withAuthorization(
        (credentials) =>
          outgoing.send(credentials.userId, input, () => api.sendChat({ ...input, credentials })),
        ["user:write:chat"],
      );
    },
    async receive(event, chatOrder, presentationOnly = false) {
      if (!canReceive()) return;
      const isAppMessage = await outgoing.owns(event);
      if (!canReceive()) return;
      await options.onChatPresentation?.(event, { isAppMessage, chatOrder });
      if (!presentationOnly && !isAppMessage) return options.onChat?.(event, monitorConfig());
    },
    track: outgoing.send,
    close: outgoing.close,
  };
};
