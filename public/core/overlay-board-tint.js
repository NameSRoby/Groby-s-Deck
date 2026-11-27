/** Tint the image in place or make a color layer shaped by its alpha channel. */
globalThis.boardImageTint = (style, colorLayer = false) => {
  if (
    style?.tintTarget !== "image" ||
    !["color", "both"].includes(style.mode) ||
    !/^#[\da-f]{6}$/i.test(style.color)
  )
    return "";
  const opacity = Math.max(0, Math.min(100, Number(style.opacity))) / 100;
  if (!opacity) return "";
  const channels = ["R", "G", "B"].map((channel, index) => {
    const component = parseInt(style.color.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    const slope = colorLayer ? 0 : 1 - opacity;
    const intercept = colorLayer ? component : component * opacity;
    return `<feFunc${channel} type="linear" slope="${slope}" intercept="${intercept}"/>`;
  });
  if (colorLayer) channels.push(`<feFuncA type="linear" slope="${opacity}"/>`);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><filter id="tint" color-interpolation-filters="sRGB">' +
    "<feComponentTransfer>" +
    channels.join("") +
    "</feComponentTransfer></filter></svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}#tint")`;
};
