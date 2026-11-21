/** Mods share the package workspace; core updates stay first by default. */
(() => {
  const tabs = [...document.querySelectorAll("[data-maintenance]")];
  for (const tab of tabs)
    tab.addEventListener("click", () => {
      for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute("aria-selected", String(selected));
        item.classList.toggle("active", selected);
      }
      document.querySelectorAll("[data-maintenance-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.maintenancePanel !== tab.dataset.maintenance;
      });
    });
})();
