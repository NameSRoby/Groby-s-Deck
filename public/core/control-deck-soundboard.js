import { selectMainTab } from "./feature-navigation.js";
/** One shortcut into the shared sound library, without another embedded editor. */
export function installSoundboardShortcut(host) {
  const button = document.createElement("button");
  button.className = "deckSettingsButton";
  button.type = "button";
  button.textContent = "Soundboard";
  button.onclick = () => selectMainTab("soundboard");
  host.querySelector(".deckTools").append(button);
}
