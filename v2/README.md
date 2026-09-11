# thesxber.com v2

This is the React version of the original `v1` site. The public route keeps the same green full-screen layout, carousel behavior, social dock, contact modal, fanart gallery, lightbox, and click sound. The code uses plain JSX, JavaScript, and CSS without a component library. A single Node service serves the frontend and REST API; PostgreSQL stores fanart binaries and the cached YouTube rows.

## Local setup

```powershell
cd v2
npm install
Copy-Item .env.example .env
# Edit .env with the YouTube, admin, and Discord values you want to use.
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:8787`. If `DATABASE_URL` is empty, local development falls back to the existing filesystem fanart and an in-memory YouTube cache. The Docker setup below enables the persistent database.

## Docker Compose

From this directory, copy `.env.example` to `.env`, set the database password and application secrets, then run:

```powershell
docker compose up --build -d
```

The app is available at `http://localhost:8787`. PostgreSQL persists in the `sxber-postgres` volume. On the first boot, the existing `public/fanart` files are imported into the `fanart` table. New uploads are stored as `bytea` data in PostgreSQL, so the app container does not need SFTP or a writable image directory.

If `YOUTUBE_API_KEY` is empty, the carousel uses the same style of demo tiles as v1. When configured, the backend requests the YouTube API and stores the latest 20 videos in PostgreSQL. Every browser reads `/api/youtube`; the backend refreshes the cache at most once per `YOUTUBE_CACHE_TTL_SECONDS` (60 seconds by default), so API keys and quota are never used per browser.

The REST surface is intentionally small: `GET /api/health`, `GET /api/youtube`, `GET /api/fanart`, `GET /fanart/:filename`, and protected `POST`/`DELETE /api/admin/fanart` endpoints. The Discord bot calls those protected endpoints instead of writing files directly.

## Fanart updates

The Discord bot registers these commands:

- `/fanart-upload file:<image> title:<optional>` saves a new image in the fanart directory.
- `/fanart-list` lists published files.
- `/fanart-remove filename:<fanartN.ext>` removes a file.

Every command checks `DISCORD_ALLOWED_USER_IDS` before doing anything. The bot accepts JPG, PNG, WEBP, and GIF files up to 15 MB. It writes a small metadata file next to the app and the public gallery reads the API automatically, so a new upload appears without a frontend rebuild or SFTP step.

The optional browser panel is available at `http://localhost:5173/admin`. It uses the same `ADMIN_API_TOKEN` as the protected API upload/delete endpoints.

Admin access is also restricted by `ADMIN_ALLOWED_IPS`. Enter comma-separated client IPs in `.env`; requests from other IPs are redirected away from `/admin`, and the server rejects their admin API requests. The committed `.env.example` uses the documentation-only addresses `203.0.113.10` and `198.51.100.25`, so replace them with the real allowlist in your private `.env`. If a trusted reverse proxy sits in front of Node, set `TRUST_PROXY=true` so Express reads the forwarded client IP. Only enable that when the proxy is controlled by you.

## Production

```powershell
npm run build
npm start
```

Run this Node process alongside PostgreSQL, or use Docker Compose. Keep `.env` outside version control. For an existing database, set `DATABASE_URL`; set `DATABASE_SSL=true` when your provider requires TLS. The filesystem `FANART_DIR` is only a seed/fallback path when no database URL is configured.
