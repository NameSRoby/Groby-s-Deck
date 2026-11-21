/** Operator-only library management; uploads stream to bounded private disk files. */
module.exports = (app, { soundboard, route, edit, execute, upload }) => {
  if (!soundboard) return;
  const base = "/api/control-deck/soundboard";
  app.get(
    base,
    route(async () => {
      await soundboard.refresh(true);
      return soundboard.snapshot();
    }),
  );
  app.post(
    base + "/clips",
    upload,
    route((req) =>
      soundboard.library.upload(req, decodeURIComponent(req.headers["x-sound-name"] || "")),
    ),
  );
  app.patch(
    base + "/clips/:id",
    edit,
    route((req) => soundboard.library.rename(req.params.id, req.body?.name)),
  );
  app.delete(
    base + "/clips/:id",
    edit,
    route(async (req) => {
      soundboard.library.read(req.params.id);
      await soundboard.execute("native.soundboard.stop", { clip: req.params.id });
      return soundboard.library.remove(req.params.id);
    }),
  );
  app.post(
    base + "/play",
    execute,
    route((req) => soundboard.execute("native.soundboard.play", req.body)),
  );
  app.post(
    base + "/stop",
    execute,
    route((req) => soundboard.execute("native.soundboard.stop", req.body)),
  );
};
