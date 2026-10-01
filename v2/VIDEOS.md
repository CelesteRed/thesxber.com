# Videos

The **Videos** section appears first in the admin dashboard, above Upload fanart. It starts collapsed and retains edits while collapsed. Search and page through the channel's cached public uploads (24 per page). Hide a video from the public feed or enter plain-text custom hover text, up to 120 characters. Blank hover text restores the original YouTube title. Use the shared **Save all** button to publish edits. The card always shows the original title at top left; its view counter appears at top right only on hover or keyboard focus. Custom hover text replaces the description in the hover/focus panel. That panel also shows the publication date, available duration, and a YouTube link; touch screens keep essential details visible.

The homepage has independent **Latest Videos** (16:9) and **Shorts** (9:16) carousels, with plain headings and no subtitles. Formats are detected automatically from YouTube’s public Shorts routing: a canonical Shorts page means Short, while a redirect to the matching watch page means Video. This is a cached web-routing check, not an official Data API format field. Checks use four workers, 12-second request timeouts and a 60-second batch budget, with successful results cached in memory for a day. Timeouts/consent/errors remain unknown or preserve the last detected format; they never default to Videos. In the admin panel, Homepage shelf defaults to **Automatic (YouTube)**. Explicit Videos/Shorts overrides use **Save all** and survive syncs; choose Automatic to restore detection. Legacy default Video labels are automatically corrected on the next successful sync; legacy explicit Short labels are preserved.

The public feed includes a `format` (`video`, `short`, or temporarily `unknown`) for each item and returns the latest 20 visible uploads **per format**. Hidden entries are filtered before each limit. It never includes hidden flags, cooldowns, provider errors or private API credentials. Loading the site never triggers a YouTube API request. Sparse or empty shelves fill the first visible row with non-interactive **Coming Soon...** cards. Their temporary background is controlled by `--coming-soon-background` on `.media-card--placeholder` in `src/styles.css`; replace it with an image URL when artwork is ready. Loading, errors and unidentified uploads retain their status messages.

## Sync behavior

- Automatic sync runs hourly. `YOUTUBE_CACHE_TTL_SECONDS` defaults to 3600 and cannot be configured below one hour. The internal timer checks once per minute whether work is due; it does not fetch from YouTube every minute.
- **Sync videos now** is available to authorized admins once per rolling hour, globally across admins and tabs. It can be used independently of an automatic sync. It reserves the cooldown before calling YouTube, so failures also consume the hour. The UI shows a countdown; bypassing it still receives HTTP 429 with `Retry-After` and `nextSyncAt`.
- A manual sync postpones the next automatic attempt by an hour. Concurrent syncs are rejected with 409. PostgreSQL row locks serialize claims across processes, and timestamps survive restarts. A five-minute lease allows recovery after a crashed sync; network requests have 15-second individual and 90-second overall timeouts.
- The channel's uploads playlist ID is discovered with `channels.list` and retained. `playlistItems.list` retrieves up to 50 entries per page. `search.list` is never used. Each run accepts up to 100 pages (5,000 entries); exceeding the bound fails without publishing a partial feed.
- Only public entries with valid video IDs and HTTPS thumbnails are included. A full successful sync removes unavailable videos from the current feed but retains their moderation settings for possible reappearance. Errors preserve the last successful cache. Original titles and thumbnails update without resetting hidden flags or hover overrides.

## Storage and API

PostgreSQL stores metadata in `youtube_videos` and sync state in `youtube_cache_state`. Migrations add columns without dropping existing cached videos. Filesystem fallback uses `data/youtube.json` (override with `YOUTUBE_CACHE_FILE`) and supports a single server process. It persists edits and cooldowns across restarts.

| Route | Purpose |
| --- | --- |
| `GET /api/youtube` | Cached public feed, no external request |
| `GET /api/admin/videos` | All current uploads, moderation and sync status |
| `POST /api/admin/videos/sync` | Immediate bounded sync; send JSON `{}` |
| `PATCH /api/admin/videos/:id` | Update `hidden`, `hoverText` and/or `format` (`auto`, `video`, or `short`) |

Admin routes use the existing Discord allowlist/internal API token and IP limiter. Mutations require `application/json`. Activity records use `video.sync` (including upstream failure) and `video.update`. Denied cooldown retries do not create ledger spam.

Run `npm run test:videos` and `npm run build`. For PostgreSQL coverage, set `TEST_EMBED_DATABASE_URL` to a disposable database named `sxber_embed_test`; tests clear its YouTube tables. Provider responses are mocked and no Google quota is spent by tests.

## Local preview with the live public feed

Set `YOUTUBE_PREVIEW_ORIGIN=https://thesxber.com` in the private local `.env` to adapt only `/api/youtube` to the live public feed in Vite dev and preview. All admin, auth and other API requests stay local, and the proxy strips credentials. This does not change the production backend or deploy anything. Remove this variable to use the local YouTube cache/API key. The preview adapter identifies missing formats from YouTube and caches the enriched feed for an hour (one minute if identification is incomplete). It only enriches uploads the remote feed returns, so a legacy 20-upload feed can contain fewer than 20 uploads per shelf. Explicit remote labels are preserved. While proxying remotely, local admin edits do not affect the live feed.

## Card metadata

View counts, ISO durations and description excerpts (500 characters) are fetched using `videos.list` in batches of up to 50 IDs during the hourly sync. Counts are stored as decimal strings to preserve large values; missing counts stay null and render as an em dash, while actual zero renders as 0. Public reads and hover interactions never spend Google quota. A failed metadata request preserves the complete previous cache. The local live-preview adapter enriches missing formats and counts using matching public YouTube player metadata, with four workers, eight-second timeouts and a 2 MiB page limit. Existing API counts, including zero, are preserved. The feed is cached for an hour, or one minute when counts/formats remain unavailable. Production statistics and durations still require the updated backend to be deployed and synced.

The local `public/icons/eye_line.svg` is MingCute v2.97 (Apache-2.0), from https://github.com/Richard9394/MingCute/blob/v2.97/svg/system/eye_line.svg. Its license is included alongside it.
