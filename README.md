# Esri European Developer & Technology Summit 2026 agenda

Session data from [Esri's detailed agenda](https://registration.esri.com/flow/esri/26euroepcdev/deveventportal/page/detailed-agenda), refreshed daily.

[Agenda data page](https://saschabrunnerch.github.io/esri-devsummit-europe-2026-agenda/) · [JSON endpoint](https://SaschaBrunnerCH.github.io/esri-devsummit-europe-2026-agenda/agenda.json) · [Markdown endpoint](https://SaschaBrunnerCH.github.io/esri-devsummit-europe-2026-agenda/agenda.md) · [Schema endpoint](https://SaschaBrunnerCH.github.io/esri-devsummit-europe-2026-agenda/agenda.schema.json)

## Local use

Requires **Node.js 24+**. The scraper uses public source data and needs no login.

```bash
npm ci
npm test
npm run scrape
npm run generate
npm run validate
```

Raw capture: `data/raw/agenda.json`. Generated site: `public/`, including JSON, Markdown, schema, and the agenda data page with its assets. Both directories are ignored by Git. Scraping and generation leave unchanged files untouched; each script supports `--help`. Run `npm run preview` to view the page at **http://localhost:4173/**.

[Data model](docs/data-model.md) · [Public schema](schemas/agenda.schema.json) · [Raw schema](schemas/raw-agenda.schema.json) · [Keyword catalogue](docs/keyword-catalog.json) · [Parsing rules](data/keyword-rules.json)

## Publication

| Location | Content |
| --- | --- |
| `main` | Scripts, schemas, docs, and synthetic test fixtures |
| CI workspace | Temporary raw capture and generated site |
| CI artifact | Raw capture for debugging, retained for 30 days |
| `gh-pages` | Public JSON, Markdown, schema, and agenda data page with change history |

The [workflow](.github/workflows/update-agenda.yml) runs at **04:17 UTC**, on pushes to `main`, or manually. It tests, scrapes, validates, records changed exports on `gh-pages`, then deploys the same files through GitHub Pages Actions. Enable **Settings → Pages → Source → GitHub Actions** once; private repositories need a plan supporting Pages.

Unchanged source content keeps its first capture timestamp, avoiding daily history commits caused only by the clock. The raw artifact retains the current run's capture time. Publication failures leave the previous live site available.

## Use with an agent

Give GitHub Copilot, Codex, Claude, or another agent the [JSON endpoint](https://saschabrunnerch.github.io/esri-devsummit-europe-2026-agenda/agenda.json). Edit the preferences in the page's reusable prompt, or start with:

> Build my Developer Summit agenda for 20–22 October 2026 using this JSON: https://saschabrunnerch.github.io/esri-devsummit-europe-2026-agenda/agenda.json
>
> Read and parse the entire file before planning. Verify all three days and the closing session are present. If access is blocked, the response is truncated, or you cannot confirm completeness, ask me to download the JSON and attach it to this chat. Resume only after reading the complete file.
>
> My interests are JavaScript mapping apps, web components, 3D, and AI development. Use any context you already have about my work or goals to refine these interests, and explain your assumptions. Include the shared plenary and closing session; exclude partner-only activities.
>
> Start with a short summary of what I can expect to learn. Then show my agenda and good alternatives, with dates, start/end times, titles linked to official session pages, rooms, and reasons for each choice. Explain which session each alternative replaces or which free slot it fills. Use Europe/Berlin times, omit IDs, avoid overlaps and repeats, and state the source capture date. Flag gaps, ask for missing preferences, and remind me to check the official agenda.

The page includes examples for JavaScript/web, Python/data, native apps, GIS architecture, DevOps, and AI. They cover all three days and link to official sessions. Use the source's topic/product classifications and readable keywords to refine preferences; catalogue membership identifies activities shared with the Partner Conference.
