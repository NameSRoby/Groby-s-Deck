/** Shared rendering for the editor preview and transparent OBS output. */
(function (root) {
  const queues = new WeakMap();
  const sessions = new WeakMap();
  const mediaKeys = new WeakMap();
  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const pad = (value) => String(value).padStart(2, "0");
  const duration = (value) => {
    const seconds = Math.max(0, Math.floor(value));
    return (
      pad(Math.floor(seconds / 3600)) +
      ":" +
      pad(Math.floor(seconds / 60) % 60) +
      ":" +
      pad(seconds % 60)
    );
  };
  const samples = () => ({
    sample: true,
    connected: true,
    music: {
      current: {
        title: "Midnight City",
        artists: ["The Midnight Sessions"],
        requester: "Demo viewer",
        durationMs: 240000,
        positionMs: 65000,
        observedAt: Date.now(),
        status: "playing",
      },
      next: [{ title: "Electric Skyline", artists: ["Demo Artist"] }],
    },
    twitch: {
      credits: {
        history: [{ kind: "subscribers", name: "DemoSubscriber", at: Date.now() }],
        followers: { ok: true, names: [{ name: "DemoFollower", at: Date.now() }] },
        subscribers: { ok: true, names: [{ name: "DemoSubscriber", at: null }] },
      },
      stream: {
        ok: true,
        live: true,
        title: "A cosy evening stream",
        category: "Music",
        viewers: 42,
        startedAt: Date.now() - 3600000,
      },
      followers: { ok: true, total: 1250, recent: [{ name: "DemoFollower" }] },
      subscribers: { ok: true, total: 85, points: 112 },
    },
    events: [
      {
        id: "sample-chat-1",
        sequence: 2,
        name: "DemoChatter",
        color: "#c9a8ff",
        message: "Hello! Love this song.",
        type: "channel.chat.message",
        at: Date.now(),
      },
      {
        id: "sample",
        sequence: 1,
        name: "DemoViewer",
        message: "followed",
        type: "channel.follow",
        at: Date.now(),
      },
    ],
    poll: {
      title: "What should we play?",
      choices: [
        { title: "Adventure", votes: 12 },
        { title: "Music", votes: 8 },
      ],
    },
    hype: { level: 2, total: 70, goal: 100 },
  });
  function content(w, data, now) {
    if (w.type === "alerts" && root.OverlayAlertRenderer)
      return root.OverlayAlertRenderer.content(w, data.events?.[0]);
    const extra = root.OverlayExtraRenderer?.render(w, data, now);
    if (extra) return extra;
    const body = el("div"),
      stream = data.twitch?.stream,
      music = data.music;
    const label = (value) => {
      const words = el("span", w.label ? w.label + " " + value : value);
      words.className = "itemText";
      body.append(words);
    };
    if (w.type === "credits" && root.renderOverlayCredits)
      body.append(root.renderOverlayCredits(w, data, now));
    else if (["slideshow", "rotating-text"].includes(w.type)) {
      const index = Math.floor(now / (w.rotateEvery * 1000)) % (w.items.length || 1),
        value = w.items[index];
      if (value && w.type === "rotating-text") label(value);
      else if (value) {
        const video = /\.(mp4|webm)$/i.test(new URL(value, location.href).pathname),
          media = el(video ? "video" : "img");
        media.src = value;
        media.style.objectFit = w.fit;
        if (video) {
          media.autoplay = true;
          media.loop = true;
          media.muted = true;
          media.playsInline = true;
        } else media.alt = w.name;
        body.append(media);
      }
    } else if (w.type === "text") label(w.text);
    else if (w.type === "shape") body.className = "shapeBody";
    else if (["image", "video"].includes(w.type)) {
      if (w.url) {
        const media = el(w.type === "image" ? "img" : "video");
        media.src = w.url;
        media.style.objectFit = w.fit;
        if (w.type === "video") {
          media.autoplay = true;
          media.loop = w.loop;
          media.muted = true;
          media.playsInline = true;
          media.preload = "metadata";
        } else media.alt = w.name;
        body.append(media);
      }
    } else if (w.type === "clock")
      label(new Date(now).toLocaleTimeString([], { timeZone: w.timezone }));
    else if (w.type === "countdown")
      label(
        duration(
          w.countdownPaused ? w.pausedSeconds : w.endsAt ? (w.endsAt - now) / 1000 : w.duration,
        ),
      );
    else if (w.type === "now-playing") {
      if (music?.current) {
        body.append(
          el("strong", music.current.title),
          el("small", (music.current.artists || []).join(", ")),
        );
        if (music.current.requester)
          body.append(el("small", "Requested by " + music.current.requester));
      }
    } else if (w.type === "queue") {
      (music?.next || []).slice(0, w.maxItems).forEach((track, index) => {
        const item = el("div"),
          words = el("span", index + 1 + ". " + track.title);
        words.className = "itemText";
        item.append(words);
        item.className = "overlayItem";
        item.dataset.itemKey = String(index) + ":" + track.title;
        body.append(item);
      });
    } else if (["title", "category", "viewers", "uptime"].includes(w.type)) {
      if (stream?.ok)
        label(
          stream.live
            ? w.type === "uptime"
              ? duration((now - stream.startedAt) / 1000)
              : (stream[w.type] ?? "")
            : "Offline",
        );
    } else if (["followers", "latest-follower", "subscribers", "sub-points"].includes(w.type)) {
      const source = data.twitch?.[w.type.includes("follow") ? "followers" : "subscribers"];
      if (source?.ok)
        label(
          w.type === "latest-follower"
            ? source.recent?.[0]?.name || ""
            : w.type === "sub-points"
              ? source.points
              : source.total,
        );
    } else if (["alerts", "activity", "chat"].includes(w.type)) {
      let rows = (data.events || []).filter((row) =>
        w.type === "chat" ? row.type === "channel.chat.message" : w.events.includes(row.type),
      );
      if (w.type === "chat")
        rows = rows.filter(
          (row) =>
            !(w.hideBotMessages && row.isAppMessage) &&
            !(w.hideCommands && /^\s*!/.test(row.message || "")) &&
            !(w.hiddenAccounts || []).includes((row.login || row.name || "").toLowerCase()),
        );
      if (w.type === "alerts")
        rows = rows.filter((row) => now - row.at < w.lifetime * 1000).slice(-1);
      else if (w.type === "chat" && w.chatMode !== "scroll")
        rows = rows.filter((row) => now - row.at < w.lifetime * 1000);
      rows.slice(-w.maxItems).forEach((row) => {
        const text =
          w.type === "alerts"
            ? w.text.replace(/\$\{(name|message|amount)\}/g, (_match, key) =>
                String(row[key] ?? ""),
              )
            : row.name + " " + row.message;
        const item = el("div");
        const words = el("span", w.type === "chat" ? undefined : text);
        if (w.type === "chat") root.renderOverlayChat(words, row, w);
        words.className = "itemText";
        item.append(words);
        item.className = "overlayItem";
        item.dataset.itemKey = row.id;
        body.append(item);
      });
    } else if (
      w.type === "poll" &&
      data.poll &&
      (!data.poll.ended || now - data.poll.at < w.lingerSeconds * 1000)
    ) {
      body.append(el("strong", data.poll.title));
      const total = data.poll.choices.reduce((sum, row) => sum + row.votes, 0);
      data.poll.choices.forEach((row) => {
        body.append(el("div", row.title + " - " + row.votes));
        const bar = el("progress");
        bar.max = total || 1;
        bar.value = row.votes;
        body.append(bar);
      });
    } else if (
      w.type === "hype-train" &&
      data.hype &&
      (!data.hype.ended || now - data.hype.at < w.lingerSeconds * 1000)
    ) {
      label("Hype Train - Level " + data.hype.level);
      const bar = el("progress");
      bar.max = data.hype.goal || 1;
      bar.value = data.hype.total;
      body.append(bar);
    }
    return body;
  }
  function custom(w) {
    const frame = el("iframe");
    frame.title = w.name;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.referrerPolicy = "no-referrer";
    let fields = {};
    try {
      fields = JSON.parse(w.fields);
    } catch {
      /* Inspector validation provides the error. */
    }
    const json = JSON.stringify(fields).replace(/</g, "\\u003c");
    frame.srcdoc =
      "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src https: data:; media-src https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'\"><style>html,body{margin:0;background:transparent;overflow:hidden}" +
      w.css +
      "</style>" +
      w.html +
      "<script>window.GrobyDeckOverlay={fields:" +
      json +
      ',data:{}};addEventListener("message",e=>{if(e.source!==parent||e.data?.type!=="groby-overlay-data")return;GrobyDeckOverlay.data=e.data.value;dispatchEvent(new CustomEvent("overlay-data",{detail:e.data.value}));});<\/script><script>' +
      w.js.replace(/<\/script/gi, "<\\/script") +
      "<\/script>";
    return frame;
  }
  function render(host, doc, data = {}, options = {}) {
    const now = options.now ?? Date.now();
    if (data.session && sessions.get(host) !== data.session) {
      queues.delete(host);
      sessions.set(host, data.session);
    }
    if (!queues.has(host)) queues.set(host, new Map());
    const queue = queues.get(host);
    for (const id of queue.keys())
      if (!doc.widgets.some((w) => w.id === id && w.type === "alerts")) queue.delete(id);
    host.style.width = doc.width + "px";
    host.style.height = doc.height + "px";
    host.dataset.reducedMotion = String(
      doc.motion === "reduced" ||
        (doc.motion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches),
    );
    const widgets = new Set(doc.widgets.map((widget) => widget.id));
    const layers = new Map();
    for (const node of host.children) layers.set(node.dataset.widgetId, node);
    for (const [id, node] of layers)
      if (!widgets.has(id)) {
        root.OverlayAlertRenderer?.stop(node);
        node.remove();
      }
    doc.widgets.forEach((w, index) => {
      let node = layers.get(w.id);
      if (!node) {
        node = el("div");
        node.className = "overlayLayer";
        node.dataset.widgetId = w.id;
        const initial = el("div");
        initial.className = "widgetBody";
        node.append(initial);
        host.append(node);
      }
      Object.assign(node.style, {
        left: w.x + "px",
        top: w.y + "px",
        width: w.width + "px",
        height: w.height + "px",
        transform: "rotate(" + w.rotation + "deg)",
        opacity: String(w.opacity / 100),
        display: w.visible ? "" : "none",
        zIndex: String(index),
        color: w.color,
        fontSize: w.fontSize + "px",
        fontFamily: root.OverlayFonts.family(w),
        fontWeight: w.bold ? "700" : "400",
        lineHeight: String(w.lineHeight),
        letterSpacing: w.letterSpacing + "px",
        textAlign: w.align,
        backgroundColor:
          w.background +
          Math.round(w.backgroundOpacity * 2.55)
            .toString(16)
            .padStart(2, "0"),
        borderRadius: w.radius + "px",
      });
      node.dataset.locked = String(w.locked);
      root.OverlayTextStyle.apply(node, w);
      node.dataset.chatLayout = w.chatLayout;
      node.dataset.simpleText = String(root.OverlayTextStyle.simple.has(w.type));
      node.dataset.listLayout = w.listLayout;
      root.OverlayMotion?.apply(node, w);
      if (!w.visible) {
        root.OverlayAlertRenderer?.stop(node);
        return;
      }
      const body = node.firstElementChild;
      // An unchanged media widget keeps its element and playback across live feed ticks.
      if (w.type === "image" || w.type === "video") {
        const mediaSetting = w.type === "image" ? w.name : w.loop;
        const key = JSON.stringify([w.type, w.url, w.fit, mediaSetting]);
        if (mediaKeys.get(node) !== key) {
          const next = content(w, data, now);
          next.classList.add("widgetBody");
          body.replaceWith(next);
          mediaKeys.set(node, key);
          delete node.contentSignature;
        }
        delete node.dataset.empty;
        return;
      }
      mediaKeys.delete(node);
      if (w.type === "custom") {
        const signature = JSON.stringify([w.html, w.css, w.js, w.fields]);
        if (node.contentSignature !== signature) {
          body.replaceChildren(custom(w));
          node.contentSignature = signature;
        }
        const frame = body.firstElementChild;
        frame.onload = () =>
          frame.contentWindow?.postMessage({ type: "groby-overlay-data", value: data }, "*");
        frame.contentWindow?.postMessage({ type: "groby-overlay-data", value: data }, "*");
        return;
      }
      let view = { ...data, game: data.games?.[doc.id]?.[w.id] };
      if (w.type === "alerts") {
        if (!queue.has(w.id)) queue.set(w.id, { seen: [], pending: [], current: null, started: 0 });
        const state = queue.get(w.id);
        for (const row of data.events || []) {
          if (state.seen.includes(row.id)) continue;
          state.seen.push(row.id);
          if (w.events.includes(row.type) && now - row.at < 30000) state.pending.push(row);
        }
        state.seen = state.seen.slice(-100);
        state.pending = state.pending.slice(0, 20);
        const duration = state.current
          ? root.OverlayAlertRules.select(w, state.current).lifetime
          : w.lifetime;
        if (state.current && now - state.started >= duration * 1000) state.current = null;
        if (!state.current && state.pending.length) {
          state.current = state.pending.shift();
          state.started = now;
        }
        view = { ...data, events: state.current ? [{ ...state.current, at: state.started }] : [] };
      }
      const next = content(w, view, now);
      next.classList.add("widgetBody");
      const hasContent = Boolean(
        next.textContent.trim() || next.querySelector("img,video,iframe,canvas,svg"),
      );
      const chatIds =
        w.type === "chat"
          ? new Set(
              (view.events || [])
                .filter((row) => row.type === "channel.chat.message")
                .map((row) => row.id),
            )
          : null;
      const signature = next.innerHTML;
      // Expiring messages can fade. Moderated messages and messages from a closed session disappear.
      if (chatIds)
        for (const row of [...body.children]) {
          if (!chatIds.has(row.dataset.itemKey)) row.remove();
        }
      if (node.contentSignature !== signature) {
        if (["chat", "activity", "queue", "alerts"].includes(w.type) && root.OverlayMotion) {
          body.className = next.className;
          root.OverlayMotion.reconcile(body, next, w);
        } else if (
          [
            "clock",
            "countdown",
            "uptime",
            "goal",
            "poll",
            "hype-train",
            "now-playing",
            "wheel",
            "credits",
          ].includes(w.type)
        ) {
          root.OverlayMotion.syncBody(body, next);
        } else body.replaceWith(next);
        node.contentSignature = signature;
      }
      // Viewport direction/speed/size can change without changing innerHTML.
      root.OverlayMotion.syncAttributes(node.firstElementChild, next);
      root.OverlayExtraRenderer?.motion(node, w, view, now);
      if (w.type === "alerts")
        root.OverlayAlertRenderer?.sync(
          node,
          w,
          view.events?.[0],
          options.preview
            ? options.audio === true && (view.sample === true || view.events?.[0]?.sample === true)
            : !options.editor,
        );
      if (options.editor && !hasContent && !["shape", "image", "video"].includes(w.type))
        node.dataset.empty = emptyMessage(w, data);
      else delete node.dataset.empty;
    });
  }
  function emptyMessage(w, data) {
    const source = w.type === "chat" ? "chat" : w.type === "credits" ? w.creditsSource : "";
    if (["chat", "subscribers", "followers"].includes(source) && data.previewAccess) {
      if (!data.connected) return w.name + " - connect Twitch for live data.";
      if (!data.previewAccess[source]) {
        const feature = {
          chat: "Read chat commands",
          subscribers: "Subscribers",
          followers: "Followers",
        };
        return w.name + " - enable " + feature[source] + " in Twitch Connection.";
      }
      if (source === "chat") return w.name + " - waiting for chat messages.";
      const credits = data.twitch?.credits?.[source];
      if (credits?.ok) return w.name + " - no matching " + source + " in this period.";
      if (credits) {
        const messages = {
          401: "reconnect Twitch to load " + source + ".",
          403: "Twitch denied access to " + source + ". Check Twitch permissions.",
          429: "Twitch rate limit reached. Retrying shortly.",
        };
        return (
          w.name +
          " - " +
          (messages[credits.error === "twitch_reauthorization_required" ? 401 : credits.status] ||
            "Twitch could not load " +
              source +
              (credits.status ? " (HTTP " + credits.status + ")" : "") +
              ". Retrying shortly.")
        );
      }
      return w.name + " - loading " + source + " from Twitch.";
    }
    if (w.type === "goal" && w.goalSource === "counter")
      return w.name + " - connect Twitch and select an automation counter, or use Sample data.";
    return w.name + " - waiting for data. Use Test widgets to preview.";
  }
  root.OverlayRenderer = { render, samples };
})(globalThis);
