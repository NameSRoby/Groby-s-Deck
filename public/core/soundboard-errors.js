/** The same playback failures have the same explanation in the deck and library. */
export const SOUNDBOARD_ERRORS = {
  soundboard_clip_missing: "This sound was removed. Choose another sound for the button.",
  soundboard_output_unavailable:
    "That output is disconnected. Choose an available PC audio output.",
  soundboard_format_invalid: "Choose a WAV or MP3 file.",
  soundboard_file_too_large: "Each sound can be up to 32 MiB.",
  soundboard_duration_limit: "Choose a sound no longer than 30 minutes.",
  soundboard_library_full: "The sound library is full (512 sounds or 1 GiB). Remove unused sounds.",
  soundboard_playback_busy:
    "The soundboard supports eight output streams at once. Stop another sound or select fewer outputs.",
  soundboard_upload_busy: "Another sound is uploading. Wait for it, then try again.",
  soundboard_playback_failed:
    "Windows could not play this file. Check its format and audio output.",
  soundboard_request_invalid:
    "Check the sound, output, volume and repeat behavior for this action.",
  soundboard_storage_invalid:
    "The sound library could not be opened safely. Check its local files before trying again.",
  soundboard_name_invalid: "Enter a sound name using 1 to 80 characters.",
};
