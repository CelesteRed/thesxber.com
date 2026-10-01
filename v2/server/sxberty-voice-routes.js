import express from "express";
import multer from "multer";
import { recordAdminActivity } from "./auth.js";
import { listSxbertyVoices, createSxbertyVoice, updateSxbertyVoice, deleteSxbertyVoice, sxbertyVoiceAudio } from "./sxberty-voices.js";
import { SXBERTY_VOICE_MAX_BYTES, toSxbertyVoiceDto, validateSxbertyVoiceCreate, validateSxbertyVoicePatch } from "../shared/sxberty-voices.js";

function multipartMetadata(body) {
  const result = { ...body };
  if (result.enabled === "true") result.enabled = true;
  else if (result.enabled === "false") result.enabled = false;
  return validateSxbertyVoiceCreate(result);
}
function byteRange(header, length) {
  if (typeof header !== "string" || header.length > 100) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    return { start: Math.max(0, length - suffix), end: length - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= length || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, length - 1) };
}
export function registerSxbertyVoiceRoutes(app, requireAdmin, {
  list = listSxbertyVoices, create = createSxbertyVoice, update = updateSxbertyVoice,
  remove = deleteSxbertyVoice, audio = sxbertyVoiceAudio, audit = recordAdminActivity
} = {}) {
  const noStore = (request, response, next) => { response.set("Cache-Control", "no-store"); next(); };
  const unavailable = response => response.status(503).json({ error: "Sxberty voices are temporarily unavailable" });
  const mutationError = (response, error) => [400, 404, 413].includes(error.status)
    ? response.status(error.status).json({ error: error.message }) : unavailable(response);
  const jsonOnly = (request, response, next) => request.is("application/json") ? next() : response.status(415).json({ error: "Send application/json" });
  const parseJson = express.json({ limit: "4kb" });
  const upload = multer({ storage: multer.memoryStorage(), limits: {
    fileSize: SXBERTY_VOICE_MAX_BYTES, files: 1, fields: 4, parts: 6, fieldSize: 640, fieldNameSize: 40
  } }).single("file");

  app.get("/api/sxberty-voices", async (request, response) => {
    response.set("Cache-Control", "no-cache");
    try { response.json({ items: (await list(false)).filter(item => item.enabled === true).map(item => toSxbertyVoiceDto(item)) }); }
    catch { unavailable(response); }
  });
  app.get("/api/admin/sxberty-voices", noStore, requireAdmin, async (request, response) => {
    try { response.json({ items: (await list(true)).map(item => toSxbertyVoiceDto(item, true)) }); }
    catch { unavailable(response); }
  });
  // Both authentication and the global API limiter precede any body parser.
  app.post("/api/admin/sxberty-voices", noStore, requireAdmin, (request, response) => {
    if (!request.is("multipart/form-data")) return response.status(415).json({ error: "Send a multipart MP3 upload" });
    upload(request, response, async error => {
      if (error) return response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: "Upload one MP3, 5 MB or smaller, with valid voice metadata" });
      try {
        const changes = multipartMetadata(request.body);
        const item = toSxbertyVoiceDto(await create(request.file?.buffer, changes), true);
        await audit(request, { action: "sxberty.voice.upload", resourceType: "sxberty-voice", resourceId: item.id,
          metadata: { name: item.name, fields: Object.keys(changes) } });
        response.status(201).json({ item });
      } catch (error) { mutationError(response, error); }
    });
  });
  app.patch("/api/admin/sxberty-voices/:id", noStore, requireAdmin, jsonOnly, parseJson, async (request, response) => {
    try {
      const changes = validateSxbertyVoicePatch(request.body);
      const item = toSxbertyVoiceDto(await update(request.params.id, changes), true);
      await audit(request, { action: "sxberty.voice.update", resourceType: "sxberty-voice", resourceId: item.id,
        metadata: { name: item.name, fields: Object.keys(changes) } });
      response.json({ item });
    } catch (error) { mutationError(response, error); }
  });
  app.delete("/api/admin/sxberty-voices/:id", noStore, requireAdmin, async (request, response) => {
    try {
      const item = toSxbertyVoiceDto(await remove(request.params.id), true);
      await audit(request, { action: "sxberty.voice.delete", resourceType: "sxberty-voice", resourceId: item.id, metadata: { name: item.name } });
      response.json({ ok: true });
    } catch (error) { mutationError(response, error); }
  });
  const sendAudio = admin => async (request, response) => {
    response.set("Cache-Control", admin ? "no-store" : "no-cache");
    try {
      const item = await audio(request.params.id, admin);
      if (!item) return response.status(404).json({ error: "Voice not found" });
      response.set({ "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
      // No validators are emitted; an If-Range request gets the full body.
      const header = request.get("range");
      if (request.method === "GET" && header && !request.get("if-range")) {
        const range = byteRange(header, item.data.length);
        if (!range) return response.status(416).set("Content-Range", `bytes */${item.data.length}`).end();
        return response.status(206).set("Content-Range", `bytes ${range.start}-${range.end}/${item.data.length}`)
          .type("audio/mpeg").send(item.data.subarray(range.start, range.end + 1));
      }
      response.type("audio/mpeg").send(item.data);
    } catch (error) {
      if (error.status === 404) return response.status(404).json({ error: "Voice not found" });
      unavailable(response);
    }
  };
  app.get("/api/sxberty-voices/:id/audio", sendAudio(false));
  app.get("/api/admin/sxberty-voices/:id/audio", noStore, requireAdmin, sendAudio(true));
  app.use("/api/admin/sxberty-voices", (error, request, response, next) => {
    if (error.type !== "entity.parse.failed" && error.type !== "entity.too.large") return next(error);
    response.set("Cache-Control", "no-store");
    response.status(error.type === "entity.too.large" ? 413 : 400).json({ error: "Send a valid JSON request body" });
  });
}
