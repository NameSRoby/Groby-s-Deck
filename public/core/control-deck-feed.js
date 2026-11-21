/** A visible deck shares one Core status feed with other local/LAN screens. */
export function createDeckFeed({ request, visible, receive, offline }) {
  let source,
    timer,
    flight,
    instance,
    version = -1,
    connected = false,
    streamHasState = false,
    liveSequence = 0,
    closed = false;
  const validFrame = (frame) => frame && Number.isSafeInteger(frame.version) && frame.value;
  function accept(frame) {
    if (!validFrame(frame)) return;
    if (
      frame.instance === instance &&
      (frame.version < version || (frame.version === version && connected))
    )
      return;
    instance = frame.instance;
    version = frame.version;
    connected = true;
    receive(frame.value);
  }
  function stopStream() {
    clearTimeout(timer);
    timer = null;
    source?.close();
    source = null;
    streamHasState = false;
  }
  function disconnect() {
    stopStream();
    // Overview and initial boot also use the state endpoint to load deck settings.
    if (closed || !flight?.forced) flight = null;
  }
  function markOffline() {
    connected = false;
    offline();
  }
  function connect() {
    if (closed || !visible()) {
      disconnect();
      return;
    }
    if (source || typeof EventSource === "undefined") return;
    clearTimeout(timer);
    timer = null;
    const stream = new EventSource("/api/control-deck/events");
    source = stream;
    stream.onmessage = (event) => {
      if (source !== stream || !visible()) return;
      try {
        const frame = JSON.parse(event.data);
        if (!validFrame(frame)) return;
        streamHasState = true;
        liveSequence++;
        accept(frame);
      } catch {}
    };
    stream.onerror = () => {
      if (source !== stream) return;
      if (!visible()) return disconnect();
      stopStream();
      markOffline();
      timer = setTimeout(() => void refresh(), 1500);
    };
  }
  async function refresh(force = false) {
    const shown = visible();
    if (closed || (!force && !shown)) {
      disconnect();
      return;
    }
    if (shown) connect();
    if (flight) {
      if (force) flight.forced = true;
      return flight.promise;
    }
    clearTimeout(timer);
    timer = null;
    const seenLiveSequence = liveSequence;
    const pending = { forced: force };
    const isCurrent = () => flight === pending && (pending.forced || visible());
    pending.promise = request("/api/control-deck/state")
      .then((frame) => {
        if (isCurrent() && (liveSequence === seenLiveSequence || frame?.instance === instance))
          accept(frame);
      })
      .catch(() => {
        if (isCurrent() && !streamHasState) markOffline();
      })
      .finally(() => {
        if (flight !== pending) return;
        flight = null;
        if (!source && !timer && visible() && !closed)
          timer = setTimeout(() => void refresh(), 2000);
      });
    flight = pending;
    return pending.promise;
  }
  return {
    refresh,
    sync: connect,
    close() {
      closed = true;
      disconnect();
    },
    resume() {
      closed = false;
      connect();
    },
  };
}
