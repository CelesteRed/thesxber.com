# thesxber.com v2

This is the React version of the original `v1` site. The public route keeps the same green full-screen layout, carousel behavior, social dock, contact modal, fanart gallery, lightbox, and click sound. The code uses plain JSX, JavaScript, and CSS without a component library. A single Node service serves the frontend and REST API; PostgreSQL stores the original fanart binaries, their WebP derivatives, and the cached YouTube rows. The Discord integration is a user-installed app whose slash commands run in its direct messages.

## Local setup

The site has no visible developer credit. Successful public JSON responses from `/api/health`, `/api/youtube`, `/api/fanart`, and `/api/emojis` include a top-level `notes` field: "Contact @CelesteRed on discord if any problems found on the site!" This contact message lives in `shared/api-notes.js` and is available to anyone inspecting the API; the frontend does not render it.

```powershell
cd v2
npm install
Copy-Item .env.example .env
# Edit .env with the YouTube, OAuth, database, and Discord values you want to use.
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:8787`. If `DATABASE_URL` is empty, local development falls back to the existing filesystem fanart and a persistent JSON YouTube cache. The Docker setup below enables the persistent database.

## Docker Compose

From this directory, copy `.env.example` to `.env`, set the database password and application secrets, then run:

```powershell
docker compose up --build -d
```

The app is available at `http://localhost:8787`. PostgreSQL persists in the `sxber-postgres` volume. The database has no published host port and is attached only to Compose's internal `database` network; the app is the only service connected to that network. On the first boot, the existing `public/fanart` files are imported into the `fanart` table and converted to WebP. New uploads keep their original bytes (including PNG) alongside a WebP derivative in PostgreSQL, so the app container does not need SFTP or a writable image directory.

For this same-host, private Docker network, PostgreSQL does not need TLS between the app and database, so `DATABASE_SSL=false` is the expected setting. If the database is moved to another host or crosses a network you do not fully control, enable `DATABASE_SSL=true` and use a TLS-capable PostgreSQL endpoint. Do not add a `ports` mapping to the `db` service; browsers should call the app's HTTP API, never PostgreSQL directly.

If `YOUTUBE_API_KEY` is empty, the local feed is unconfigured and the homepage displays no demo tiles. For real data during local preview, set `YOUTUBE_PREVIEW_ORIGIN=https://thesxber.com` to read the existing live public video feed. When configured, the backend reads the channel uploads playlist using `channels.list` and `playlistItems.list`, caches its public videos, and serves the 20 latest visible uploads per format through `/api/youtube`. The homepage separates landscape Videos and portrait Shorts; formats are detected automatically, with optional Homepage shelf overrides in the Videos admin section. Public requests only read the cache. Automatic syncs run hourly (`YOUTUBE_CACHE_TTL_SECONDS=3600`, with a one-hour minimum even when an older environment sets 60). The scheduler checks for due work every minute without making a YouTube request until due. See [VIDEOS.md](VIDEOS.md) for admin controls, cooldowns and storage.

The REST surface also includes public `GET /api/live` plus protected `GET`/`PATCH /api/admin/live`. Twitch uses client credentials saved securely by administrators in the authenticated Live tracking panel; the client secret is never returned by the API. The panel also controls the Helix polling interval (60–86,400 seconds), while Twitch account login remains a separate setting. TikTok stores a handle and an explicit manual live toggle/title because no documented public live-status API exists. Provider failures retain the previous Twitch result and mark it stale rather than reporting false offline status. If Twitch credentials are absent, tracking remains unavailable until they are configured.

Public requests to `/fanart/:filename` return the cached WebP derivative with `Content-Type: image/webp`. The admin list uses `/fanart/:filename?original=1`, so PNG, JPEG, GIF, or uploaded WebP originals remain available. Existing database rows without a derivative are converted on their first public request and then cached. Set `WEBP_QUALITY` from 1–100 (82 by default). Filesystem fallback mode stores generated derivatives under `FANART_WEBP_DIR`.

