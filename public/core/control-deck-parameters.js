import { attachSoundField, readSoundOutputs } from "./control-deck-sound-fields.js";
/** Build ordinary form controls from the host's declared action parameters.
 * Complex data stays explicit JSON; none of these fields is executable code.
 */
import { COMMAND_VARIABLES } from "./command-variable-catalog.js";
import { attachCommandEditor } from "./command-code-editor.js";
const clone = (value) => structuredClone(value);
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
export function parameterForm(host, schema = {}, initial = {}, sendKey) {
  const fields = [],
    value = clone(initial || {}),
    properties = schema.properties || {};
  const simple = Object.entries(properties).filter(
    ([, f]) =>
      (["string", "number", "integer", "boolean"].includes(f.type) ||
        (f.type === "array" && f.format === "soundboard-outputs")) &&
      !f.oneOf &&
      !f.anyOf,
  );
  const complex =
    Object.keys(value).some((key) => !properties[key]) ||
    Object.keys(properties).length !== simple.length;
  if (complex || (!Object.keys(properties).length && Object.keys(value).length)) {
    const label = node("label", "deckField"),
      input = node("textarea");
    input.rows = 4;
    input.value = JSON.stringify(value, null, 2);
    label.append(node("span", "", "Action data (JSON)"), input);
    host.append(label);
    return () => {
      let parsed;
      try {
        parsed = JSON.parse(input.value);
      } catch {
        throw Error("Check the action data JSON.");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw Error("Action data must be a JSON object.");
      return parsed;
    };
  }
  const groups = new Map();
  const groupFor = (name) => {
    if (!name) return host;
    if (!groups.has(name)) {
      const details = node("details", "deckPlaybackOptions"),
        summary = node("summary", "", name),
        body = node("div", "deckStepParameters");
      details.append(summary, body);
      host.append(details);
      groups.set(name, body);
    }
    return groups.get(name);
  };
  for (const [key, property] of simple) {
    const label = node(property.type === "array" ? "div" : "label", "deckField"),
      control = node(property.enum ? "select" : key === "message" ? "textarea" : "input");
    const required = schema.required?.includes(key);
    if (property.enum) {
      if (!required) control.add(new Option("Default", ""));
      for (const option of property.enum)
        control.add(new Option(property.enumNames?.[option] || String(option), String(option)));
    } else if (control.tagName === "INPUT")
      control.type =
        property.type === "array"
          ? "hidden"
          : property.type === "boolean"
            ? "checkbox"
            : ["number", "integer"].includes(property.type)
              ? "number"
              : "text";
    const current = value[key] ?? property.default;
    if (property.type === "boolean") control.checked = current === true;
    else
      control.value =
        property.type === "array"
          ? JSON.stringify(current || ["default"])
          : current === undefined
            ? ""
            : current;
    if (property.minimum !== undefined) control.min = property.minimum;
    if (property.maximum !== undefined) control.max = property.maximum;
    if (property.maxLength) control.maxLength = property.maxLength;
    if (property.pattern) control.pattern = property.pattern;
    if (property.type === "integer") control.step = 1;
    control.required = required && property.type !== "boolean";
    control.dataset.deckParameter = key;
    label.append(
      node("span", "", (property.title || key.replace(/([A-Z])/g, " $1")) + (required ? " *" : "")),
      control,
    );
    if (property.description) {
      const help = node("small", "", property.description);
      label.append(help);
    }
    groupFor(property["x-group"]).append(label);
    if (["soundboard-clip", "soundboard-outputs"].includes(property.format))
      attachSoundField(host, label, control, property);
    if (key === "message" && property.type === "string") {
      label.classList.add("commandCodeField");
      attachCommandEditor(control);
      host.append(
        node(
          "small",
          "deckEditorHint commandCodeHelp",
          property.title === "Recipe"
            ? "Run variables without posting chat. Temporary values last for this recipe; counters and player fields persist for other steps and automations."
            : "Write your reply and insert named variables. Use ${set roll random 1 20} to remember a roll, then ${roll} to reuse it. For comparisons and calculations, open Language manual in Syntax & examples. The guide also includes the full editable fight command.",
        ),
      );
      const help = node("details"),
        summary = node("summary", "", "Insert variable"),
        choices = node("div", "deckSequenceTools");
      help.classList.add("commandVariablePicker");
      help.append(summary, choices);
      for (const token of [
        "${sender}",
        "${user}",
        "${1}",
        "${game user}",
        "${link user}",
        "${args}",
        "${channel}",
        "${title}",
        "${game}",
        "${link}",
        "${uptime}",
        "${viewers}",
        "${raider}",
        "${bits}",
        "${months}",
        "${gifts}",
        "${time}",
        "${date}",
        "${readcountadddeath}",
        "${resetcountadddeath}",
        '${random.pick "Hello" "Welcome" "Hey"}',
        "${countadddeath}",
        "${random 1 20}",
        '${chance 25 "Win!" "Try again"}',
      ]) {
        const insert = node(
          "button",
          "",
          {
            "${sender}": "Person speaking",
            "${user}": "Target person",
            "${1}": "First argument",
            "${game user}": "Target category",
            "${link user}": "Target link",
            "${countadddeath}": "Add a death",
            "${random 1 20}": "Roll a d20",
            '${chance 25 "Win!" "Try again"}': "25% chance",
          }[token] ||
            {
              args: "All command arguments",
              channel: "Your channel",
              title: "Stream title",
              game: "Your category",
              link: "Your Twitch link",
              uptime: "Stream uptime",
              viewers: "Viewer count",
              raider: "Raider name",
              bits: "Bits in event",
              months: "Subscription months",
              gifts: "Gift subscriptions",
              time: "Current time",
              date: "Today",
              readcountadddeath: "Read death total",
              resetcountadddeath: "Reset death total",
            }[token.slice(2, -1)] ||
            "Random greeting",
        );
        insert.type = "button";
        insert.onclick = () => {
          const start = control.selectionStart ?? control.value.length,
            end = control.selectionEnd ?? start;
          control.setRangeText(token, start, end, "end");
          control.dispatchEvent(new Event("input", { bubbles: true }));
          control.focus();
        };
        choices.append(insert);
      }
      const all = node("details"),
        allSummary = node("summary", "", "All variables and saved values");
      const search = node("input"),
        select = node("select"),
        add = node("button", "", "Insert selected variable");
      const explanation = node("small", "deckEditorHint");
      for (const field of [search, select]) {
        field.style.width = "100%";
        field.style.minWidth = "0";
        field.style.maxWidth = "100%";
      }
      search.type = "search";
      search.placeholder = "Search: saved values, conditions, random, usernames...";
      search.setAttribute("aria-label", "Find a command variable");
      select.setAttribute("aria-label", "Command variable");
      add.type = "button";
      const update = () => {
        select.replaceChildren(new Option("Choose a variable", ""));
        const query = search.value.trim().toLowerCase();
        for (const row of COMMAND_VARIABLES) {
          if (![row.syntax, row.group, row.description].join(" ").toLowerCase().includes(query))
            continue;
          select.add(new Option(row.syntax + " - " + row.group, row.syntax));
        }
        add.disabled = true;
        explanation.textContent = "";
      };
      search.oninput = update;
      select.onchange = () => {
        add.disabled = !select.value;
        explanation.textContent =
          COMMAND_VARIABLES.find((row) => row.syntax === select.value)?.description || "";
      };
      add.onclick = () => {
        if (!select.value) return;
        control.setRangeText(
          select.value,
          control.selectionStart ?? control.value.length,
          control.selectionEnd ?? control.value.length,
          "end",
        );
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.focus();
      };
      update();
      all.append(allSummary, search, select, explanation, add);
      help.append(all);
      const link = node("a", "", "Syntax & examples");
      link.href = "/features-ui/twitch-integration/syntax";
      link.target = "_blank";
      link.rel = "noopener";
      help.append(link);
      host.append(help);
    }
    if (key === "shortcut" && sendKey) {
      host.classList.add("deckHotkeyParameters");
      const picker = node("select"),
        tools = node("div", "deckHotkeyTools"),
        send = node("button", "", "Send key in 5 seconds"),
        status = node("small", "deckEditorHint");
      picker.setAttribute("aria-label", "Rare keyboard key");
      picker.add(new Option("Choose a rarely used key…", ""));
      for (let n = 13; n <= 24; n++) {
        for (const prefix of ["", "Ctrl+Shift+"])
          picker.add(new Option(prefix + "F" + n, prefix + "F" + n));
      }
      picker.onchange = () => {
        if (picker.value) control.value = picker.value;
      };
      send.type = "button";
      send.onclick = async () => {
        if (!control.value.trim() || !control.reportValidity()) return;
        const shortcut = control.value.trim();
        send.disabled = true;
        try {
          for (let remaining = 5; remaining > 0; remaining--) {
            status.textContent = `Sending ${shortcut} in ${remaining}s. Focus the app that should receive it.`;
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (!send.isConnected || !send.closest("dialog")?.open) return;
          }
          await sendKey(shortcut);
          status.textContent = "Key sent on the Groby’s Deck PC.";
        } catch (error) {
          status.textContent =
            {
              desktop_input_blocked:
                "Windows blocked the key input. Run Groby’s Deck and the receiving app at the same permission level, then retry.",
              desktop_keys_busy: "Release Ctrl, Shift, Alt and Windows keys, then retry.",
              desktop_action_timeout: "Windows did not respond in time. Retry the key send.",
            }[error.message] || "The key could not be sent. Check the receiving app and retry.";
        } finally {
          send.disabled = false;
        }
      };
      tools.append(picker, send, status);
      host.append(
        tools,
        node(
          "p",
          "deckEditorHint",
          "F13–F24 are valid Windows keys absent from most keyboards. Buttons send input on the Groby’s Deck PC, including from your phone or tablet.",
        ),
      );
    }
    fields.push({ key, property, control, required, label });
  }
  const matches = (condition) =>
    Object.entries(condition || {}).every(
      ([key, expected]) => fields.find((field) => field.key === key)?.control.value === expected,
    );
  function sync() {
    for (const field of fields) {
      const visible = !field.property["x-visibleWhen"] || matches(field.property["x-visibleWhen"]);
      field.label.hidden = !visible;
      field.control.disabled = !visible;
      field.control.required =
        visible &&
        field.property.type !== "boolean" &&
        (field.required ||
          (!!field.property["x-requiredWhen"] && matches(field.property["x-requiredWhen"])));
    }
  }
  for (const field of fields) field.control.addEventListener("change", sync);
  sync();
  return (validate = true) => {
    if (validate && host.querySelector("[data-soundboard-uploading]"))
      throw Error("Wait for the audio file to finish uploading.");
    const result = {};
    for (const { key, property, control, required } of fields) {
      if (control.disabled) continue;
      if (validate && !control.reportValidity())
        throw Error("Complete the required action fields.");
      if (property.type === "array") result[key] = readSoundOutputs(control, validate);
      else if (property.type === "boolean") result[key] = control.checked;
      else if (control.value !== "")
        result[key] = ["number", "integer"].includes(property.type)
          ? Number(control.value)
          : control.value;
      else if (required && validate) throw Error("Complete " + key + ".");
    }
    return result;
  };
}
