/** CSS presentation and stable item reconciliation; no animation polling loop. */
(function (root) {
  const moves = new WeakMap();
  const reduced = (node) => node.closest("[data-reduced-motion]")?.dataset.reducedMotion === "true";
  function reconcile(body, next, w) {
    const previous = new Map([...body.children].map((row) => [row.dataset.itemKey, row]));
    const positions = new Map(
      [...body.children].filter((row) => !row.dataset.leaving).map((row) => [row, row.offsetTop]),
    );
    const wanted = new Map([...next.children].map((row) => [row.dataset.itemKey, row.innerHTML]));
    for (const item of [...body.children])
      if (wanted.get(item.dataset.itemKey) !== item.innerHTML && !item.dataset.leaving) {
        if (!w.exitAnimation || reduced(body)) item.remove();
        else {
          const top = item.offsetTop,
            left = item.offsetLeft,
            width = item.offsetWidth;
          Object.assign(item.style, {
            position: "absolute",
            top: top + "px",
            left: left + "px",
            width: width + "px",
          });
          item.dataset.leaving = "true";
          setTimeout(
            () => {
              if (item.dataset.leaving) item.remove();
            },
            Math.min(2000, w.animationMs || 350),
          );
        }
      }
    let position = [...body.children].find((row) => !row.dataset.leaving) || null;
    for (const item of [...next.children]) {
      const prior = previous.get(item.dataset.itemKey);
      const row = prior && prior.innerHTML === item.innerHTML ? prior : item;
      if (row.dataset.leaving) {
        row.removeAttribute("style");
        delete row.dataset.leaving;
      }
      if (row === position)
        position =
          [...body.children]
            .slice([...body.children].indexOf(row) + 1)
            .find((entry) => !entry.dataset.leaving) || null;
      else body.insertBefore(row, position);
    }
    if (!reduced(body))
      for (const row of body.children) {
        if (!positions.has(row) || row.dataset.leaving) continue;
        const delta = positions.get(row) - row.offsetTop;
        if (!delta) continue;
        moves.get(row)?.cancel();
        moves.set(
          row,
          row.animate([{ translate: "0 " + delta + "px" }, { translate: "0 0" }], {
            duration: w.animationMs || 350,
            easing: "cubic-bezier(.22,1,.36,1)",
          }),
        );
      }
  }

  function apply(node, w) {
    node.dataset.entrance = w.entrance || "none";
    node.dataset.motionTarget = w.motionTarget || "box";
    node.dataset.ambient = w.ambient || "none";
    node.dataset.widgetType = w.type;
    node.style.setProperty("--entrance-ms", (w.animationMs || 350) + "ms");
    node.style.setProperty("--ambient-seconds", (w.ambientSeconds || 6) + "s");
    node.style.setProperty(
      "--item-background",
      (w.itemBackground || "#17233b") +
        Math.round((w.itemOpacity || 0) * 2.55)
          .toString(16)
          .padStart(2, "0"),
    );
    node.style.setProperty("--item-radius", (w.itemRadius || 0) + "px");
    node.style.setProperty("--item-padding", (w.itemPadding || 0) + "px");
    node.style.setProperty("--item-gap", (w.itemGap || 0) + "px");
  }
  function syncAttributes(body, next) {
    for (const attribute of next.attributes)
      if (body.getAttribute(attribute.name) !== attribute.value)
        body.setAttribute(attribute.name, attribute.value);
  }
  function syncBody(body, next) {
    syncAttributes(body, next);
    if (!body.children.length && !next.children.length) {
      if (body.textContent !== next.textContent) body.textContent = next.textContent;
      return;
    }
    const old = [...body.children],
      fresh = [...next.children];
    if (
      old.length !== fresh.length ||
      !old.every((child, i) => child.tagName === fresh[i].tagName)
    ) {
      body.replaceChildren(...next.childNodes);
      return;
    }
    old.forEach((child, i) => {
      const updated = fresh[i];
      if (child.tagName === "PROGRESS") {
        child.max = updated.max;
        child.value = updated.value;
        child.style.cssText = updated.style.cssText;
      } else syncBody(child, updated);
    });
  }
  root.OverlayMotion = { reconcile, apply, syncAttributes, syncBody, reduced };
})(globalThis);
