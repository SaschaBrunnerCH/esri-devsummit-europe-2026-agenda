# Esri European Developer & Technology Summit 2026 agenda

Public agenda data for the 2026 event in Frankfurt. Source: [Esri's detailed agenda](https://registration.esri.com/flow/esri/26euroepcdev/deveventportal/page/detailed-agenda).

The first step is a dependency-free Node.js scraper. The schema, public JSON/Markdown exports, preference-based schedules, and GitHub Pages endpoints will follow.

## Run the scraper

Requires Node.js 24 or newer. No install, browser, login, or credentials are needed.

```bash
npm run scrape
# Or directly:
node scripts/scrape-agenda.mjs

# Optional settings:
node scripts/scrape-agenda.mjs --output /tmp/agenda.json --page-size 25 --delay-ms 250
node scripts/scrape-agenda.mjs --help

# Offline tests:
npm test
```

The scraper discovers the public RainFocus widget configuration from the source page on every run, follows every catalogue page, then retrieves each unique session and speaker profile using the same read endpoints as the website. Requests run sequentially with at least 150 ms between requests, a 30-second timeout, and up to three retries for temporary network/server failures. A full run can take a few minutes.

## Raw capture

Output: `data/raw/agenda.json`. This is an intermediate source snapshot for discovering the data and designing the final schema, rather than the eventual public endpoint contract.

| Field | Content |
| --- | --- |
| `captureVersion` | Version of this raw capture envelope |
| `source` | Official page URL, API base URL, event ID/code, timezone, and catalogue scope |
| `scrapedAt` | UTC timestamp of the last changed, successful capture |
| `contentSha256` | SHA-256 of the canonical capture payload, excluding timestamp and digest |
| `counts` | Catalogue entries, unique sessions, and unique speakers |
| `catalogSections` | Source section IDs, names, and entry counts |
| `catalogConfiguration` | Source catalogue component settings, including filters and visible attributes |
| `attributes` | Catalogue facets and source attribute definitions |
| `catalogItems` | Every raw search occurrence, preserving source fields |
| `sessions` | Full source session records, including abstracts, times, rooms, participants, attributes, and files where provided |
| `speakers` | Full profiles of speakers referenced by catalogue/session records, including bios, titles, photos, and session references where provided |

Source field names, HTML abstracts, missing values, local times, and UTC time strings are preserved. Repeated occurrences of a session remain in `catalogItems`; `sessions` contains one detail record per unique ID. The event timezone is `Europe/Berlin`.

The shared registration event also includes the European Partner Conference. The detailed Developer Summit catalogue itself exposes some shared activities from that event; the scraper preserves them. Speaker session references may point to sessions outside this catalogue. Private or login-only content is outside the capture scope. Public widget request tokens, cookies, CSRF values, and attendee state are not saved.

The scraper checks pagination counts, repeated occurrences, required IDs/titles, detail responses, and the final catalogue count. It fails with a nonzero exit code if the capture is incomplete. It writes only after every request succeeds and replaces the previous file atomically. The source does not offer transactionally consistent snapshots: counts are checked again at the end, but edits made during a run can still be captured at different moments. A later refresh picks up subsequent changes.

Unchanged payloads leave the file and `scrapedAt` untouched, avoiding commits that only change a fetch timestamp. Each workflow run separately records its check time in the Actions summary.

## Daily updates

`.github/workflows/update-agenda.yml` runs daily at **04:17 UTC**, and supports manual execution through **Actions → Update agenda → Run workflow**. It tests the scraper, fetches a complete snapshot, and commits only a changed `data/raw/agenda.json` to the default branch. Failed scrapes preserve the previous snapshot.

The workflow becomes active once this file is on the repository's default branch with Actions enabled. Its `GITHUB_TOKEN` needs `contents: write`; branch rules must allow its data commits. The workflow uses the standard token and requires no additional secrets. Pushes use normal fast-forward checks, so a concurrent branch update causes a safe failure rather than overwriting it.

GitHub runs scheduled workflows on the default branch and can delay them. Public repositories also have schedules disabled after 60 days of inactivity. See [GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

The current workflow refreshes the raw capture. Schema validation, derived JSON/Markdown generation, and Pages deployment will be added as those steps are implemented.
