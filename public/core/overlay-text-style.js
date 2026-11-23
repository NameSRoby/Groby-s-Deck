/** Broadcast typography stays code-native and shared between the designer and OBS. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OverlayTextStyle = factory();
})(globalThis, function () {
  const base = {
    font: "system",
    color: "#ffffff",
    backgroundOpacity: 0,
    radius: 0,
    lineHeight: 1.2,
    letterSpacing: 0,
    textEffect: "shadow",
    shadowColor: "#000000",
    shadowBlur: 8,
    shadowOpacity: 85,
    shadowX: 0,
    shadowY: 2,
    textCase: "none",
    accentStyle: "none",
    paddingX: 16,
    paddingY: 10,
    verticalAlign: "middle",
    align: "left",
    bold: true,
  };
  const defaults = {
    ...base,
    fontSize: 28,
    bold: false,
    lineHeight: 1.35,
    paddingX: 8,
    paddingY: 8,
    verticalAlign: "top",
    textEffect: "none",
  };
  const looks = [
    ["Broadcast headline", { fontSize: 56, letterSpacing: -1, shadowBlur: 12 }],
    ["Clean headline", { fontSize: 48, letterSpacing: -0.5 }],
    [
      "Lower third",
      {
        fontSize: 30,
        background: "#0b1220",
        backgroundOpacity: 94,
        accentStyle: "left",
        accentColor: "#38bdf8",
        accentWidth: 5,
        paddingX: 22,
        paddingY: 12,
        textEffect: "none",
      },
    ],
    [
      "Caption strip",
      {
        fontSize: 34,
        background: "#080b10",
        backgroundOpacity: 94,
        bold: false,
        align: "center",
        paddingX: 22,
        paddingY: 10,
        textEffect: "none",
      },
    ],
    ["Readable subtitle", { fontSize: 28, bold: false, lineHeight: 1.35, shadowBlur: 6 }],
    [
      "Creator tag",
      {
        fontSize: 28,
        background: "#f8fafc",
        backgroundOpacity: 98,
        color: "#0f172a",
        accentStyle: "left",
        accentColor: "#f43f5e",
        accentWidth: 5,
        radius: 6,
        paddingX: 18,
        textEffect: "none",
      },
    ],
    [
      "Section label",
      {
        fontSize: 23,
        textCase: "uppercase",
        letterSpacing: 2.2,
        accentStyle: "bottom",
        accentColor: "#a78bfa",
        accentWidth: 3,
        paddingX: 12,
        paddingY: 8,
      },
    ],
    [
      "Scoreboard",
      {
        fontSize: 36,
        font: "mono",
        background: "#111827",
        backgroundOpacity: 96,
        accentStyle: "bottom",
        accentColor: "#34d399",
        accentWidth: 3,
        align: "center",
        textEffect: "none",
      },
    ],
    [
      "Outlined stream text",
      {
        fontSize: 40,
        textEffect: "outline",
        outlineWidth: 2,
        outlineColor: "#080b10",
        lineHeight: 1.25,
      },
    ],
    [
      "Soft neon accent",
      {
        fontSize: 38,
        color: "#e0f2fe",
        textEffect: "glow",
        shadowColor: "#0ea5e9",
        shadowBlur: 14,
        shadowOpacity: 65,
        shadowY: 0,
      },
    ],
  ].map(([name, values]) => [name, { ...base, ...values }]);
  const simple = new Set([
    "text",
    "rotating-text",
    "title",
    "category",
    "clock",
    "countdown",
    "uptime",
    "viewers",
    "followers",
    "subscribers",
    "sub-points",
  ]);
  function styles(w) {
    const shadow =
      w.shadowColor +
      Math.round(w.shadowOpacity * 2.55)
        .toString(16)
        .padStart(2, "0");
    return {
      textShadow:
        w.textEffect === "shadow" || w.textEffect === "glow"
          ? `${w.shadowX}px ${w.shadowY}px ${w.shadowBlur}px ${shadow}`
          : "none",
      webkitTextStroke:
        w.textEffect === "outline" ? `${w.outlineWidth}px ${w.outlineColor}` : "0px transparent",
      paintOrder: "stroke fill",
      textTransform: w.textCase,
      borderLeft:
        w.accentStyle === "left"
          ? `${w.accentWidth}px solid ${w.accentColor}`
          : "0px solid transparent",
      borderBottom:
        w.accentStyle === "bottom"
          ? `${w.accentWidth}px solid ${w.accentColor}`
          : "0px solid transparent",
      "--widget-padding-x": w.paddingX + "px",
      "--widget-padding-y": w.paddingY + "px",
      "--text-vertical": { top: "flex-start", middle: "center", bottom: "flex-end" }[
        w.verticalAlign
      ],
      "--row-gap": w.rowGap + "px",
      "--value-size": w.valueSize + "%",
    };
  }
  function apply(node, w) {
    for (const [key, value] of Object.entries(styles(w)))
      if (key.startsWith("--")) node.style.setProperty(key, value);
      else node.style[key] = value;
  }
  function controls(a, w, { num, select, field }) {
    select("Letter case", "textCase", [
      ["none", "As typed"],
      ["uppercase", "UPPERCASE"],
      ["lowercase", "lowercase"],
      ["capitalize", "Title case"],
    ]);
    num("Horizontal padding (px)", "paddingX", 0, 120);
    num("Vertical padding (px)", "paddingY", 0, 120);
    if (simple.has(w.type))
      select("Vertical text alignment", "verticalAlign", [
        ["top", "Top"],
        ["middle", "Middle"],
        ["bottom", "Bottom"],
      ]);
    if (["shadow", "glow"].includes(w.textEffect)) {
      field("Shadow / glow color", "shadowColor", "color");
      num("Shadow / glow opacity (%)", "shadowOpacity", 0, 100);
      num("Shadow / glow blur (px)", "shadowBlur", 0, 40);
      num("Shadow horizontal offset (px)", "shadowX", -20, 20);
      num("Shadow vertical offset (px)", "shadowY", -20, 20);
    }
    if (w.textEffect === "outline") {
      field("Outline color", "outlineColor", "color");
      num("Outline width (px)", "outlineWidth", 0.5, 6).step = "0.5";
    }
    select("Accent edge", "accentStyle", [
      ["none", "None"],
      ["left", "Left edge"],
      ["bottom", "Bottom edge"],
    ]);
    if (w.accentStyle !== "none") {
      field("Accent color", "accentColor", "color");
      num("Accent width (px)", "accentWidth", 1, 16);
    }
    if (["leaderboard", "player-card", "redemptions", "prediction", "chat-vote"].includes(w.type)) {
      num("Spacing between rows (px)", "rowGap", 0, 80);
      num("Value text size (%)", "valueSize", 40, 100);
    }
    if (w.type === "leaderboard")
      select("Name and value layout", "listLayout", [
        ["stacked", "Value below name"],
        ["inline", "Name and value on one line"],
      ]);
    if (w.type === "credits") {
      num("Spacing between names (px)", "creditGap", 0, 240);
      field("Separator between names (optional)", "creditSeparator", "text", { maxLength: 8 });
    }
  }
  return { looks, defaults, simple, styles, apply, controls };
});
