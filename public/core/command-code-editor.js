/** Native textarea editing with a non-interactive, safely rendered color layer. */
import { commandTokens } from "./command-syntax-tokens.js";
const codeEditors = new WeakMap();
let codeResize;
export function attachCommandEditor(input, { legend = true } = {}) {
  if (codeEditors.has(input)) return codeEditors.get(input);
  const root = document.createElement("span"),
    highlight = document.createElement("pre");
  root.className = "commandCodeEditor";
  highlight.className = "commandCodeHighlight";
  highlight.setAttribute("aria-hidden", "true");
  input.classList.add("commandCodeInput");
  if (!input.hasAttribute("rows")) input.rows = 4;
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.before(root);
  root.append(highlight, input);
  const toolbar = document.createElement("div"),
    toggle = document.createElement("button");
  toolbar.className = "commandCodeLegend";
  toolbar.setAttribute("aria-label", "Command syntax color key");
  for (const [kind, text] of [
    ["flow", "If / else / end"],
    ["function", "Functions"],
    ["variable", "Names & variables"],
    ["number", "Numbers"],
    ["string", "Quoted text"],
    ["operator", "Operators"],
  ]) {
    const item = document.createElement("span");
    item.className = "commandToken-" + kind;
    item.textContent = text;
    toolbar.append(item);
  }
  toggle.type = "button";
  toolbar.append(toggle);
  (input.closest("label") || root).after(toolbar);
  toolbar.hidden = !legend;
  let enabled = true,
    composing = false,
    previous = null,
    frame = 0,
    disposed = false;
  const valueProperty = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value"),
    ownValue = Object.getOwnPropertyDescriptor(input, "value"),
    rangeProperty = Object.getOwnPropertyDescriptor(input, "setRangeText"),
    setRangeText = input.setRangeText,
    form = input.form;
  try {
    enabled = localStorage.getItem("grobysDeck.commandColors") !== "off";
  } catch {
    /* Sandboxed panels may not have storage. */
  }
  function syncScroll() {
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
  }
  function paint() {
    frame = 0;
    if (disposed) return;
    if (!input.isConnected) {
      destroy();
      return;
    }
    root.dataset.plain = String(!enabled || composing);
    toggle.textContent = enabled ? "Colors on" : "Colors off";
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.setAttribute("aria-label", "Syntax colors");
    const style = getComputedStyle(input);
    for (const name of [
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "fontFamily",
      "fontSize",
      "lineHeight",
      "letterSpacing",
      "tabSize",
    ])
      highlight.style[name] = style[name];
    highlight.style.width =
      input.clientWidth +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.borderRightWidth) +
      "px";
    highlight.style.height =
      input.clientHeight +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth) +
      "px";
    if (previous !== input.value) {
      previous = input.value;
      const content = document.createDocumentFragment();
      for (const token of commandTokens(previous)) {
        const span = document.createElement("span");
        span.className = "commandToken-" + token.kind;
        span.textContent = token.text;
        content.append(span);
      }
      content.append(document.createTextNode("\u200b"));
      highlight.replaceChildren(content);
    }
    syncScroll();
  }
  function schedule() {
    if (!frame && !disposed) frame = requestAnimationFrame(paint);
  }
  function composition(event) {
    composing = event.type === "compositionstart";
    paint();
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    codeResize?.unobserve(input);
    input.removeEventListener("input", schedule);
    input.removeEventListener("scroll", syncScroll);
    input.removeEventListener("compositionstart", composition);
    input.removeEventListener("compositionend", composition);
    form?.removeEventListener("reset", schedule);
    if (ownValue) Object.defineProperty(input, "value", ownValue);
    else delete input.value;
    if (rangeProperty) Object.defineProperty(input, "setRangeText", rangeProperty);
    else delete input.setRangeText;
    root.replaceWith(input);
    input.classList.remove("commandCodeInput");
    toolbar.remove();
    codeEditors.delete(input);
  }
  Object.defineProperty(input, "value", {
    configurable: true,
    get() {
      return valueProperty.get.call(this);
    },
    set(value) {
      valueProperty.set.call(this, value);
      schedule();
    },
  });
  input.setRangeText = function (...args) {
    setRangeText.apply(this, args);
    schedule();
  };
  toggle.onclick = () => {
    enabled = !enabled;
    try {
      localStorage.setItem("grobysDeck.commandColors", enabled ? "on" : "off");
    } catch {
      /* Optional UI preference only. */
    }
    paint();
  };
  input.addEventListener("input", schedule);
  input.addEventListener("scroll", syncScroll, { passive: true });
  input.addEventListener("compositionstart", composition);
  input.addEventListener("compositionend", composition);
  form?.addEventListener("reset", schedule);
  codeResize ||= new ResizeObserver((entries) => {
    for (const entry of entries) codeEditors.get(entry.target)?.refresh();
  });
  const editor = { refresh: paint, destroy };
  codeEditors.set(input, editor);
  codeResize.observe(input);
  if (input.isConnected) paint();
  else schedule();
  return editor;
}
