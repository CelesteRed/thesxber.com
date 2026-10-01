import fs from "node:fs";
import path from "node:path";

// Register after static files, before the SPA fallback. Previously cached HTML
// can still reference v1 URLs or an entry bundle removed by a deployment.
export function registerSiteAssetRecovery(app, distDir) {
  function entry(extension) {
    const index = path.join(distDir, "index.html");
    if (!fs.existsSync(index)) return null;
    const match = fs.readFileSync(index, "utf8").match(new RegExp(`(?:src|href)="(/assets/index-[\\w-]+\\.${extension})"`));
    return match && fs.existsSync(path.join(distDir, match[1])) ? match[1] : null;
  }
  app.get("/script.js", (request, response) => {
    response.set("Cache-Control", "no-store").type("js").send(`
if (!document.getElementById("root")) {
  const freshPage = new URL("/", window.location.origin);
  freshPage.searchParams.set("site-version", "2");
  window.location.replace(freshPage.href);
}
`);
  });
  app.get("/style.css", (request, response) => {
    response.set("Cache-Control", "no-store");
    const css = entry("css");
    if (!css) return response.status(404).type("text").send("Stylesheet unavailable");
    // Keep v1's always-mounted dialogs hidden while its recovery script reloads.
    response.type("css").send(fs.readFileSync(path.join(distDir, css), "utf8") + "\nbody > .modal, body > .lightbox { display: none; }\n");
  });
  app.get(/^\/assets\/index-[\w-]+\.(js|css)$/, (request, response) => {
    response.set("Cache-Control", "no-store");
    const current = entry(request.params[0]);
    if (!current) return response.status(404).type("text").send("Site asset unavailable");
    response.redirect(302, current);
  });
  app.use("/assets", (request, response) => {
    response.set("Cache-Control", "no-store").status(404).type("text").send("Asset not found");
  });
}
