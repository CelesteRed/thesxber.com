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
