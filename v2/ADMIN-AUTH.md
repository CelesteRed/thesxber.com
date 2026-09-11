# Discord Admin Authentication and Activity Ledger

This document explains the v2 admin access flow and the audit trail used for protected site changes. It is safe to publish: all examples use placeholders and no real Discord IDs, IP addresses, client secrets, or API tokens belong here.

## Access flow

1. A browser requests `/admin`.
2. The server checks `ADMIN_ALLOWED_IPS`. A request from an address outside that list is redirected to `/`.
3. An allowed address receives the admin shell. If there is no valid session, the page shows **Continue with Discord**.
4. Discord sends the browser back to `DISCORD_OAUTH_REDIRECT_URI` after the user authorizes the `identify` scope.
5. The backend fetches the Discord profile, compares the Discord user ID with `DISCORD_ALLOWED_USER_IDS`, and records the result.
6. An approved user receives an HttpOnly server session cookie. The database stores only a hash of that session token.
7. Protected admin API calls use that session. The Discord bot can use the internal API token and Discord identity headers for approved automation calls.

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

## Environment configuration

Copy `v2/.env.example` to a private environment file and replace every placeholder. Do not commit the populated file.

```dotenv
DISCORD_APPLICATION_ID=replace-with-discord-application-id
DISCORD_CLIENT_SECRET=replace-with-discord-oauth-client-secret
DISCORD_OAUTH_REDIRECT_URI=https://admin.example.invalid/api/auth/discord/callback
DISCORD_ALLOWED_USER_IDS=discord-user-id-1,discord-user-id-2
ADMIN_ALLOWED_IPS=203.0.113.10,2001:db8::10
INTERNAL_API_TOKEN=replace-with-a-long-random-internal-token
AUTH_COOKIE_SECURE=true
ADMIN_SESSION_TTL_SECONDS=43200
```

`DISCORD_ALLOWED_USER_IDS` is a comma-separated allowlist of Discord user IDs. `ADMIN_ALLOWED_IPS` accepts comma-separated IPv4 or IPv6 addresses. Keep both lists as narrow as practical. In production, use HTTPS and set `AUTH_COOKIE_SECURE=true` so browsers send the session cookie only over TLS.

The internal API token is for trusted service-to-service calls such as the Discord bot. It is not a browser login credential. Rotate it if a trusted service is replaced or the value may have been exposed.

## Admin behavior

- **Wrong IP:** `/admin` redirects to `/`; API requests from a disallowed address receive a forbidden response.
- **Allowed IP, no session:** the admin page shows the Discord login action.
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
- source IP and user agent
- structured metadata for the operation

Current action names include:

```text
auth.login.success
auth.login.denied
auth.logout
fanart.upload
fanart.delete
```

Uploads and deletes from the Discord bot include the invoking Discord identity from the internal request headers. This keeps automated changes attributable to the person who issued the bot command. The admin page exposes a read-only activity view for authorized users.

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
POST   /api/fanart
DELETE /api/fanart/:id
```

The compatibility endpoint `GET /api/admin/access` reports the current IP/session access state for the admin UI.

## Database and deployment notes

Postgres is attached only to the internal Compose network. It has no published host port, so public browsers and outside machines cannot connect to it. The app container is the database client and the only component that exposes API data to the site. Database TLS can be enabled when traffic leaves the private host or crosses a network boundary; for a single-host internal Compose network, network isolation and the absence of a published port are the primary controls.

Do not commit `.env` files, private keys, bot tokens, OAuth client secrets, populated IP allowlists, database dumps, or local command scripts. The repository `.gitignore` blocks those common secret and command-file patterns; review `git status` before every push.
