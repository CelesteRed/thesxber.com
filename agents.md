# Repository guide

This repository contains two versions of thesxber.com:

- `v1/` is the original static HTML, CSS, and JavaScript site kept as a visual and behavior reference.
- `v2/` is the upgraded React/Vite frontend and Node/Express backend. The backend serves the built site, exposes the REST API, stores fanart and cached YouTube data in PostgreSQL, and runs the restricted user-installed Discord fanart app in direct messages.
- `infra/` contains public documentation only. Host deployment scripts, reverse-proxy manifests, firewall helpers, and other operational command files stay local and are ignored by the root `.gitignore`.

## v2 runtime

Run the complete local stack from `v2/` with Docker Compose:

```text
Copy-Item .env.example .env
docker compose up --build -d
```

The Compose stack contains one app container and one PostgreSQL container. The app is attached to the public and private Compose networks; PostgreSQL is attached only to the private internal network and has no published port. Fanart originals and generated WebP derivatives are stored as database binary data; public requests receive WebP while the admin panel can request the original with `?original=1`. The YouTube API key is used only by the backend; the backend stores the latest feed and refreshes it no more than once per 60 seconds before serving it to browsers. Same-host Compose database traffic uses `DATABASE_SSL=false`; enable TLS when using a remote or otherwise untrusted database network.
The backend rate-limits `/api` traffic by resolved client IP, with a stricter limit for `/api/auth`; configure the windows and request counts through the rate-limit variables in `v2/.env.example`. The current single-container limiter is in-memory and resets when the app restarts.
Fanart metadata includes a title, a description limited to 100 characters with escaped light Markdown, and an optional HTTP/HTTPS artist credit URL. The public hover card shows the title, linked to the artist when a URL is set; the description appears in the expanded viewer. Authorized admins can edit both fields through the panel or the Discord DM app; the database migration adds `fanart.hover_markdown` for existing installations.
The public gallery is a dedicated `/fanart` route in `v2/src/FanartPage.jsx`, with a native modal dialog for expanded images, titles and Markdown notes. Preserve keyboard navigation, touch browsing, focus restoration and responsive behavior when editing it.
Uploads are converted to WebP with `sharp` before they are stored; the original bytes remain available to the admin preview. `WEBP_QUALITY` controls conversion quality, and `FANART_WEBP_DIR` is used for generated files only in filesystem fallback mode.
Hourly link banners use `/artoftheday.webp` (alias `/api/artoftheday.webp`), generated as 1200 × 300 WebP from only fanart with the private `embed_eligible` flag. Admins check eligibility and save via the authenticated panel; changes are audited. Crops are cached separately in `embed_data`. New uploads default to unchecked, and an empty pool returns 404. Public fanart listings never expose this flag; the admin panel uses protected `GET /api/admin/fanart`.

## Access and secrets

Copy `v2/.env.example` to a private `v2/.env` and replace its placeholders. Never commit `.env`, API keys, bot tokens, database passwords, private keys, certificates, or host-specific deployment files. Configure the Discord application's OAuth redirect URI to match `DISCORD_OAUTH_REDIRECT_URI`. The `/admin` page is publicly reachable; admin upload/delete/activity actions require a Discord OAuth session for an ID in `DISCORD_ALLOWED_USER_IDS` (or the trusted internal API token for the bot). Every login, upload, removal, and logout is recorded in the database activity ledger, including source IP metadata. The Discord app is user-installed, accepts slash commands only in its direct messages, limits them to `DISCORD_ALLOWED_USER_IDS`, and calls the backend with the internal API token.

Keep changes to the public site in `v2/src/`, backend behavior in `v2/server/`, and container configuration in `v2/Dockerfile` and `v2/docker-compose.yml`. Preserve the v1 files when making visual comparisons.

## Manual embed crops

Each admin fanart entry has a **Crop embed banner** button. The editor follows Cosmiq's profile banner interaction: drag the image inside a fixed 4:1 frame, zoom from 100% to 300%, reset the position, then **Use this crop** to stage the change. Arrow keys move the image (Shift moves faster); Escape or Cancel closes without saving. Reopening restores the pending position, or the saved position when no draft exists. **Use automatic crop** stages a return to automatic framing. Crops, eligibility, titles, descriptions and artist links are published only through the floating **Save all** button at the bottom right. There are no per-entry save buttons. Crop changes do not change eligibility.

The protected `PUT /api/admin/fanart/:filename/embed-crop` accepts `{ "crop": { "offsetX": 0, "offsetY": 0, "zoom": 1 } }`, or `{ "crop": null }` for automatic framing. Offsets use frame-height units. The server validates and clamps the geometry, renders a 1200 × 300 WebP from the original, and stores private `embed_crop` metadata with the separate cached banner. Original images and gallery WebP files remain unchanged. `GET /api/admin/fanart/:filename/crop-source` returns an oriented, static PNG for accurate editing of EXIF and animated sources. Both routes require admin authentication; crop changes are recorded as `fanart.crop` in the activity ledger. Public listings exclude crop settings.

## Drafts, descriptions, and artist credits

The admin keeps edits in memory until **Save all** is clicked. Reverting all fields hides the floating button. Saving sends only the changed fields for each artwork in a single authenticated `PATCH /api/admin/fanart/:filename`, including optional `embedCrop` and `creditUrl`; PostgreSQL commits each entry's metadata and rendered crop in one update. Successful entries leave the draft list; failed entries retain their drafts and display errors for retry. Refreshing the activity ledger does not reset drafts. Navigating away with unsaved changes triggers the browser's leave-page prompt.

`hoverMarkdown` remains the API field name for descriptions; new uploads and edited descriptions over 100 characters are rejected, including Discord uploads/edits. Existing descriptions are not silently truncated. `creditUrl` accepts an empty string or a full HTTP/HTTPS URL without embedded credentials. The public listing includes this artist URL, but never private crop or eligibility settings. Uploads and removals retain their dedicated actions. The older crop-only PUT endpoint remains supported; the admin uses combined PATCH saves, audited as `fanart.update` with the changed fields and crop metadata.

## Floating emojis

`v2/server/emojis.js` stores floating emoji originals, animated WebP derivatives, and per-emoji quote/link configuration in the `floating_emojis` PostgreSQL table. Filesystem fallback uses ignored `v2/data/emojis/` (optional `EMOJI_STORAGE_DIR`). Routes in `emoji-routes.js` share the existing Discord admin authorization, IP rate limiter, and activity ledger. Public endpoints expose only enabled emojis; originals require admin access.

`v2/src/floating-emojis.js` runs the bounded animation loop, while `SiteCredit.jsx` handles fetch/cleanup, reduced motion, visitor visibility preference, and the plain GitHub footer credit. `EmojiAdminSection.jsx` integrates metadata edits into the existing floating Save all flow in `App.jsx`. Preserve drag-versus-click separation, safe Markdown rendering, modal isolation, and reduced-motion support. Run `npm run test:emojis` as well as `npm run test:embed` and `npm run build` from `v2/` when changing this behavior. The tests optionally accept a disposable `TEST_EMBED_DATABASE_URL` ending in `/sxber_embed_test`.

The emoji controller stores the global 0–30 count in `floating_emoji_settings` (filesystem fallback: `settings.json`). `/api/emojis` includes `settings.count`; `PATCH /api/admin/emoji-settings` uses the existing authorization and records `emoji.settings`. Controller edits share Save all under the `emoji-settings` draft key. Keep the animation’s performance ceiling at or below the configured count, including counts 0, 1 and 2; preserve reduced-motion and visitor hide preferences.
