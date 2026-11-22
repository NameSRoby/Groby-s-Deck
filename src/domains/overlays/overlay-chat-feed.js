/** Local overlay chat subscribers share one serialized frame per batch. */
module.exports = ({ snapshot }) => {
  const clients = new Map();
  let timer;
  let version = 0;
  const frame = () => ({ version, ...snapshot() });
  const event = () => "data: " + JSON.stringify(frame()) + "\n\n";
  function write(client, message) {
    const state = clients.get(client);
    if (!state) return;
    if (!client.writableNeedDrain) {
      client.write(message);
    } else if (!state.waiting) {
      state.waiting = true;
      client.once("drain", () => {
        state.waiting = false;
        write(client, event());
      });
    }
  }
  return {
    frame,
    changed() {
      version++;
      if (!clients.size || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        const message = event();
        for (const client of clients.keys()) write(client, message);
      }, 30);
      timer.unref?.();
    },
    subscribe(client) {
      if (clients.size >= 12) return false;
      client.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      client.setHeader("X-Accel-Buffering", "no");
      client.flushHeaders();
      const keepAlive = setInterval(() => {
        if (!client.writableNeedDrain) write(client, ": keepalive\n\n");
      }, 15000);
      keepAlive.unref?.();
      clients.set(client, { keepAlive, waiting: false });
      client.once("close", () => {
        clearInterval(keepAlive);
        clients.delete(client);
      });
      write(client, event());
      return true;
    },
    close() {
      clearTimeout(timer);
      for (const [client, { keepAlive }] of clients) {
        clearInterval(keepAlive);
        client.end();
      }
      clients.clear();
    },
  };
};
