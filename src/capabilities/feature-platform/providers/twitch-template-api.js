/** Read public channel data through the credential owner, never arbitrary URLs. */
module.exports = ({ request, text, base }) => ({
  async templateChannel(input) {
    const c = input.credentials || {},
      login = String(input.login || "")
        .replace(/^@/, "")
        .toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(login)) return { ok: false, error: "twitch_username_invalid" };
    const headers = { Authorization: "Bearer " + c.accessToken, "Client-Id": c.clientId };
    const user = await request(base + "/users?" + new URLSearchParams({ login }), { headers });
    const id = user.body?.data?.[0]?.id;
    if (!user.ok || !/^\d+$/.test(id || ""))
      return { ok: false, error: "twitch_channel_not_found" };
    const [channel, stream] = await Promise.all([
      request(base + "/channels?" + new URLSearchParams({ broadcaster_id: id }), { headers }),
      request(base + "/streams?" + new URLSearchParams({ user_id: id }), { headers }),
    ]);
    if (!channel.ok || !stream.ok) return { ok: false, error: "twitch_channel_lookup_failed" };
    const row = channel.body?.data?.[0];
    if (!row) return { ok: false, error: "twitch_channel_not_found" };
    const live = stream.body?.data?.[0];
    return {
      ok: true,
      login,
      game: text(row.game_name, 150),
      title: text(row.title, 200),
      live: !!live,
      viewers: live?.viewer_count || 0,
      startedAt: live ? Date.parse(live.started_at) : 0,
    };
  },
});
