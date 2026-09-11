# thesxber.com v2

This is the React version of the original `v1` site. The public route keeps the same green full-screen layout, carousel behavior, social dock, contact modal, fanart gallery, lightbox, and click sound. The code uses plain JSX, JavaScript, and CSS without a component library.

## Local setup

```powershell
cd v2
npm install
Copy-Item .env.example .env
# Edit .env with the YouTube, admin, and Discord values you want to use.
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:8787`.

If `YOUTUBE_API_KEY` is empty, the carousel uses the same style of demo tiles as v1. The real feed is loaded server-side when the key and channel ID are configured, so the YouTube key is not shipped to the browser.

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

Run this Node process on the host that owns the persistent `FANART_DIR`. It serves the Vite build, the API, the uploaded images, and the Discord bot together. Keep `.env` outside version control and use a persistent disk for `public/fanart` (or point `FANART_DIR` at one).
