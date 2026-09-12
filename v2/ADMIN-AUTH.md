# Discord Admin Authentication and Activity Ledger

This document explains the v2 admin access flow and the audit trail used for protected site changes. It is safe to publish: all examples use placeholders and no real Discord IDs, client secrets, or API tokens belong here.

## Access flow

1. A browser requests `/admin`. The route is available from any IP address; there is no IP allowlist gate.
2. The admin shell checks `/api/auth/session`. If there is no valid session, the page shows **Continue with Discord**.
3. Discord sends the browser back to `DISCORD_OAUTH_REDIRECT_URI` after the user authorizes the `identify` scope.
4. The backend fetches the Discord profile, compares the Discord user ID with `DISCORD_ALLOWED_USER_IDS`, and records the result.
5. An approved user receives an HttpOnly server session cookie. The database stores only a hash of that session token.
6. Protected admin API calls use that session. The user-installed Discord app can use the internal API token and Discord identity headers for approved automation calls from its direct messages.

The frontend never talks directly to Postgres, Discord's client secret, or the internal API token. The backend is the only service that reads and writes the database and serves cached content to browsers.

## Discord application setup

Create or reuse a Discord application in the [Discord Developer Portal](https://discord.com/developers/applications). Under OAuth2, add the exact callback URL configured for the environment:

```text
# Vite development server
http://localhost:5173/api/auth/discord/callback

# Docker Compose app serving the built frontend
http://localhost:8787/api/auth/discord/callback

# Production (replace with the real HTTPS hostname)
https://admin.example.invalid/api/auth/discord/callback
```

The callback URL must match exactly, including the scheme, hostname, port, and path. The application uses Discord's authorization-code flow with the `identify` scope. Keep the client secret private and configure it only through the environment.

On the application's **Installation** page, enable **User Install**, add the `applications.commands` scope to the user install settings, and leave **Guild Install** disabled. The fanart commands are registered globally for the `USER_INSTALL` integration type and `BOT_DM` interaction context, so the app is used from its direct messages without being added to a server.

## Environment configuration

Copy `v2/.env.example` to a private environment file and replace every placeholder. Do not commit the populated file.

```dotenv
DISCORD_APPLICATION_ID=replace-with-discord-application-id
DISCORD_CLIENT_SECRET=replace-with-discord-oauth-client-secret
DISCORD_OAUTH_REDIRECT_URI=https://admin.example.invalid/api/auth/discord/callback
DISCORD_ALLOWED_USER_IDS=discord-user-id-1,discord-user-id-2
INTERNAL_API_TOKEN=replace-with-a-long-random-internal-token
AUTH_COOKIE_SECURE=true
ADMIN_SESSION_TTL_SECONDS=43200
WEBP_QUALITY=82
# Optional: set true only behind a trusted proxy to record forwarded client IPs in the ledger.
TRUST_PROXY=false
# API requests are limited per resolved client IP; these are the defaults.
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=120
AUTH_RATE_LIMIT_WINDOW_SECONDS=900
AUTH_RATE_LIMIT_MAX_REQUESTS=30
```

`DISCORD_ALLOWED_USER_IDS` is a comma-separated allowlist of Discord user IDs. It is the admin identity control now that the IP requirement has been removed. In production, use HTTPS and set `AUTH_COOKIE_SECURE=true` so browsers send the session cookie only over TLS.

The internal API token is for trusted service-to-service calls such as the Discord bot. It is not a browser login credential. Rotate it if a trusted service is replaced or the value may have been exposed.

The backend applies a fixed-window IP limiter to every `/api` route (120 requests per minute by default) and a stricter limiter to `/api/auth` (30 requests per 15 minutes by default). Rejected requests return HTTP `429`. These counters are held in the app process memory and reset when the container restarts; use a shared store before running multiple app replicas. The limiter uses Express's resolved `request.ip`, so enable `TRUST_PROXY` only behind a proxy you control.

## Admin behavior

- **Any IP address:** `/admin` loads the sign-in page without an IP check.
- **No session:** the admin page asks the visitor to sign in with Discord.
- **Discord ID not allowed:** the callback denies access, does not create a session, and writes a denied-login ledger entry.
- **Allowed Discord ID:** a server-side session is created and the admin page can use protected endpoints.
- **Logout:** the session is revoked and a logout entry is written.

The session cookie is HttpOnly and SameSite protected. Session records expire according to `ADMIN_SESSION_TTL_SECONDS`; expired sessions are rejected by the backend.

## Activity ledger

Every protected admin action is written to the `admin_activity` table. Entries include:

- UTC timestamp
- action name
- target/resource, when applicable
- Discord user ID and display name, when available
- source IP and user agent for audit context
- structured metadata for the operation

Current action names include:

```text
auth.login.success
auth.login.denied
auth.logout
fanart.upload
fanart.update
fanart.delete
```

Uploads and deletes from the user-installed Discord app include the invoking Discord identity from the internal request headers. This keeps automated changes attributable to the person who issued the command in the app's direct messages. The admin page exposes a read-only activity view for authorized users.

## API surface

Authentication endpoints:

```text
GET  /api/auth/session
GET  /api/auth/discord
GET  /api/auth/discord/callback
POST /api/auth/logout
```

Protected admin endpoints use the Discord session cookie or a trusted internal request:

```text
GET    /api/admin/activity
GET    /api/admin/fanart
POST   /api/admin/fanart
PATCH  /api/admin/fanart/:filename
DELETE /api/admin/fanart/:filename
```

The admin fanart list lets an authorized user edit each entry's title, description (100 characters maximum), and artist credit link. Descriptions support `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `__underline__`, and line breaks; the renderer escapes HTML before applying those formatting rules.

Each entry also has **Include in hourly embed rotation**, persisted by the floating **Save all** button. The protected listing includes `embedEligible`; the public listing omits it. `PATCH /api/admin/fanart/:filename` accepts a boolean `embedEligible` and records changes in the activity ledger. Newly uploaded images default to false. `/artoftheday.webp` serves only eligible images as 1200 × 300 crops, rotating hourly. No eligible images means HTTP 404. Crops are stored separately from originals; Discord may retain its own cached previews after an image changes.

## Fanart image variants

The backend keeps the uploaded original bytes in `fanart.image_data` and stores a generated WebP copy in `fanart.webp_data`. Public `/fanart/:filename` responses use the WebP copy and `image/webp` content type. The admin panel requests `/fanart/:filename?original=1`, which preserves the original PNG, JPEG, GIF, or WebP for review. Existing rows are converted lazily the first time they are requested publicly; new uploads are converted before they are stored. `WEBP_QUALITY` controls the generated quality from 1–100.

The compatibility endpoint `GET /api/admin/access` reports the current session state for the admin UI.

## Database and deployment notes

Postgres is attached only to the internal Compose network. It has no published host port, so public browsers and outside machines cannot connect to it. The app container is the database client and the only component that exposes API data to the site. Database TLS can be enabled when traffic leaves the private host or crosses a network boundary; for a single-host internal Compose network, network isolation and the absence of a published port are the primary controls.

Do not commit `.env` files, private keys, bot tokens, OAuth client secrets, database dumps, or local command scripts. The repository `.gitignore` blocks those common secret and command-file patterns; review `git status` before every push.

## Manual embed crops

Each admin fanart entry has a **Crop embed banner** button. The editor follows Cosmiq's profile banner interaction: drag the image inside a fixed 4:1 frame, zoom from 100% to 300%, reset the position, then **Use this crop** to stage the change. Arrow keys move the image (Shift moves faster); Escape or Cancel closes without saving. Reopening restores the pending position, or the saved position when no draft exists. **Use automatic crop** stages a return to automatic framing. Crops, eligibility, titles, descriptions and artist links are published only through the floating **Save all** button at the bottom right. There are no per-entry save buttons. Crop changes do not change eligibility.

The protected `PUT /api/admin/fanart/:filename/embed-crop` accepts `{ "crop": { "offsetX": 0, "offsetY": 0, "zoom": 1 } }`, or `{ "crop": null }` for automatic framing. Offsets use frame-height units. The server validates and clamps the geometry, renders a 1200 × 300 WebP from the original, and stores private `embed_crop` metadata with the separate cached banner. Original images and gallery WebP files remain unchanged. `GET /api/admin/fanart/:filename/crop-source` returns an oriented, static PNG for accurate editing of EXIF and animated sources. Both routes require admin authentication; crop changes are recorded as `fanart.crop` in the activity ledger. Public listings exclude crop settings.

## Drafts, descriptions, and artist credits

The admin keeps edits in memory until **Save all** is clicked. Reverting all fields hides the floating button. Saving sends only the changed fields for each artwork in a single authenticated `PATCH /api/admin/fanart/:filename`, including optional `embedCrop` and `creditUrl`; PostgreSQL commits each entry's metadata and rendered crop in one update. Successful entries leave the draft list; failed entries retain their drafts and display errors for retry. Refreshing the activity ledger does not reset drafts. Navigating away with unsaved changes triggers the browser's leave-page prompt.

`hoverMarkdown` remains the API field name for descriptions; new uploads and edited descriptions over 100 characters are rejected, including Discord uploads/edits. Existing descriptions are not silently truncated. `creditUrl` accepts an empty string or a full HTTP/HTTPS URL without embedded credentials. The public listing includes this artist URL, but never private crop or eligibility settings. Uploads and removals retain their dedicated actions. The older crop-only PUT endpoint remains supported; the admin uses combined PATCH saves, audited as `fanart.update` with the changed fields and crop metadata.