All `/api` requests are rate-limited per resolved client IP. The defaults allow 120 requests per 60 seconds, while `/api/auth` uses a stricter limit of 30 requests per 15 minutes. A rejected request receives HTTP `429` with `Retry-After` and `RateLimit-*` headers. Configure the windows and limits with `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX_REQUESTS`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`, and `AUTH_RATE_LIMIT_MAX_REQUESTS`. The limiter uses the same Express `request.ip` value as the activity ledger; set `TRUST_PROXY=true` only when a trusted reverse proxy sanitizes forwarded IP headers. The current single-container deployment uses an in-memory store, so limits reset when the app restarts and are not shared across multiple app replicas.

## Fanart updates

The homepage palette icon opens the dedicated `/fanart` page. Clicking a thumbnail opens the full WebP image with its title and Markdown notes. Visitors can browse using previous/next buttons, Left/Right keys or touch swipes, and close with Escape, the close button or the backdrop. Hover cards show only the title, linked to the artist credit URL when set. Descriptions appear in the expanded viewer. See [FANART-PAGE.md](FANART-PAGE.md) for the reference and behavior details.

The Discord app registers these commands in its direct messages:

- `/fanart-upload file:<image> title:<optional> hover:<optional-markdown>` saves a new image in PostgreSQL.
- `/fanart-list` lists published files.
- `/fanart-edit filename:<fanartN.ext> title:<optional> hover:<optional-markdown>` updates an existing entry.
- `/fanart-remove filename:<fanartN.ext>` removes a file.

Every command checks `DISCORD_ALLOWED_USER_IDS` before doing anything. The app accepts JPG, PNG, WEBP, and GIF files up to 15 MB. It calls the backend with `INTERNAL_API_TOKEN`, and upload/removal/update actions are written to the activity ledger with the invoking Discord user ID. Upload conversion happens before the original is saved, so a successful upload always has a WebP derivative.

Each public fanart tile shows its title on mouse or keyboard focus. If an artist credit link is set, the title is a keyboard-accessible HTTP/HTTPS hyperlink that opens in a new tab. Descriptions are shown only in the expanded viewer. The tag follows the compact translucent speech-bubble treatment used by `sylve.love` and descriptions support `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `__underline__`, and line breaks. Markdown is escaped before the supported formatting is applied, so admin-authored tags cannot inject HTML.

On the Discord Developer Portal's **Installation** page, enable **User Install**, add the `applications.commands` scope to the user install settings, and leave **Guild Install** disabled. The backend registers global slash commands with the `USER_INSTALL` integration type and `BOT_DM` interaction context, so no guild ID or server invite is required. Install the app to your own Discord account, open its DM, and use `/fanart-upload`, `/fanart-list`, `/fanart-edit`, or `/fanart-remove`.

The browser panel is available at `http://localhost:5173/admin` during Vite development or at the Compose app URL in production. It redirects to Discord OAuth2, then creates an HTTP-only server session only when the returned Discord user ID appears in `DISCORD_ALLOWED_USER_IDS`; there is no IP allowlist gate. The panel shows recent activity, including the Discord account, action, target, timestamp, and source IP. Set `DISCORD_APPLICATION_ID`, `DISCORD_CLIENT_SECRET`, and the exact registered `DISCORD_OAUTH_REDIRECT_URI` in the private `.env`; use the Vite URL when running the separate dev server and the public app URL for Compose. Set `AUTH_COOKIE_SECURE=true` when the app is served over HTTPS. If a trusted reverse proxy sits in front of Node, set `TRUST_PROXY=true` so the activity ledger records the forwarded client IP; only enable that when the proxy is controlled by you.

## Production

