import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { liveYouTubePreview } from "./server/youtube-preview.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy = {
      "/api": "http://localhost:8787",
      "/fanart": "http://localhost:8787"
  };
  return {
    plugins: [react(), ...(env.YOUTUBE_PREVIEW_ORIGIN ? [liveYouTubePreview(env.YOUTUBE_PREVIEW_ORIGIN)] : [])],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy }
  };
});
