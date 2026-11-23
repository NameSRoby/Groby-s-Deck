/** Hosted storage failures must never become a writable default configuration. */
module.exports = {
  read(result) {
    if (result?.ok === false) throw new Error("song_settings_read_failed");
  },
  failed(context, error) {
    const hosted = context.consumedCapabilities?.some((id) =>
      /^(groby|ravelink)\.storage\.v1\??$/.test(id),
    );
    if (error.code !== "provider_unavailable" || hosted)
      throw new Error("song_settings_restore_failed: " + (error.code || error.message));
  },
};
