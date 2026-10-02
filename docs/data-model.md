# Agenda data model

Based on the **2026-10-02** snapshot: **120 sessions, 120 occurrences, 74 speakers, 17 rooms, and 363 keyword entries**. See the [discovery report](data-discovery.json) for field coverage and source details.

## Structure

One JSON bundle, defined by the [public schema](../schemas/agenda.schema.json). Version **3.0.0** keeps speaker names in sessions and omits codes, language, modification timestamps, room IDs, duration, and attendance flags. Markdown retains those details and the separate speaker profiles.

| Field | Content |
| --- | --- |
| `source`, `event` | Provenance, event identity, catalogue name, and timezone |
| `sessions` | Titles, descriptions, classifications, speaker names, and occurrences |

An occurrence is a scheduled presentation of a session: its own ID, UTC start/end, local date/time, and room name. Sessions can have zero or multiple occurrences. Duration can be calculated from the UTC interval.

The [generator](../scripts/generate-agenda.mjs) validates before writing `public/agenda.json` and `public/agenda.md`, alongside the schema and link page. Both exports order sessions by their first occurrence's local date, time, then title (English alphabetical order), with session ID breaking ties. Occurrences sort by local date/time, UTC start, then ID. Unscheduled sessions come last, sorted by title and ID. JSON keeps each session on one compact line for smaller downloads and readable Git diffs; metadata remains indented. Markdown is generated from the full capture and includes all repeats, session speaker details, and a speaker-profile section.

CI stores raw captures as debugging artifacts and commits public exports on `gh-pages`. When source content is unchanged, publication retains its first capture timestamp; the raw artifact records the latest capture. The digest identifies source content, while Git history also records changes to processing and presentation. Local `data/raw/` and `public/` are ignored by Git.

## Source handling

- Keep all catalogue entries. Seven belong to both the Developer Summit and Partner Conference, including the plenaries; preserve membership for filtering.
- Preserve session/occurrence IDs, display names, and room labels in JSON. Speaker and room IDs also appear in Markdown. Keep the unreliable preferred-name field only in the raw capture.
- Use plain-text descriptions and official classifications without inventing tags. Keep original abstracts and the full attribute list in the raw capture.
- Use a single nullable `topic`. Multiple distinct source topics stop projection for review rather than losing a value.
- Missing scalar metadata becomes `null`; missing lists become `[]`. Twelve entries have no speakers. JSON contains speaker names only; Markdown retains IDs, companies, session roles/order, biographies, and photos. Event biographies/titles take precedence over global values.
- Use `Europe/Berlin` for local times and explicit UTC timestamps for comparisons. Source capacity values of `"0"` do not establish availability.

## Keywords

Sessions contain readable keyword labels:

```json
{
  "keywords": ["JavaScript", "web components", "web development"]
}
```

The [parser](../scripts/lib/keywords.mjs) splits commas, semicolons, newlines, and middle dots outside quotes or parentheses. It preserves phrases and compounds such as `UI/UX` and `CI/CD`.

[Reviewed rules](../data/keyword-rules.json) merge aliases, such as `artificial intelligence` → `AI`, and handle ambiguous strings explicitly. Unknown undelimited phrases stay intact and produce a review diagnostic. Conflicting alias rules and unbalanced quoting/parentheses fail parsing.

The separate [discovery catalogue](keyword-catalog.json) lists labels, aliases, and usage counts: **363 terms and 565 session assignments**. Original keyword text remains in the raw capture. Preserve source terms such as `test` and `close`; official topic/product fields provide stronger preference signals.

## Validation

The [raw schema](../schemas/raw-agenda.schema.json) permits additional source fields; the public schema rejects extra properties. The [validator](../scripts/validate-data.mjs) also checks IDs and UTC/local times, plus raw durations, speaker references and counts, and the source digest. Before publishing, both exports must match the same raw capture; this check requires the raw file (`--input`, default `data/raw/agenda.json`). Agenda overlaps are valid; personal schedules will resolve conflicts later.

Use the [README](../README.md) for commands, endpoints, and the publication layout. The same workflow records history and deploys the Pages artifact directly; it does not depend on the `gh-pages` push triggering another build.
