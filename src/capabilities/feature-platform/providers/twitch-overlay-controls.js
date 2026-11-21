/** Overlay readers share the provider's authorization and refresh boundary. */
module.exports = ({ api, withAuthorization }) => ({
  overlaySupporters: (input) =>
    withAuthorization(
      (current) => api.overlaySupporters({ ...input, credentials: current }),
      [input?.kind === "subscribers" ? "channel:read:subscriptions" : "moderator:read:followers"],
    ),
  overlayPrediction: () =>
    withAuthorization(
      (current) => api.overlayPrediction({ credentials: current }),
      ["channel:read:predictions"],
    ),
  overlayRedemptions: (input) =>
    withAuthorization(
      (current) => api.overlayRedemptions({ ...input, credentials: current }),
      ["channel:manage:redemptions"],
    ),
});