The initial HTML includes [Open Graph](https://ogp.me/) link-preview metadata with Sxber's introduction and an hourly rotating 4:1 banner. In `/admin`, check **Include in hourly embed rotation** on each eligible piece and click **Save changes**. New uploads are unchecked by default. `GET /artoftheday.webp` (also `/api/artoftheday.webp`) selects only checked images in ID order, cycling at each UTC hour boundary. A single checked piece stays selected; none returns HTTP 404 rather than using an unchecked piece.

The backend crops the selected original to 1200 × 300 with Sharp's attention-based cover crop and caches the WebP separately in `fanart.embed_data` (or `FANART_WEBP_DIR` for filesystem fallback). It preserves original files and gallery WebPs. Admin flags are available only from protected `GET /api/admin/fanart`; `PATCH` changes are logged with the new boolean value. The image response requires cache revalidation, and the HTML image URL includes an hourly version. Third-party services such as Discord control their own preview caching: this does not update existing posted messages on an hourly schedule or force Discord's display dimensions.

The backend resolves absolute image/page URLs using `PUBLIC_SITE_URL` when set, or the request origin for raw-IP hosting. Set `PUBLIC_SITE_URL=https://your-domain.example` when moving behind a production proxy. Run `npm run test:embed` for isolated filesystem tests; setting `TEST_EMBED_DATABASE_URL` to a disposable database named `sxber_embed_test` runs the same checks against PostgreSQL.

```powershell
npm run build
npm start
```

Run this Node process alongside PostgreSQL, or use Docker Compose. Keep `.env` outside version control. For an existing database, set `DATABASE_URL`; set `DATABASE_SSL=true` when your provider requires TLS. The filesystem `FANART_DIR` is only a seed/fallback path when no database URL is configured, and `FANART_WEBP_DIR` controls its generated WebP cache.

## Manual embed crops

Each admin fanart entry has a **Crop embed banner** button. The editor follows Cosmiq's profile banner interaction: drag the image inside a fixed 4:1 frame, zoom from 100% to 300%, reset the position, then **Use this crop** to stage the change. Arrow keys move the image (Shift moves faster); Escape or Cancel closes without saving. Reopening restores the pending position, or the saved position when no draft exists. **Use automatic crop** stages a return to automatic framing. Crops, eligibility, titles, descriptions and artist links are published only through the floating **Save all** button at the bottom right. There are no per-entry save buttons. Crop changes do not change eligibility.

The protected `PUT /api/admin/fanart/:filename/embed-crop` accepts `{ "crop": { "offsetX": 0, "offsetY": 0, "zoom": 1 } }`, or `{ "crop": null }` for automatic framing. Offsets use frame-height units. The server validates and clamps the geometry, renders a 1200 × 300 WebP from the original, and stores private `embed_crop` metadata with the separate cached banner. Original images and gallery WebP files remain unchanged. `GET /api/admin/fanart/:filename/crop-source` returns an oriented, static PNG for accurate editing of EXIF and animated sources. Both routes require admin authentication; crop changes are recorded as `fanart.crop` in the activity ledger. Public listings exclude crop settings.

## Drafts, descriptions, and artist credits

The admin keeps edits in memory until **Save all** is clicked. Reverting all fields hides the floating button. Saving sends only the changed fields for each artwork in a single authenticated `PATCH /api/admin/fanart/:filename`, including optional `embedCrop` and `creditUrl`; PostgreSQL commits each entry's metadata and rendered crop in one update. Successful entries leave the draft list; failed entries retain their drafts and display errors for retry. Refreshing the activity ledger does not reset drafts. Navigating away with unsaved changes triggers the browser's leave-page prompt.

`hoverMarkdown` remains the API field name for descriptions; new uploads and edited descriptions over 100 characters are rejected, including Discord uploads/edits. Existing descriptions are not silently truncated. `creditUrl` accepts an empty string or a full HTTP/HTTPS URL without embedded credentials. The public listing includes this artist URL, but never private crop or eligibility settings. Uploads and removals retain their dedicated actions. The older crop-only PUT endpoint remains supported; the admin uses combined PATCH saves, audited as `fanart.update` with the changed fields and crop metadata.
# Cached-page recovery

Page HTML uses `Cache-Control: no-store`. `server/site-assets.js` keeps cached v1 pages recoverable: `/style.css` serves the current styles, and `/script.js` replaces the old page with a fresh v2 URL. Missing old `index-*.js` and `index-*.css` entry URLs redirect to the current build entry; unrelated missing `/assets` paths return 404 instead of HTML. Register recovery after static files and before the SPA fallback. Run `npm run test:site` when changing this behavior.
