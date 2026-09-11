# Repository guide

This repository contains two versions of thesxber.com:

- `v1/` is the original static HTML, CSS, and JavaScript site kept as a visual and behavior reference.
- `v2/` is the upgraded React/Vite frontend and Node/Express backend. The backend serves the built site, exposes the REST API, stores fanart and cached YouTube data in PostgreSQL, and runs the restricted Discord fanart bot.
- `infra/` contains public documentation only. Host deployment scripts, reverse-proxy manifests, firewall helpers, and other operational command files stay local and are ignored by the root `.gitignore`.

## v2 runtime

Run the complete local stack from `v2/` with Docker Compose:

```text
Copy-Item .env.example .env
docker compose up --build -d
```

The Compose stack contains one app container and one PostgreSQL container. The app is attached to the public and private Compose networks; PostgreSQL is attached only to the private internal network and has no published port. Fanart images are stored as database binary data. The YouTube API key is used only by the backend; the backend stores the latest feed and refreshes it no more than once per 60 seconds before serving it to browsers. Same-host Compose database traffic uses `DATABASE_SSL=false`; enable TLS when using a remote or otherwise untrusted database network.

## Access and secrets

Copy `v2/.env.example` to a private `v2/.env` and replace its placeholders. Never commit `.env`, API keys, bot tokens, database passwords, private keys, certificates, or host-specific deployment files. The `/admin` page and upload/delete API require an IP in `ADMIN_ALLOWED_IPS`; write operations also require the admin token. Discord commands are limited to `DISCORD_ALLOWED_USER_IDS` and call the backend with the internal API token.

Keep changes to the public site in `v2/src/`, backend behavior in `v2/server/`, and container configuration in `v2/Dockerfile` and `v2/docker-compose.yml`. Preserve the v1 files when making visual comparisons.
