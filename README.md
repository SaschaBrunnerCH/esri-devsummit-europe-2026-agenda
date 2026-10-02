# Esri European Developer & Technology Summit 2026 agenda

Session data from [Esri's detailed agenda](https://registration.esri.com/flow/esri/26euroepcdev/deveventportal/page/detailed-agenda), refreshed daily.

[JSON endpoint](https://SaschaBrunnerCH.github.io/esri-devsummit-europe-2026-agenda/agenda.json) · [Markdown endpoint](https://SaschaBrunnerCH.github.io/esri-devsummit-europe-2026-agenda/agenda.md) · [Schema endpoint](https://SaschaBrunnerCH.github.io/esri-devsummit-europe-2026-agenda/agenda.schema.json)

## Local use

Requires **Node.js 24+**. The scraper uses public source data and needs no login.

```bash
npm ci
npm test
npm run scrape
npm run generate
npm run validate
```

Raw capture: `data/raw/agenda.json`. Generated site: `public/`, including JSON, Markdown, schema, and a link page. Both directories are ignored by Git. Scraping and generation leave unchanged files untouched; each script supports `--help`.

[Data model](docs/data-model.md) · [Public schema](schemas/agenda.schema.json) · [Raw schema](schemas/raw-agenda.schema.json) · [Keyword catalogue](docs/keyword-catalog.json) · [Parsing rules](data/keyword-rules.json)

## Publication

| Location | Content |
| --- | --- |
| `main` | Scripts, schemas, docs, and synthetic test fixtures |
| CI workspace | Temporary raw capture and generated site |
| CI artifact | Raw capture for debugging, retained for 30 days |
| `gh-pages` | Public JSON, Markdown, schema, and link page with change history |

The [workflow](.github/workflows/update-agenda.yml) runs at **04:17 UTC**, on pushes to `main`, or manually. It tests, scrapes, validates, records changed exports on `gh-pages`, then deploys the same files through GitHub Pages Actions. Enable **Settings → Pages → Source → GitHub Actions** once; private repositories need a plan supporting Pages.

Unchanged source content keeps its first capture timestamp, avoiding daily history commits caused only by the clock. The raw artifact retains the current run's capture time. Publication failures leave the previous live site available.

## Use with an agent

Give Claude, Codex, or another agent the JSON endpoint and a request such as:

> Build my schedule for the Developer Summit. I develop JavaScript mapping apps and want intermediate sessions about web components and 3D. Use the agenda JSON, explain each choice, include session IDs and rooms, avoid overlaps, and leave 15 minutes between sessions. Show local times in Europe/Berlin and flag missing information.

Use official topic/product classifications and readable keywords for preferences. Session catalogue membership identifies activities shared with the Partner Conference. Example schedules for specific roles are the next step.
