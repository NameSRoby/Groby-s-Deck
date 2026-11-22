/** The designer writes documents; OBS receives only read-only public presentation data. */
const { requireLocalOperator } = require("../runtime/local-operator.middleware");
const { rateLimit } = require("express-rate-limit");
module.exports = function registerOverlays(app, { service, runtimeDir, express }) {
  app.use("/api/stream-overlays", requireLocalOperator, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const writes = rateLimit({
    windowMs: 60000,
    limit: 60,
    keyGenerator: () => "stream-overlays",
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const route = (fn) => async (req, res) => {
    try {
      res.json({ ok: true, ...(await fn(req)) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  };
  app.get(
    "/api/stream-overlays",
    route(() => ({
      ...service.store.snapshot(),
      catalog: service.catalog(),
      presentationEffects: true,
      livePreview: true,
    })),
  );
  app.get(
    "/api/stream-overlays/data",
    route((req) => service.data({ fast: req.query.fast === "1" })),
  );
  app.get("/api/stream-overlays/chat-feed", (_req, res) => {
    if (!service.subscribeChat(res)) res.sendStatus(503);
  });
  const previews = rateLimit({
    windowMs: 60000,
    limit: 1200,
    keyGenerator: () => "overlay-previews",
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.post(
    "/api/stream-overlays/preview-data",
    previews,
    route((req) => service.preview(req.body)),
  );
  app.delete(
    "/api/stream-overlays/preview-data/:id",
    route((req) => {
      service.endPreview(req.params.id);
      return {};
    }),
  );
  app.post(
    "/api/stream-overlays/game-control",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      keyGenerator: () => "overlay-game-controls",
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    route((req) => service.gameControl(req.body)),
  );
  app.get(
    "/api/stream-overlays/bingo-deck",
    route((req) => service.bingoDeck(req.query)),
  );
  app.put(
    "/api/stream-overlays",
    writes,
    route((req) => service.save(req.body)),
  );
  app.get(
    "/api/stream-overlays/document/:id",
    route((req) => {
      const revision = service.store.revision();
      return String(revision) === req.query.revision
        ? { revision, notModified: true }
        : { revision, document: service.store.get(req.params.id) };
    }),
  );
  app.delete(
    "/api/stream-overlays/:id",
    writes,
    route((req) => service.remove({ ...req.body, id: req.params.id })),
  );
  if (runtimeDir && express) {
    const media = require("../../domains/overlays/overlay-media")(runtimeDir);
    app.post(
      "/api/stream-overlays/fonts",
      writes,
      express.raw({ type: ["font/woff", "font/woff2", "font/otf", "font/ttf"], limit: "5mb" }),
      route((req) => media.add(req.get("Content-Type"), req.body)),
    );
    app.post(
      "/api/stream-overlays/media",
      writes,
      express.raw({ type: ["image/*", "video/*"], limit: "50mb" }),
      route((req) => media.add(req.get("Content-Type"), req.body)),
    );
    app.get("/api/stream-overlays/media/:name", (req, res) => {
      const asset = media.locate(req.params.name);
      if (!asset) return res.status(404).end();
      res.type(asset.type).sendFile(asset.file);
    });
  }
};
