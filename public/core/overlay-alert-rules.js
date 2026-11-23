/** Deterministic alert selection shared by validation, preview and OBS. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OverlayAlertRules = factory();
})(globalThis, function () {
  const events = [
    "channel.follow",
    "channel.subscribe",
    "channel.subscription.message",
    "channel.subscription.gift",
    "channel.cheer",
    "channel.raid",
    "channel.charity_campaign.donate",
  ];
  const url = (value) => {
    const s = String(value || "").slice(0, 2048);
    if (
      /^\/api\/stream-overlays\/media\/[a-f0-9-]{36}\.(png|jpg|webp|gif|mp4|webm|mp3|wav|ogg|m4a)$/.test(
        s,
      )
    )
      return s;
    try {
      const u = new URL(s);
      return u.protocol === "https:" && !u.username && !u.password ? u.href : "";
    } catch {
      return "";
    }
  };
  const n = (v, min, max, fallback) =>
    v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v))
      ? Math.min(max, Math.max(min, Number(v)))
      : fallback;
  const text = (v, max = 500) =>
    typeof v === "string" ? v.replace(/[\x00-\x1f]/g, " ").slice(0, max) : "";
  function settings(raw = {}) {
    return {
      mediaUrl: url(raw.mediaUrl),
      soundUrl: url(raw.soundUrl),
      mediaType: ["image", "video"].includes(raw.mediaType) ? raw.mediaType : "auto",
      mediaMuted: raw.mediaMuted !== false,
      volume: n(raw.volume, 0, 100, 70),
      layout: ["above", "beside", "background", "text"].includes(raw.layout) ? raw.layout : "above",
      text: text(raw.text, 2000),
      lifetime: n(raw.lifetime, 1, 300, 8),
      textDelay: n(raw.textDelay, 0, 30, 0),
      mediaFit: raw.mediaFit === "cover" ? "cover" : "contain",
    };
  }
  function variants(raw) {
    return (Array.isArray(raw) ? raw : []).slice(0, 32).map((row, index) => ({
      ...settings(row),
      id: text(row.id, 80) || "variant-" + index,
      name: text(row.name, 80) || "Variation " + (index + 1),
      enabled: row.enabled !== false,
      event: events.includes(row.event) ? row.event : "channel.cheer",
      minimum: n(row.minimum, 0, 1e9, 0),
      maximum: n(row.maximum, 0, 1e9, null),
      tier: ["1000", "2000", "3000"].includes(row.tier) ? row.tier : "",
      currency: /^[A-Z]{3}$/.test(row.currency || "") ? row.currency : "",
      priority: n(row.priority, 0, 100, 0),
    }));
  }
  function select(widget, event) {
    const matches = (widget.alertVariants || [])
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          row.enabled &&
          row.event === event.type &&
          Number(event.amount || 0) >= row.minimum &&
          (row.maximum === null || Number(event.amount || 0) <= row.maximum) &&
          (!row.tier || row.tier === event.tier) &&
          (!row.currency || row.currency === event.currency),
      );
    matches.sort(
      (a, b) =>
        b.row.priority - a.row.priority ||
        Number(b.row.maximum === b.row.minimum) - Number(a.row.maximum === a.row.minimum) ||
        Number(Boolean(b.row.tier)) - Number(Boolean(a.row.tier)) ||
        b.row.minimum - a.row.minimum ||
        a.index - b.index,
    );
    return (
      matches[0]?.row || {
        ...settings(widget.alert || {}),
        text: widget.text,
        lifetime: widget.lifetime,
      }
    );
  }
  function message(template, event) {
    return String(template || "${name} ${message}").replace(
      /\$\{(name|message|amount|tier|currency|months|viewers|bits|gifts)\}/g,
      (_, key) => String(event[key] ?? ""),
    );
  }
  return { events, settings, variants, select, message, url };
});
