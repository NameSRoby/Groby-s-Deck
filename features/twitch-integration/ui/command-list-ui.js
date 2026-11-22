/** Selection, public annotations and copy-ready output stay separate from runnable commands. */
/* global CommandListModel */
window.setupCommandList = ({ getRows, hasCommunity, getReplyExample = async () => "" }) => {
  const $ = (id) => document.getElementById(id);
  let rows = [],
    output = [],
    loaded = false,
    manual = 0,
    loadingExamples = false;
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const status = (text) => ($("commandListStatus").textContent = text);
  function options() {
    const format = $("commandListFormat").value;
    return {
      format,
      title: $("commandListHeading").value,
      detail: $("commandListDetail").value,
      limit: Number(
        $(format === "discord" ? "commandListDiscordLimit" : "commandListTwitchLimit").value,
      ),
      access: $("commandListAccess").checked,
      aliases: $("commandListAliases").checked,
      phrases: $("commandListPhrases").checked,
      cooldowns: $("commandListCooldowns").checked,
      examples: $("commandListExamples").checked,
      style: $("commandListStyle").value,
    };
  }
  function shown() {
    const query = $("commandListSearch").value.toLowerCase(),
      filter = $("commandListFilter").value;
    return rows.filter(
      (row) =>
        (filter !== "active" || row.enabled) &&
        (filter !== "selected" || row.included) &&
        (filter !== "builtin" || row.source === "Built-in") &&
        [row.command, row.usage, row.description, ...row.aliases]
          .join(" ")
          .toLowerCase()
          .includes(query),
    );
  }
  function count() {
    $("commandListCount").textContent =
      rows.filter((row) => row.included).length + " / " + rows.length + " selected";
  }
  function field(parent, label, value, change, multiline = false) {
    const wrap = node("label", label),
      input = node(multiline ? "textarea" : "input");
    input.value = value;
    input.maxLength = multiline ? 800 : 160;
    input.oninput = () => {
      change(input.value);
      generate();
    };
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
  function choices() {
    const host = $("commandListChoices");
    host.replaceChildren();
    for (const row of shown()) {
      const box = node("div"),
        annotations = node("div");
      annotations.hidden = !row.included;
      annotations.className = "commandListAnnotations";
      box.className = "commandListChoice";
      const label = node("label"),
        check = node("input");
      label.className = "check";
      check.type = "checkbox";
      check.checked = row.included;
      check.setAttribute("aria-label", "Include " + row.command);
      label.append(check, node("span", row.command));
      check.onchange = () => {
        row.included = check.checked;
        annotations.hidden = !row.included;
        count();
        generate();
      };
      box.append(
        label,
        node("small", row.source + " / " + row.role + (row.enabled ? "" : " / paused")),
      );
      field(
        annotations,
        "Public description",
        row.description,
        (value) => (row.description = value),
        true,
      );
      const extra = node("details"),
        summary = node("summary", "Usage and aliases");
      extra.append(summary);
      field(extra, "Usage shown in the list", row.usage, (value) => {
        row.usage = value;
        if (row.source === "Manual entry") {
          row.command = value.trim().split(/\s/)[0] || "New entry";
          label.querySelector("span").textContent = row.command;
          check.setAttribute("aria-label", "Include " + row.command);
        }
      });
      if (row.aliases.length) extra.append(node("p", "Other names: " + row.aliases.join(", ")));
      if (row.phrases.length)
        extra.append(node("p", "Exact trigger phrases: " + row.phrases.join(", ")));
      if ($("commandListExamples").checked)
        field(
          annotations,
          "Bot reply example (editable)",
          row.example || "",
          (value) => {
            row.example = value;
            row.exampleLoaded = true;
          },
          true,
        );
      if (row.source === "Manual entry") {
        const remove = node("button", "Remove entry");
        remove.type = "button";
        remove.onclick = () => {
          rows = rows.filter((item) => item !== row);
          choices();
          generate();
        };
        extra.append(remove);
      }
      annotations.append(extra);
      box.append(annotations);
      host.append(box);
    }
    if (!host.children.length) host.append(node("p", "No commands match this filter."));
    count();
  }
  function preview(host, text) {
    host.replaceChildren();
    let code = null;
    // Interpret only our fences and generated bold/list syntax; HTML is always text.
    for (const line of text.split("\n")) {
      if (code === null && line === "```text") {
        code = [];
        continue;
      }
      if (code !== null) {
        if (line === "```") {
          host.append(node("pre", code.join("\n")));
          code = null;
        } else code.push(line);
        continue;
      }
      const p = node("p"),
        parts = line.replace(/^\* /, "\u2022 ").split(/(\*\*[^*]+\*\*)/g);
      for (const part of parts) {
        const bold = part.startsWith("**") && part.endsWith("**");
        const n = node(
          bold ? "strong" : "span",
          (bold ? part.slice(2, -2) : part)
            .replace(/\\([\s\S])/g, "$1")
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">")
            .replaceAll("&amp;", "&"),
        );
        p.append(n);
      }
      host.append(p);
    }
    if (code !== null) host.append(node("pre", code.join("\n")));
  }
  async function copy(text, area) {
    // Preserve the click activation before any async Clipboard API rejection.
    area.focus({ preventScroll: true });
    area.select();
    try {
      if (document.execCommand("copy")) {
        status("Copied.");
        return;
      }
    } catch {}
    const id = "command-list-copy-" + Date.now();
    const copied = await new Promise((resolve) => {
      const listener = (event) => {
        if (
          event.source !== parent ||
          event.data?.channel !== "groby-feature-ui-v1" ||
          event.data.id !== id
        )
          return;
        clearTimeout(timer);
        removeEventListener("message", listener);
        resolve(event.data.ok === true);
      };
      const timer = setTimeout(() => {
        removeEventListener("message", listener);
        resolve(false);
      }, 1500);
      addEventListener("message", listener);
      parent.postMessage(
        { channel: "groby-feature-ui-v1", type: "clipboard-write", id, text },
        "*",
      );
    });
    if (copied) status("Copied. Paste this part into your chosen service.");
    else {
      area.focus({ preventScroll: true });
      area.select();
      status(
        "Automatic copy is unavailable in this browser. The text is selected: press Ctrl+C or your device's Copy command.",
      );
    }
  }
  function drawOutput(limit) {
    const host = $("commandListParts");
    host.replaceChildren();
    output.forEach((text, index) => {
      const card = node("div");
      card.className = "commandListPart";
      const header = node("header"),
        title = node(
          "strong",
          ($("commandListFormat").value === "discord" ? "Message " : "Panel ") +
            (index + 1) +
            " of " +
            output.length,
        ),
        length = node("small"),
        button = node("button", "Copy part " + (index + 1)),
        area = node("textarea"),
        details = node("details"),
        display = node("div");
      area.value = text;
      area.setAttribute("aria-label", "Generated text part " + (index + 1));
      display.className = "commandListPreview";
      details.append(node("summary", "Preview"), display);
      button.type = "button";
      const update = () => {
        output[index] = area.value;
        length.textContent = area.value.length + " / " + limit;
        length.classList.toggle("commandListOver", area.value.length > limit);
        button.disabled = area.value.length > limit || !area.value;
        preview(display, area.value);
      };
      area.oninput = () => {
        update();
        if (area.value.length > limit)
          status(
            "This part is too long. Shorten it, or update output to split your selected commands again.",
          );
      };
      button.onclick = () => copy(area.value, area);
      header.append(title, length, button);
      card.append(header, area, details);
      host.append(card);
      update();
    });
    if (!output.length) host.append(node("p", "Select commands on the left to create your list."));
  }
  async function loadExamples() {
    if (loadingExamples || !$("commandListExamples").checked) return;
    loadingExamples = true;
    let changed = false;
    try {
      for (const row of rows) {
        if (!$("commandListExamples").checked) break;
        if (!row.included || row.exampleLoaded) continue;
        try {
          row.example = await getReplyExample(row.id);
        } catch {
          row.example = "";
        }
        row.exampleLoaded = true;
        changed = true;
        generate();
      }
    } finally {
      loadingExamples = false;
      if (changed) {
        choices();
        generate();
      }
    }
  }
  function generate() {
    const o = options(),
      result = CommandListModel.generate(rows, o);
    output = result.parts;
    $("discordLimitField").hidden = o.format !== "discord";
    $("commandListStyleField").hidden = o.format !== "discord";
    $("twitchLimitField").hidden = o.format !== "twitch";
    $("commandListHelp").textContent =
      o.format === "discord"
        ? "Paste one message at a time. Each part fits the selected Discord limit; @mentions are neutralized."
        : "Paste into About > Edit Panels > Description. Panel size is your chosen split target, not the 300-character profile bio limit.";
    drawOutput(result.limit);
    status(
      result.count
        ? result.count +
            (result.count === 1 ? " command in " : " commands in ") +
            output.length +
            (o.format === "discord"
              ? output.length === 1
                ? " message."
                : " messages."
              : output.length === 1
                ? " panel."
                : " panels.")
        : "Nothing selected. Your commands have not been changed.",
    );
    count();
    const selected = rows.filter((row) => row.included),
      missing = [];
    if (o.aliases && selected.length && !selected.some((row) => row.aliases.length))
      missing.push("No other command names are saved for this selection.");
    if (o.phrases && selected.length && !selected.some((row) => row.phrases.length))
      missing.push(
        "No exact trigger phrases are saved for this selection. These are alternative triggers, not bot replies.",
      );
    if (
      o.examples &&
      selected.length &&
      selected.every((row) => row.exampleLoaded) &&
      !selected.some((row) => row.example)
    )
      missing.push(
        "No chat reply example is available. Add one in the command's public example field.",
      );
    if (missing.length) status($("commandListStatus").textContent + " " + missing.join(" "));
    void loadExamples();
  }
  function refresh() {
    const previous = new Map(rows.map((row) => [row.id, row]));
    rows = [
      ...CommandListModel.commands(getRows()),
      ...(hasCommunity() ? CommandListModel.builtins() : []),
    ]
      .map((row) => ({
        ...row,
        ...(previous.has(row.id)
          ? {
              included: previous.get(row.id).included,
              description: previous.get(row.id).description,
              usage: previous.get(row.id).usage,
              example: previous.get(row.id).example,
              exampleLoaded: previous.get(row.id).exampleLoaded,
            }
          : {}),
      }))
      .concat(rows.filter((row) => row.source === "Manual entry"));
    choices();
    if (!loaded) {
      generate();
      loaded = true;
    } else
      status(
        "Selection refreshed from saved commands. Choose Update output to include any changes.",
      );
  }
  $("commandListSearch").oninput = choices;
  $("commandListFilter").onchange = choices;
  $("commandListSelect").onclick = () => {
    shown().forEach((row) => (row.included = true));
    choices();
    generate();
  };
  $("commandListClear").onclick = () => {
    rows.forEach((row) => (row.included = false));
    choices();
    generate();
  };
  $("commandListAdd").onclick = () => {
    if (rows.filter((row) => row.source === "Manual entry").length >= 50)
      return status("Up to 50 extra entries can be added.");
    const row = {
      id: "manual:" + ++manual,
      command: "New entry " + manual,
      usage: "!command",
      description: "",
      aliases: [],
      phrases: [],
      role: "Everyone",
      source: "Manual entry",
      enabled: true,
      included: true,
    };
    rows.push(row);
    $("commandListSearch").value = "";
    $("commandListFilter").value = "all";
    choices();
    $("commandListChoices").lastElementChild.scrollIntoView({ block: "nearest" });
    generate();
  };
  for (const id of [
    "commandListFormat",
    "commandListDetail",
    "commandListDiscordLimit",
    "commandListTwitchLimit",
    "commandListAccess",
    "commandListAliases",
    "commandListPhrases",
    "commandListCooldowns",
    "commandListExamples",
    "commandListStyle",
  ])
    $(id).onchange = () => {
      choices();
      generate();
    };
  $("commandListHeading").onchange = generate;
  $("commandListGenerate").onclick = generate;
  return { refresh };
};
