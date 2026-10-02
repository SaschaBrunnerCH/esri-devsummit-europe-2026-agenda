# Esri European Developer & Technology Summit 2026 agenda

Session data for the 2026 event in Frankfurt, collected from [Esri's detailed agenda](https://registration.esri.com/flow/esri/26euroepcdev/deveventportal/page/detailed-agenda).

The scraper and proposed schemas are ready. Full JSON/Markdown exports and GitHub Pages endpoints are next.

## Quick start

Requires **Node.js 24+**. The scraper needs no dependencies or login.

```bash
npm run scrape
```

Saves sessions and speaker profiles to [data/raw/agenda.json](data/raw/agenda.json). Run `node scripts/scrape-agenda.mjs --help` for options.

For validation and tests:

```bash
npm ci
npm run validate
npm test
```

## Data and schema

- [Data model and findings](docs/data-model.md)
- [Public schema](schemas/agenda.schema.json) · [Raw schema](schemas/raw-agenda.schema.json)
- [Keyword catalogue](docs/keyword-catalog.json) · [Parsing rules](data/keyword-rules.json)

Output locations:

| File | Purpose | Status |
| --- | --- | --- |
| `data/raw/agenda.json` | Original source capture | Available |
| `public/agenda.json` | Normalized agenda for agents and applications | Planned, step 3 |
| `public/agenda.md` | Readable agenda for people and agents | Planned, step 3 |

GitHub Pages will publish `public/` in step 4, exposing `agenda.json` and `agenda.md` under the site's base URL. Export generation and Pages deployment are not implemented yet.

## Updates

The [daily workflow](.github/workflows/update-agenda.yml) refreshes the raw data at **04:17 UTC**, validates it, and commits changes. Failed runs preserve the previous snapshot. It also supports manual runs from GitHub Actions.
