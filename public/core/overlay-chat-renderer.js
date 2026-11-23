/** Render Twitch and independently enabled provider cosmetics with safe text fallbacks. */
(function (root) {
  const providerFields = {
    sevenTv: "showSevenTvEmotes",
    betterTtv: "showBetterTtvEmotes",
    frankerFaceZ: "showFrankerFaceZEmotes",
  };
  const assetUrls = {
    sevenTv: /^https:\/\/cdn\.7tv\.app\/emote\/[a-z0-9]{24,32}\/2x\.webp$/i,
    betterTtv: /^https:\/\/cdn\.betterttv\.net\/emote\/[a-f0-9]{24}\/2x$/i,
    frankerFaceZ: /^https:\/\/cdn\.frankerfacez\.com\/emote\/\d+\/(?:animated\/)?[a-z\d.]+$/i,
  };
  const badgeUrl = /^https:\/\/static-cdn\.jtvnw\.net\/badges\/v1\/[a-z0-9-]+\/[123]$/i;

  function image(kind, name, src) {
    const img = document.createElement("img");
    img.className = kind;
    img.alt = name;
    img.title = name;
    img.referrerPolicy = "no-referrer";
    img.src = src;
    img.addEventListener(
      "error",
      () => (kind === "chatBadge" ? img.remove() : img.replaceWith(name)),
      { once: true },
    );
    return img;
  }

  root.renderOverlayChat = (parent, row, widget) => {
    if (widget.showTimestamps && Number.isFinite(row.at)) {
      const time = document.createElement("time");
      time.className = "chatTimestamp";
      time.dateTime = new Date(row.at).toISOString();
      time.textContent =
        new Date(row.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " ";
      parent.append(time);
    }
    if (widget.showChatBadges) {
      for (const badge of row.badges || []) {
        if (badgeUrl.test(badge.url)) parent.append(image("chatBadge", badge.title, badge.url));
      }
    }
    const username = document.createElement("span");
    username.className = "chatUsername";
    username.textContent = row.name;
    if (widget.showChatColors && /^#[a-f0-9]{6}$/i.test(row.color || ""))
      username.style.color = row.color;
    parent.append(username, widget.chatLayout === "stacked" ? " " : ": ");
    const parts =
      row.fragments?.map((part) => part.text).join("") === row.message
        ? row.fragments
        : [{ text: row.message }];
    for (const part of parts) {
      const native = /^[a-z0-9_-]{1,100}$/i.test(part.emote || "");
      const external = part.emotes?.find(
        ({ provider, url }) => widget[providerFields[provider]] && assetUrls[provider]?.test(url),
      );
      const src = native
        ? widget.showTwitchEmotes &&
          "https://static-cdn.jtvnw.net/emoticons/v2/" + part.emote + "/default/dark/2.0"
        : external?.url;
      parent.append(src ? image("chatEmote", part.text, src) : part.text);
    }
  };
})(globalThis);
