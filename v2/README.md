# thesxber.com v2

This is the React version of the original `v1` site. The public route keeps the same green full-screen layout, carousel behavior, social dock, contact modal, fanart gallery, lightbox, and click sound. The code uses plain JSX, JavaScript, and CSS without a component library. A single Node service serves the frontend and REST API; PostgreSQL stores fanart binaries and the cached YouTube rows. The Discord integration is a user-installed app whose slash commands run in its direct messages.

## Local setup

```powershell
cd v2
npm install
Copy-Item .env.example .env
# Edit .env with the YouTube, OAuth, database, and Discord values you want to use.
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:8787`. If `DATABASE_URL` is empty, local development falls back to the existing filesystem fanart and an in-memory YouTube cache. The Docker setup below enables the persistent database.

## Docker Compose

From this directory, copy `.env.example` to `.env`, set the database password and application secrets, then run:

```powershell
docker compose up --build -d
```

The app is available at `http://localhost:8787`. PostgreSQL persists in the `sxber-postgres` volume. The database has no published host port and is attached only to Compose's internal `database` network; the app is the only service connected to that network. On the first boot, the existing `public/fanart` files are imported into the `fanart` table. New uploads are stored as `bytea` data in PostgreSQL, so the app container does not need SFTP or a writable image directory.

For this same-host, private Docker network, PostgreSQL does not need TLS between the app and database, so `DATABASE_SSL=false` is the expected setting. If the database is moved to another host or crosses a network you do not fully control, enable `DATABASE_SSL=true` and use a TLS-capable PostgreSQL endpoint. Do not add a `ports` mapping to the `db` service; browsers should call the app's HTTP API, never PostgreSQL directly.

If `YOUTUBE_API_KEY` is empty, the carousel uses the same style of demo tiles as v1. When configured, the backend requests the YouTube API and stores the latest 20 videos in PostgreSQL. Every browser reads `/api/youtube`; the backend refreshes the cache at most once per `YOUTUBE_CACHE_TTL_SECONDS` (60 seconds by default), so API keys and quota are never used per browser.

The REST surface is intentionally small: `GET /api/health`, `GET /api/youtube`, `GET /api/fanart`, `GET /fanart/:filename`, Discord OAuth session/login/logout endpoints, and protected `POST`/`DELETE /api/admin/fanart` plus `GET /api/admin/activity` endpoints. The browser never receives database credentials or calls PostgreSQL directly.

All `/api` requests are rate-limited per resolved client IP. The defaults allow 120 requests per 60 seconds, while `/api/auth` uses a stricter limit of 30 requests per 15 minutes. A rejected request receives HTTP `429` with `Retry-After` and `RateLimit-*` headers. Configure the windows and limits with `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX_REQUESTS`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`, and `AUTH_RATE_LIMIT_MAX_REQUESTS`. The limiter uses the same Express `request.ip` value as the activity ledger; set `TRUST_PROXY=true` only when a trusted reverse proxy sanitizes forwarded IP headers. The current single-container deployment uses an in-memory store, so limits reset when the app restarts and are not shared across multiple app replicas.

## Fanart updates

The Discord app registers these commands in its direct messages:

- `/fanart-upload file:<image> title:<optional>` saves a new image in PostgreSQL.
- `/fanart-list` lists published files.
- `/fanart-remove filename:<fanartN.ext>` removes a file.

Every command checks `DISCORD_ALLOWED_USER_IDS` before doing anything. The app accepts JPG, PNG, WEBP, and GIF files up to 15 MB. It calls the backend with `INTERNAL_API_TOKEN`, and upload/removal actions are written to the activity ledger with the invoking Discord user ID.

On the Discord Developer Portal's **Installation** page, enable **User Install**, add the `applications.commands` scope to the user install settings, and leave **Guild Install** disabled. The backend registers global slash commands with the `USER_INSTALL` integration type and `BOT_DM` interaction context, so no guild ID or server invite is required. Install the app to your own Discord account, open its DM, and use `/fanart-upload`, `/fanart-list`, or `/fanart-remove`.

The browser panel is available at `http://localhost:5173/admin` during Vite development or at the Compose app URL in production. It redirects to Discord OAuth2, then creates an HTTP-only server session only when the returned Discord user ID appears in `DISCORD_ALLOWED_USER_IDS`; there is no IP allowlist gate. The panel shows recent activity, including the Discord account, action, target, timestamp, and source IP. Set `DISCORD_APPLICATION_ID`, `DISCORD_CLIENT_SECRET`, and the exact registered `DISCORD_OAUTH_REDIRECT_URI` in the private `.env`; use the Vite URL when running the separate dev server and the public app URL for Compose. Set `AUTH_COOKIE_SECURE=true` when the app is served over HTTPS. If a trusted reverse proxy sits in front of Node, set `TRUST_PROXY=true` so the activity ledger records the forwarded client IP; only enable that when the proxy is controlled by you.

## Production

```powershell
npm run build
npm start
```

Run this Node process alongside PostgreSQL, or use Docker Compose. Keep `.env` outside version control. For an existing database, set `DATABASE_URL`; set `DATABASE_SSL=true` when your provider requires TLS. The filesystem `FANART_DIR` is only a seed/fallback path when no database URL is configured.
