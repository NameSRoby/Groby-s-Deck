/** Native delivery must not erase a viewer's pending-request quota. Hold automatic
 * delivery while reading receipts and admitting requests so a handoff cannot slip
 * between the native snapshot and the local count. Never count personal tracks.
 */
module.exports = function nativeAdmission({ queue, provider, waitForDelivery, isSelected }) {
  let checking = 0;
  return {
    busy: () => checking > 0,
    async submit(payload) {
      checking++;
      try {
        await waitForDelivery();
        const status = await provider("status", null);
        if (status?.ok === false || !Array.isArray(status?.handoffs))
          return { ok: false, code: "rejected", reason: "request_limits_unavailable" };
        if (!(await isSelected()))
          return { ok: false, code: "rejected", reason: "player_inactive" };
        const pending = status.handoffs.filter((row) =>
          ["appended", "pending", "unknown"].includes(row.phase),
        );
        return queue.submit(payload, { pending });
      } catch {
        return { ok: false, code: "rejected", reason: "request_limits_unavailable" };
      } finally {
        checking--;
      }
    },
  };
};
