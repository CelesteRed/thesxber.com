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
Fanart metadata includes a title and escaped light Markdown for the public hover tag. Authorized admins can edit both fields through the panel or the Discord DM app; the database migration adds `fanart.hover_markdown` for existing installations.
The public gallery is a dedicated `/fanart` route in `v2/src/FanartPage.jsx`, with a native modal dialog for expanded images, titles and Markdown notes. Preserve keyboard navigation, touch browsing, focus restoration and responsive behavior when editing it.
Uploads are converted to WebP with `sharp` before they are stored; the original bytes remain available to the admin preview. `WEBP_QUALITY` controls conversion quality, and `FANART_WEBP_DIR` is used for generated files only in filesystem fallback mode.
Hourly link banners use `/artoftheday.webp` (alias `/api/artoftheday.webp`), generated as 1200 × 300 WebP from only fanart with the private `embed_eligible` flag. Admins check eligibility and save via the authenticated panel; changes are audited. Crops are cached separately in `embed_data`. New uploads default to unchecked, and an empty pool returns 404. Public fanart listings never expose this flag; the admin panel uses protected `GET /api/admin/fanart`.

## Access and secrets

Copy `v2/.env.example` to a private `v2/.env` and replace its placeholders. Never commit `.env`, API keys, bot tokens, database passwords, private keys, certificates, or host-specific deployment files. Configure the Discord application's OAuth redirect URI to match `DISCORD_OAUTH_REDIRECT_URI`. The `/admin` page is publicly reachable; admin upload/delete/activity actions require a Discord OAuth session for an ID in `DISCORD_ALLOWED_USER_IDS` (or the trusted internal API token for the bot). Every login, upload, removal, and logout is recorded in the database activity ledger, including source IP metadata. The Discord app is user-installed, accepts slash commands only in its direct messages, limits them to `DISCORD_ALLOWED_USER_IDS`, and calls the backend with the internal API token.

Keep changes to the public site in `v2/src/`, backend behavior in `v2/server/`, and container configuration in `v2/Dockerfile` and `v2/docker-compose.yml`. Preserve the v1 files when making visual comparisons.
