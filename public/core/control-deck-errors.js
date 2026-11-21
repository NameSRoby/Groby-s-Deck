import { SOUNDBOARD_ERRORS } from "./soundboard-errors.js";
const errors = {
  ...SOUNDBOARD_ERRORS,
  control_deck_revision_conflict:
    "This deck changed in another window. Reload its current settings and try again.",
  deck_revision_conflict:
    "This deck changed in another window. Reload its current settings and try again.",
  control_deck_action_unavailable:
    "This action is unavailable. Check its package, permissions or connection.",
  control_deck_busy: "This button is already running. Wait for it or stop the running action.",
};
export const explainDeckError = (error) =>
  errors[error.message] || String(error.message).replaceAll("_", " ");
