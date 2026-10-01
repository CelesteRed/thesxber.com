# Floating emojis

The interaction follows the [sylve.love floating emoji reference](https://github.com/CelesteRed/sylve.love/blob/main/src/bouncingEmojis.ts): 64px images bounce around the viewport, slow near the pointer, enlarge and squish on approach, and can be grabbed, dragged, and thrown. They periodically show random quotes, react with different quotes while held, and fade out and respawn. A short click can open an optional link; dragging does not open links. The implementation uses Sxber-specific defaults and administrator-uploaded images.

## Managing emojis

1. Open `/admin` and sign in with an allowed Discord account.
2. Expand **Floating emojis**. At the top, use **Emoji controller → Party emoji count** to choose 0–30 simultaneous emojis after console activation (initial setting: 10), then click **Save all**. Every page load starts at zero regardless of this setting. Setting 0 leaves the count at zero after unlocking until the visitor adjusts it.
3. Enter a name, choose an image, and click **Upload emoji**. Uploads publish immediately with friendly default quotes.
4. Edit any combination of emojis and fanart. The floating **Save all** button publishes all pending metadata edits. Failed entries keep their drafts for retry.
5. Toggle **Show on the site** to enable or disable an emoji. Removing an emoji deletes its stored images and metadata immediately.

Each emoji has four multiline boxes:

| Field | Behavior |
| --- | --- |
| Random quotes | Random speech on the home page; also used on the gallery when no gallery quotes are set. |
| Quotes when grabbed | Immediate speech on grab, repeated every 2–4 seconds while held. |
| Fanart page quotes | Optional gallery-specific idle speech. |
| Click links | Optional HTTP/HTTPS URLs. Each spawned emoji chooses a link at random. Blank means no navigation. |

Use one quote or link per line, up to 30 lines per box. Quotes allow 100 characters per line and escaped light Markdown: bold, italic, strike, code, and underline. HTML is displayed as text. Links must be full HTTP/HTTPS URLs without credentials. Blank quote lists use friendly defaults such as “Hello!” and “Ready for takeoff!”

Uploads accept PNG, JPEG, GIF, and WebP up to 3 MB, 4096px per side, and 100 frames, with a decoded pixel limit. The server generates WebP up to 256px per side, preserving transparency and animation. **View original** requires admin authentication and returns the exact original bytes. The floating images are rendered at 64px.

## Visitor behavior

The home page and `/fanart` always start with zero emojis and no visible activation control. Previous unlock cookies and session counts are ignored. Clicks, drags, and hovers do not unlock anything. The effect never runs on `/admin`.

Run `partyTime()` in the browser console to activate the effect for the current page. `window["party time"]()` and `window["Party Time"]()` are equivalent commands; bare `party time` is not valid JavaScript. Calling a command prints the API contact note: “Contact @CelesteRed on discord if any problems found on the site!” It also reveals the **Emoji count − number +** control. The initial party count uses the admin setting; visitors can then choose 0–100. Reloading or navigating to another page returns the effect to zero and hides the control. No cookie or storage entry automatically enables motion, including for reduced-motion visitors; the console command is an explicit opt-in.

After five minutes on a public page, the console logs exactly `Type 'party time' for a fun time!`, followed by the runnable command syntax. The hint never activates emojis. Commands and the timer are cleaned up when the public page unmounts. There is no visible developer credit or unlock toast.

While active, slower devices may show fewer emojis. Idle quotes appear every 5–15 seconds and last 2–4 seconds. Individual emojis live for 10–60 seconds, with a short fade-in and four-second fade-out. Proximity and grabbing pause their lifespan before fading. Touch supports dragging and throwing without mouse proximity slowdown. The effect pauses in background tabs and hides while site dialogs are open. Dragging does not open click links.

## Backend and deployment

PostgreSQL automatically creates `floating_emojis` and the singleton `floating_emoji_settings` table on startup. The global count survives container rebuilds and restarts. Filesystem fallback stores the count separately in `settings.json` so image uploads and removals do not overwrite it. It stores the configuration, original bytes, and WebP bytes in the existing private database. No new secrets, database ports, or `.env` settings are required. Filesystem fallback uses ignored `v2/data/emojis/`, overridable through `EMOJI_STORAGE_DIR`; production Compose uses PostgreSQL.

| Route | Access / purpose |
| --- | --- |
| `GET /api/emojis` | Public enabled emoji metadata and `settings.count`. |
| `GET /emojis/:id.webp` | Public enabled WebP; disabled/deleted IDs return 404. |
| `GET /api/admin/emojis` | Authorized admin list including disabled emojis. |
| `POST /api/admin/emojis` | Authorized multipart upload with `name` and `file`. |
| `PATCH /api/admin/emoji-settings` | Authorized global setting update: `{ "count": 10 }`, integer 0–30. |
| `PATCH /api/admin/emojis/:id` | Authorized metadata update: `name`, `enabled`, `quotes`, `heldQuotes`, `fanartQuotes`, `links`. |
| `DELETE /api/admin/emojis/:id` | Authorized removal. |
| `GET /api/admin/emojis/:id/original` | Authorized original download/preview. |

The existing Discord session or trusted internal API token protects admin endpoints. API routes use the existing IP limiter. Uploads, changes, and removals record `emoji.upload`, `emoji.update`, `emoji.delete`, and `emoji.settings` with actor and IP metadata in the activity ledger. Visitors receive the current enabled list on page load; reload to see changes made while a page is already open. A new installation starts with no emoji images until an administrator uploads them.

Run `npm run test:emojis`, `npm run test:embed`, and `npm run build` from `v2/`. Emoji tests cover unauthorized requests, uploads, WebP conversion, preserved animated originals, disabled images, quote/link validation, and PostgreSQL audit records. Set `TEST_EMBED_DATABASE_URL` only to a disposable database named `sxber_embed_test` to exercise PostgreSQL; otherwise tests use temporary filesystem storage.
