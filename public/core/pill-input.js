/** Compact, keyboard-accessible lists. A pill is one whole entry, including spaces. */
export function createPillInput(
  input,
  {
    label,
    maxItems = 32,
    maxLength = 80,
    normalize = (value) => value.trim(),
    validate = () => "",
    onChange = () => {},
  } = {},
) {
  const root = document.createElement("div"),
    list = document.createElement("ul"),
    error = document.createElement("small"),
    status = document.createElement("span");
  root.className = "pillInput";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", label);
  list.className = "pillTokens";
  list.setAttribute("aria-label", label + " entries");
  error.className = "pillError";
  error.id = input.id + "Error";
  error.hidden = true;
  error.setAttribute("role", "alert");
  status.className = "pillStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  input.classList.add("pillDraft");
  input.type = "text";
  input.maxLength = maxLength;
  input.autocomplete = "off";
  input.setAttribute(
    "aria-describedby",
    [input.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "),
  );
  input.before(root);
  root.append(list, input, status);
  root.after(error);
  let entries = [];
  const clearError = () => {
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    error.hidden = true;
  };
  const fail = (message) => {
    input.setCustomValidity(message);
    input.setAttribute("aria-invalid", "true");
    error.textContent = message;
    error.hidden = false;
    return false;
  };
  function remove(index) {
    if (input.disabled) return;
    const [removed] = entries.splice(index, 1);
    render();
    input.focus();
    status.textContent = "Removed " + removed + ".";
    changed();
  }
  function render() {
    list.replaceChildren();
    for (const [index, value] of entries.entries()) {
      const item = document.createElement("li"),
        text = document.createElement("span"),
        button = document.createElement("button");
      item.className = "pillToken";
      text.textContent = value;
      button.className = "pillRemove";
      button.type = "button";
      button.textContent = "\u00d7";
      button.setAttribute("aria-label", "Remove " + value);
      button.title = "Remove " + value;
      button.disabled = input.disabled;
      button.onclick = (event) => {
        event.preventDefault();
        remove(index);
      };
      button.onkeydown = (event) => {
        if (["Backspace", "Delete", "\\"].includes(event.key)) {
          event.preventDefault();
          remove(index);
        }
      };
      item.append(text, button);
      list.append(item);
    }
    root.dataset.empty = String(!entries.length);
  }
  function changed() {
    clearError();
    input.dispatchEvent(new Event("change", { bubbles: true }));
    onChange([...entries]);
  }
  function add(values) {
    if (!values.some((value) => value.trim())) {
      clearError();
      return true;
    }
    const next = [...entries];
    for (const raw of values) {
      const value = normalize(raw);
      if (!value || next.includes(value)) continue;
      const problem =
        value.length > maxLength
          ? "Use at most " + maxLength + " characters per entry."
          : validate(value);
      if (problem) return fail(problem);
      if (next.length >= maxItems) return fail("Use at most " + maxItems + " entries.");
      next.push(value);
    }
    entries = next;
    input.value = "";
    render();
    changed();
    status.textContent = entries.length + " " + (entries.length === 1 ? "entry" : "entries") + ".";
    return true;
  }
  input.addEventListener("input", clearError);
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229 || input.disabled) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      add([input.value]);
    } else if (["Backspace", "\\"].includes(event.key) && !input.value && entries.length) {
      event.preventDefault();
      remove(entries.length - 1);
    } else if (event.key === "ArrowLeft" && !input.value) {
      list.lastElementChild?.querySelector("button").focus();
    }
  });
  input.addEventListener("blur", (event) => {
    if (!root.contains(event.relatedTarget) && input.value.trim()) add([input.value]);
  });
  input.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain");
    if (!text || !/[\r\n]/.test(text)) return;
    event.preventDefault();
    const combined =
      input.value.slice(0, input.selectionStart) + text + input.value.slice(input.selectionEnd);
    add(combined.split(/\r\n?|\n/));
  });
  root.addEventListener("click", (event) => {
    if (!event.target.closest("button")) input.focus();
  });
  render();
  return {
    set(values = []) {
      entries = [...new Set(values.map(normalize).filter(Boolean))];
      input.value = "";
      clearError();
      status.textContent = "";
      render();
      onChange([...entries]);
    },
    read() {
      if (!add([input.value])) {
        input.focus();
        throw Error(error.textContent);
      }
      return [...entries];
    },
  };
}
