# thesxber.com

The source code for Sxber's website, including the fanart gallery, admin panel, and backend services.

## Maintenance and support

The VPS hosting this website is managed by **@CelesteRed on Discord**.

If anything on the site needs to change:

- **DM @CelesteRed on Discord** to discuss a change, report a problem, or request help with the site or VPS.
- **[Open a GitHub issue](https://github.com/CelesteRed/thesxber.com/issues)** to report a bug or suggest a feature. Include what needs to change and, for bugs, steps to reproduce the problem.
- **[Submit a pull request](https://github.com/CelesteRed/thesxber.com/pulls)** if you have already coded the change. Explain what you changed and how you tested it; include screenshots for visual changes.

Coordinate VPS configuration and live deployments with @CelesteRed. Do not include passwords, tokens, private keys, or private environment settings in issues, pull requests, or commits.

## Repository layout

- `v1/` contains the original static site, preserved as a reference.
- `v2/` contains the current React frontend, Node/Express REST API, PostgreSQL storage, and Discord fanart integration. The app and database run with Docker Compose.
- `infra/` contains infrastructure documentation. Private deployment scripts and host configuration stay outside version control.

For setup and development, see the [v2 README](v2/README.md). For admin access, see the [admin guide](v2/ADMIN-AUTH.md). Contributors should also read the [repository guide](agents.md).

Use `v2/.env.example` as a configuration template and keep your actual `v2/.env` private.

## Floating emojis

The admin panel has a **Floating emojis** section for images, random quotes, held quotes, optional fanart-page quotes, click links, and visibility. Use the same floating **Save all** button for emoji and fanart edits. See the [floating emoji guide](v2/FLOATING-EMOJIS.md) for controls, storage, and API details.

The public footer reads made by [@celeste](https://github.com/CelesteRed) & [@bogged](https://youtube.com/@itzbogged), with separate links for each creator.

## Admin workspace

The signed-in admin uses the full browser width. Upload fanart, Fanart library, Floating emojis, and Activity ledger sections start collapsed; click a heading to expand it. Fanart and emoji entries use responsive card grids. Collapsing a section preserves pending edits, and its heading shows unsaved changes or errors. The floating **Save all** button saves across closed and open sections.

The **Emoji count** control stays hidden until a visitor clicks emojis 10 times, performs 10 separate drags, or hovers over them 10 times. These are independent counters, not a combined total. Unlocking shows **Emoji Easter Egg Unlocked** and saves a one-year cookie. After unlocking, visitors can set their own count from 0–100 using the centered control above the footer credits. New visitors start with the admin default (or zero for reduced motion); a personal count is remembered for that browser tab’s session.
