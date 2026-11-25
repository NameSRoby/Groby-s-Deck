/** Optional guidance: direct navigation only, never locks tabs or runs actions. */
import { openSetupDestination, selectMainTab } from "./feature-navigation.js";
export function createSetupGuide(panel) {
  const guide = document.createElement("details");
  guide.className = "setupGuide";
  guide.id = "setupGuide";
  try {
    guide.open = localStorage.getItem("groby.setup-guide.collapsed") === "false";
  } catch {
    guide.open = false;
  }
  guide.innerHTML =
    '<summary>Setup & connections<span class="setupGuideSummaryHint">Workspace shortcuts</span></summary><nav class="setupGuideSteps" aria-label="Setup shortcuts"></nav>';
  const steps = [
    ["twitch", "Twitch", "Account & permissions"],
    ["songs", "Music & requests", "Player connection & request method"],
    ["lights", "Lights", "Devices, assignments & profiles"],
    ["presets", "Automations", "Rewards, chat commands & presets"],
    ["deck", "Button deck", "Actions, layouts & public styles"],
    ["packages", "Packages", "Install, update & diagnose features"],
  ];
  const list = guide.querySelector(".setupGuideSteps");
  for (const [destination, title, help] of steps) {
    const heading = document.createElement("strong"),
      text = document.createElement("small"),
      button = document.createElement("button"),
      arrow = document.createElement("span");
    heading.textContent = title;
    text.textContent = help;
    button.type = "button";
    button.className = "setupGuideShortcut";
    arrow.className = "setupGuideArrow";
    arrow.textContent = "\u203a";
    arrow.setAttribute("aria-hidden", "true");
    button.dataset.setupDestination = destination;
    button.onclick = () =>
      destination === "packages" ? selectMainTab("features") : openSetupDestination(destination);
    button.append(heading, text, arrow);
    list.append(button);
  }
  guide.addEventListener("toggle", () => {
    try {
      localStorage.setItem("groby.setup-guide.collapsed", String(!guide.open));
    } catch {}
  });
  panel.querySelector(".dashboardHero").after(guide);
  return guide;
}
