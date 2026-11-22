/** Live chat uses EventSource. The normal overlay snapshot also supports polling fallback. */
globalThis.createOverlayChatFeed = (draw) => {
  let stream;
  let latest;
  function stop() {
    stream?.close();
    stream = latest = undefined;
  }
  return {
    sync(enabled) {
      if (!enabled) {
        stop();
        return;
      }
      if (stream || typeof EventSource !== "function") return;
      stream = new EventSource("/api/stream-overlays/chat-feed");
      stream.onmessage = ({ data }) => {
        const frame = JSON.parse(data);
        if (!Array.isArray(frame.rows)) return;
        latest = frame;
        draw();
      };
    },
    merge(data) {
      if (!latest || (latest.session === data.session && latest.version < data.chatVersion))
        return data;
      if (stream.readyState !== EventSource.OPEN && latest.session !== data.session && data.session)
        return data;
      return {
        ...data,
        events: [
          ...(data.events || []).filter((row) => row.type !== "channel.chat.message"),
          ...latest.rows,
        ],
      };
    },
    stop,
  };
};
