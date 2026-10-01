import { getAdminVideos, syncYouTubeVideos, updateYouTubeVideo } from "./youtube.js";
import { recordAdminActivity } from "./auth.js";

export function registerVideoRoutes(app, requireAdmin, { read = getAdminVideos, sync = syncYouTubeVideos, update = updateYouTubeVideo } = {}) {
  const jsonOnly = (request, response, next) => request.is("application/json") ? next() : response.status(415).json({ error: "Send application/json" });
  const failure = (response, error) => {
    if (error.nextSyncAt) response.set("Retry-After", String(Math.max(1, Math.ceil((Date.parse(error.nextSyncAt) - Date.now()) / 1000))));
    response.status(error.status || 503).json({ error: error.status ? error.message : "Video storage is temporarily unavailable", nextSyncAt: error.nextSyncAt || null });
  };
  app.get("/api/admin/videos", requireAdmin, async (request, response) => {
    response.set("Cache-Control", "no-store");
    try { response.json(await read()); } catch (error) { failure(response, error); }
  });
  app.post("/api/admin/videos/sync", requireAdmin, jsonOnly, async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      await sync();
      await recordAdminActivity(request, { action: "video.sync", resourceType: "youtube", resourceId: "uploads", metadata: { success: true } });
      response.json(await read());
    } catch (error) {
      if (error.status === 502) await recordAdminActivity(request, { action: "video.sync", resourceType: "youtube", resourceId: "uploads", metadata: { success: false, error: error.message } });
      failure(response, error);
    }
  });
  app.patch("/api/admin/videos/:id", requireAdmin, jsonOnly, async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const item = await update(request.params.id, request.body);
      await recordAdminActivity(request, { action: "video.update", resourceType: "video", resourceId: item.id,
        metadata: { fields: Object.keys(request.body), hidden: item.hidden, format: item.format } });
      response.json({ item });
    } catch (error) { failure(response, error); }
  });
}
