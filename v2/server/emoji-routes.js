import multer from "multer";
import { createEmoji, deleteEmoji, emojiImage, listEmojis, updateEmoji, getEmojiSettings, updateEmojiSettings } from "./emojis.js";
import { recordAdminActivity } from "./auth.js";

export function registerEmojiRoutes(app, requireAdmin) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } }).single("file");
  app.get("/api/emojis", async (request, response) => {
    response.set("Cache-Control", "no-cache");
    try { const [items, settings] = await Promise.all([listEmojis(), getEmojiSettings()]); response.json({ items, settings }); }
    catch { response.status(503).json({ error: "Emojis are temporarily unavailable" }); }
  });
  app.get("/api/admin/emojis", requireAdmin, async (request, response) => {
    response.set("Cache-Control", "no-store");
    try { const [items, settings] = await Promise.all([listEmojis(true), getEmojiSettings()]); response.json({ items, settings }); }
    catch { response.status(503).json({ error: "Unable to load emojis" }); }
  });
  app.patch("/api/admin/emoji-settings", requireAdmin, async (request, response) => {
    try {
      const settings = await updateEmojiSettings(request.body);
      await recordAdminActivity(request, { action: "emoji.settings", resourceType: "emoji-settings", resourceId: "global", metadata: settings });
      response.json({ settings });
    } catch (error) { response.status(400).json({ error: error.message || "Unable to save emoji settings" }); }
  });
  app.post("/api/admin/emojis", requireAdmin, (request, response) => {
    upload(request, response, async (error) => {
      if (error) return response.status(400).json({ error: "Upload one image, 3 MB or smaller" });
      try {
        const item = await createEmoji(request.file?.buffer, { name: request.body?.name });
        await recordAdminActivity(request, { action: "emoji.upload", resourceType: "emoji", resourceId: item.id, metadata: { name: item.name } });
        response.status(201).json({ item });
      } catch (error) { response.status(400).json({ error: error.message || "Unable to upload emoji" }); }
    });
  });
  app.patch("/api/admin/emojis/:id", requireAdmin, async (request, response) => {
    try {
      const item = await updateEmoji(request.params.id, request.body);
      await recordAdminActivity(request, { action: "emoji.update", resourceType: "emoji", resourceId: item.id,
        metadata: { fields: ["name", "enabled", "quotes", "heldQuotes", "fanartQuotes", "links"].filter(key => request.body[key] !== undefined), enabled: item.enabled } });
      response.json({ item });
    } catch (error) { response.status(400).json({ error: error.message || "Unable to save emoji" }); }
  });
  app.delete("/api/admin/emojis/:id", requireAdmin, async (request, response) => {
    try {
      await deleteEmoji(request.params.id);
      await recordAdminActivity(request, { action: "emoji.delete", resourceType: "emoji", resourceId: request.params.id });
      response.json({ ok: true });
    } catch (error) { response.status(404).json({ error: error.message || "Emoji not found" }); }
  });
  const image = (original) => async (request, response) => {
    response.set("Cache-Control", original ? "no-store" : "no-cache");
    try {
      const item = await emojiImage(request.params.id, original);
      if (!item) return response.status(404).send("Emoji not found");
      response.type(item.mime).send(item.data);
    } catch { response.status(503).send("Unable to load emoji"); }
  };
  app.get("/emojis/:id.webp", image(false));
  app.get("/api/admin/emojis/:id/original", requireAdmin, image(true));
}
