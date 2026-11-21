/** An undeliverable provider result is unconfirmed, never a reason to repeat a write. */
module.exports = (send, replyTo, result, now) => {
  const base = { protocolVersion: 1, type: "response", sentAt: Number(now()), replyTo };
  if (!result?.ok)
    return send({
      ...base,
      ok: false,
      error: result?.error || {
        code: "broker_failed",
        message: "Capability broker rejected the request",
        retryable: false,
      },
    });
  if (send({ ...base, ok: true, payload: result.value })) return true;
  return send({
    ...base,
    ok: false,
    error: {
      code: "broker_response_unconfirmed",
      message:
        "Capability response exceeded its data limits; do not repeat a write without checking its result",
      retryable: false,
    },
  });
};
