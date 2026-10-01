import express from "express";
import multer from "multer";
import { recordAdminActivity } from "./auth.js";
import { listSxbertyFoods, createSxbertyFood, updateSxbertyFood, deleteSxbertyFood, sxbertyFoodImage } from "./sxberty-foods.js";
import { SXBERTY_FOOD_MAX_BYTES, SXBERTY_FOOD_STAT_KEYS, toSxbertyFoodDto, validateSxbertyFoodCreate, validateSxbertyFoodPatch } from "../shared/sxberty-foods.js";

function multipartMetadata(body) {
  const result = { ...body };
  for (const key of SXBERTY_FOOD_STAT_KEYS) {
    if (typeof result[key] === "string" && /^(0|[1-9]\d{0,2})$/.test(result[key])) result[key] = Number(result[key]);
  }
  if (result.enabled === "true") result.enabled = true;
  else if (result.enabled === "false") result.enabled = false;
  return validateSxbertyFoodCreate(result);
}

export function registerSxbertyFoodRoutes(app, requireAdmin, {
  list = listSxbertyFoods, create = createSxbertyFood, update = updateSxbertyFood,
  remove = deleteSxbertyFood, image = sxbertyFoodImage, audit = recordAdminActivity
} = {}) {
  const noStore = (request, response, next) => { response.set("Cache-Control", "no-store"); next(); };
  const unavailable = response => response.status(503).json({ error: "Sxberty foods are temporarily unavailable" });
  const mutationError = (response, error) => [400, 404, 413].includes(error.status)
    ? response.status(error.status).json({ error: error.message }) : unavailable(response);
  const jsonOnly = (request, response, next) => request.is("application/json")
    ? next() : response.status(415).json({ error: "Send application/json" });
  const parseJson = express.json({ limit: "4kb" });
  const upload = multer({ storage: multer.memoryStorage(), limits: {
    fileSize: SXBERTY_FOOD_MAX_BYTES, files: 1, fields: 5, parts: 7, fieldSize: 400, fieldNameSize: 40
  } }).single("file");

  app.get("/api/sxberty-foods", async (request, response) => {
    response.set("Cache-Control", "no-cache");
    try { response.json({ items: (await list(false)).filter(item => item.enabled === true).map(item => toSxbertyFoodDto(item)) }); }
    catch { unavailable(response); }
  });
  app.get("/api/admin/sxberty-foods", noStore, requireAdmin, async (request, response) => {
    try { response.json({ items: (await list(true)).map(item => toSxbertyFoodDto(item, true)) }); }
    catch { unavailable(response); }
  });

  // Authentication deliberately precedes multipart parsing and allocation.
  app.post("/api/admin/sxberty-foods", noStore, requireAdmin, (request, response) => {
    if (!request.is("multipart/form-data")) return response.status(415).json({ error: "Send a multipart PNG upload" });
    upload(request, response, async error => {
      if (error) return response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: "Upload one PNG, 3 MB or smaller, with valid food metadata" });
      try {
        const changes = multipartMetadata(request.body);
        const item = toSxbertyFoodDto(await create(request.file?.buffer, changes), true);
        await audit(request, { action: "sxberty.food.upload", resourceType: "sxberty-food", resourceId: item.id,
          metadata: { name: item.name, fields: Object.keys(changes) } });
        response.status(201).json({ item });
      } catch (error) { mutationError(response, error); }
    });
  });
  app.patch("/api/admin/sxberty-foods/:id", noStore, requireAdmin, jsonOnly, parseJson, async (request, response) => {
    try {
      const changes = validateSxbertyFoodPatch(request.body);
      const item = toSxbertyFoodDto(await update(request.params.id, changes), true);
      await audit(request, { action: "sxberty.food.update", resourceType: "sxberty-food", resourceId: item.id,
        metadata: { name: item.name, fields: Object.keys(changes) } });
      response.json({ item });
    } catch (error) { mutationError(response, error); }
  });
  app.delete("/api/admin/sxberty-foods/:id", noStore, requireAdmin, async (request, response) => {
    try {
      const item = toSxbertyFoodDto(await remove(request.params.id), true);
      await audit(request, { action: "sxberty.food.delete", resourceType: "sxberty-food", resourceId: item.id, metadata: { name: item.name } });
      response.json({ ok: true });
    } catch (error) { mutationError(response, error); }
  });
  const sendImage = admin => async (request, response) => {
    response.set("Cache-Control", admin ? "no-store" : "no-cache");
    try {
      const item = await image(request.params.id, admin);
      if (!item) return response.status(404).json({ error: "Food not found" });
      response.set("X-Content-Type-Options", "nosniff").type("image/png").send(item.data);
    } catch (error) {
      if (error.status === 404) return response.status(404).json({ error: "Food not found" });
      unavailable(response);
    }
  };
  app.get("/api/sxberty-foods/:id/image", sendImage(false));
  app.get("/api/admin/sxberty-foods/:id/image", noStore, requireAdmin, sendImage(true));

  app.use("/api/admin/sxberty-foods", (error, request, response, next) => {
    if (error.type !== "entity.parse.failed" && error.type !== "entity.too.large") return next(error);
    response.set("Cache-Control", "no-store");
    response.status(error.type === "entity.too.large" ? 413 : 400).json({ error: "Send a valid JSON request body" });
  });
}
