/** Widget picker shared by mouse and keyboard. */
globalThis.setupOverlayCatalog = (a, addWidget) => {
  const $ = a.$;
  function drawCatalog() {
    const host = $("widgetCatalog"),
      query = $("widgetSearch").value.trim().toLowerCase();
    const catalog = a.catalog;
    const words = query.split(/\s+/);
    host.replaceChildren();
    host.scrollTop = 0;
    let group = "";
    const groups = [
      "Static",
      "Music",
      "Labels",
      "Twitch",
      "Alerts",
      "Records",
      "Games",
      "Tools",
      "Custom",
    ];
    const selectedGroup =
      groups.includes($("widgetGroup").value) &&
      catalog.some((row) => row.group === $("widgetGroup").value)
        ? $("widgetGroup").value
        : "";
    $("widgetGroup").replaceChildren(
      new Option("All categories", ""),
      ...groups
        .filter((group) => catalog.some((row) => row.group === group))
        .map((group) => new Option(group, group)),
    );
    $("widgetGroup").value = selectedGroup;
    const choices = catalog
      .filter(
        (row) =>
          words.every((word) => (row.name + " " + row.group).toLowerCase().includes(word)) &&
          (!selectedGroup || row.group === selectedGroup),
      )
      .sort(
        (a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.name.localeCompare(b.name),
      );
    for (const row of choices) {
      if (row.group !== group) {
        group = row.group;
        const title = document.createElement("h3");
        title.textContent = group;
        host.append(title);
      }
      const button = document.createElement("button");
      const name = document.createElement("span");
      name.textContent = row.name;
      button.append(name);
      if (row.requirement) {
        const hint = document.createElement("small");
        hint.id = "widget-requirement-" + row.type;
        hint.textContent = row.requirement;
        button.setAttribute("aria-label", row.name);
        button.setAttribute("aria-describedby", hint.id);
        button.append(hint);
      }
      button.onclick = () => {
        if (addWidget(row) !== false) $("catalogDialog").close();
      };
      host.append(button);
    }
    if (!choices.length) {
      const empty = document.createElement("p");
      empty.className = "catalogEmpty";
      empty.textContent = !a.catalogReady
        ? "Loading widgets…"
        : query
          ? "No matching widgets."
          : "No widgets available.";
      host.append(empty);
    }
    $("catalogHelp").textContent =
      "You can design with sample data. Setup hints show what each live widget needs.";
  }
  $("add").onclick = () => {
    drawCatalog();
    $("catalogDialog").showModal();
    $("widgetSearch").focus();
    void a
      .request()
      .then((result) => {
        a.catalog = result.catalog;
        if ($("catalogDialog").open) drawCatalog();
      })
      .catch((error) => a.notice(error.message));
  };
  $("widgetSearch").oninput = drawCatalog;
  $("widgetSearch").onkeydown = (event) => {
    if (!["Enter", "ArrowDown"].includes(event.key) || event.isComposing) return;
    const first = $("widgetCatalog").querySelector("button");
    if (!first) return;
    event.preventDefault();
    if (event.key === "Enter") first.click();
    else first.focus();
  };
  $("widgetGroup").onchange = drawCatalog;

  return drawCatalog;
};
