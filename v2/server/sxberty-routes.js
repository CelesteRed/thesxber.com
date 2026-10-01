import { getSxbertySettings, updateSxbertySettings } from "./sxberty.js";
import { recordAdminActivity } from "./auth.js";
import { normalizeSxbertySettings, validateSxbertyPatch } from "../shared/sxberty.js";

export function registerSxbertyRoutes(app, requireAdmin, {
  read = getSxbertySettings,
  update = updateSxbertySettings,
  audit = recordAdminActivity
} = {}) {
  const noStore = (request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  };
  const jsonOnly = (request, response, next) => request.is("application/json")
    ? next() : response.status(415).json({ error: "Send application/json" });
  const unavailable = response => response.status(503).json({ error: "Sxberty settings are temporarily unavailable" });

  app.get("/api/sxberty", async (request, response) => {
    response.set("Cache-Control", "no-cache");
    try { response.json({ settings: normalizeSxbertySettings(await read()) }); }
    catch { unavailable(response); }
  });

  app.get("/api/admin/sxberty", noStore, requireAdmin, async (request, response) => {
    try { response.json({ settings: normalizeSxbertySettings(await read()) }); }
    catch { unavailable(response); }
  });

  app.patch("/api/admin/sxberty", noStore, requireAdmin, jsonOnly, async (request, response) => {
    let changes;
    try { changes = validateSxbertyPatch(request.body); }
    catch (error) { return response.status(400).json({ error: error.message }); }
    try {
      const settings = normalizeSxbertySettings(await update(changes));
      await audit(request, {
        action: "sxberty.settings",
        resourceType: "sxberty-settings",
        resourceId: "global",
        metadata: { phases: Object.keys(changes.phrases) }
      });
      response.json({ settings });
    } catch { unavailable(response); }
  });

  // The app-level JSON parser runs before these routes; keep its failures JSON
  // and uncacheable too, without exposing parser internals or submitted text.
  app.use("/api/admin/sxberty", (error, request, response, next) => {
    if (error.type !== "entity.parse.failed" && error.type !== "entity.too.large") return next(error);
    response.set("Cache-Control", "no-store");
    response.status(error.type === "entity.too.large" ? 413 : 400).json({ error: "Send a valid JSON request body" });
  });
}
