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
    '<summary>Setup & connections</summary><p>Use these shortcuts in any order. All tabs and advanced controls remain available. Public presets are included; accounts and devices are yours to connect.</p><div class="setupGuideSteps"></div>';
  const steps = [
    [
      "twitch",
      "Twitch connection",
      "Connect your channel and choose the permissions you want. Chat commands do not require a Channel Points reward.",
    ],
    [
      "songs",
      "Music player & request mode",
      "Choose a player, connect its companion if needed, then select chat or Channel Points. This request mode takes precedence over reward configuration.",
    ],
    [
      "lights",
      "Lights & public profiles",
      "Add your lights, choose their assignments, then try a public lighting profile.",
    ],
    [
      "presets",
      "Rewards, commands & presets",
      "The four built-in feature controls stay available. Public examples open as editable drafts; saving and enabling are separate choices.",
    ],
    [
      "deck",
      "Button deck & public presets",
      "Choose Add a button to use a public button preset. Appearance profiles are available in deck settings. Selecting a preset never runs it.",
    ],
  ];
  const list = guide.querySelector(".setupGuideSteps");
  for (const [destination, title, help] of steps) {
    const card = document.createElement("section"),
      heading = document.createElement("h3"),
      text = document.createElement("p"),
      button = document.createElement("button");
    heading.textContent = title;
    text.textContent = help;
    button.type = "button";
    button.textContent = "Open " + title;
    button.dataset.setupDestination = destination;
    button.onclick = () => openSetupDestination(destination);
    card.append(heading, text, button);
    list.append(card);
  }
  const packages = document.createElement("button");
  packages.type = "button";
  packages.textContent = "Packages & startup diagnostics";
  packages.onclick = () => selectMainTab("features");
  guide.append(packages);
  guide.addEventListener("toggle", () => {
    try {
      localStorage.setItem("groby.setup-guide.collapsed", String(!guide.open));
    } catch {}
  });
  panel.querySelector(".dashboardHero").after(guide);
  return guide;
}
