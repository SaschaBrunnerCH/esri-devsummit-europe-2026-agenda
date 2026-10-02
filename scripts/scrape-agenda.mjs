#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export const SOURCE_URL = 'https://registration.esri.com/flow/esri/26euroepcdev/deveventportal/page/detailed-agenda';
const OUTPUT = 'data/raw/agenda.json';

// Decode a JS string literal without evaluating JavaScript from the remote page.
export function readPageString(html, name) {
  const match = html.match(new RegExp(`\\bvar\\s+${name}\\s*=\\s*(['"])((?:\\\\[\\s\\S]|(?!\\1)[^\\\\])*)\\1\\s*;`));
  if (!match) throw new Error(`Agenda page no longer exposes ${name}.`);
  return match[2].replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\\/'"bfnrtv])/g, (_, escape) => {
    if (escape[0] === 'u' || escape[0] === 'x') return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' })[escape] ?? escape;
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function apiSuccess(data, label) {
  if (!data || String(data.responseCode) !== '0') {
    throw new Error(`${label}: API did not report success (code ${data?.responseCode ?? 'missing'}).`);
  }
  return data;
}

// Requests are sequential, paced, bounded, and retried only for transient failures.
export function createClient({ fetchImpl = fetch, delayMs = 150, timeoutMs = 30_000,
  retries = 3, sleepImpl = sleep, log = console.error } = {}) {
  let lastRequest = 0;
  return async function request(url, { headers = {}, body, json = true } = {}) {
    for (let attempt = 0; ; attempt++) {
      await sleepImpl(Math.max(0, delayMs - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      let retryAfter = 0;
      try {
        const response = await fetchImpl(url, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'User-Agent': 'esri-devsummit-europe-2026-agenda/0.1', ...headers },
          body: body === undefined ? undefined : new URLSearchParams(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status} from ${new URL(url).pathname}`);
          error.retryable = response.status === 429 || response.status >= 500;
          const retryHeader = response.headers.get('retry-after');
          if (retryHeader) {
            retryAfter = /^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Math.max(0, Date.parse(retryHeader) - Date.now());
          }
          throw error;
        }
        // Read the body here so timeout/connection errors during transfer also retry.
        const text = await response.text();
        if (!json) return text;
        const data = JSON.parse(text);
        apiSuccess(data.data ?? data, new URL(url).pathname);
        return data;
      } catch (error) {
        const transient = error.retryable || error.name === 'TimeoutError' || error.name === 'AbortError'
          || (error instanceof TypeError && error.cause);
        if (!transient || attempt >= retries) throw error;
        log(`Temporary request failure; retry ${attempt + 1}/${retries}.`);
        await sleepImpl(Math.min(60_000, Math.max(retryAfter || 0, 1000 * 2 ** attempt)));
      }
    }
  };
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

function validateSession(item) {
  if (!item || typeof item.sessionID !== 'string' || !item.sessionID || typeof item.title !== 'string' || !item.title) {
    throw new Error('Session is missing its ID or title.');
  }
}

// Search results are occurrences: never deduplicate them by sessionID alone.
function occurrenceKey(item) {
  validateSession(item);
  return JSON.stringify([item.sessionID, item.sessionTimeID ?? item.times?.map(time => time.sessionTimeID) ?? null, item.language ?? null]);
}

export async function collectCatalog(api, base, pageSize, log = console.error) {
  const initial = await api('sessions', { ...base, from: '0', size: String(pageSize) });
  const sections = Array.isArray(initial.sectionList) ? initial.sectionList : [initial];
  if (!sections.length) throw new Error('API returned no catalogue sections.');
  const allItems = [];
  const sectionMetadata = [];
  for (const section of sections) {
    const total = integer(section.total, 'section total');
    let page = section;
    let from = 0;
    const seen = new Set();
    while (from < total) {
      if (!Array.isArray(page.items) || !page.items.length) throw new Error(`Incomplete catalogue at offset ${from}.`);
      if (page.from !== from || page.total !== total) throw new Error('Catalogue offsets or totals changed while scraping; rerun.');
      if (page.items.length > total - from || page.numItems !== page.items.length) throw new Error('Catalogue page count mismatch.');
      for (const item of page.items) {
        const key = occurrenceKey(item);
        if (seen.has(key)) throw new Error('Pagination repeated an occurrence; refusing an incomplete snapshot.');
        seen.add(key);
        allItems.push(item);
      }
      from += page.items.length;
      log(`Catalogue: ${from}/${total} entries${section.sectionId ? ` (section ${section.sectionId})` : ''}.`);
      if (from < total) {
        const next = await api('sessions', { ...base, from: String(from), size: String(pageSize),
          ...(section.sectionId ? { sectionId: section.sectionId } : {}) });
        page = Array.isArray(next.sectionList)
          ? next.sectionList.find(entry => entry.sectionId === section.sectionId) : next;
        if (!page) throw new Error('Catalogue section disappeared during pagination.');
      }
    }
    sectionMetadata.push({ sectionId: section.sectionId ?? null, title: section.sectionTitle ?? '', total });
  }
  const total = integer(initial.totalSearchItems ?? initial.total, 'catalogue total');
  if (!allItems.length || total !== allItems.length) throw new Error('Empty or incomplete catalogue; previous snapshot will be preserved.');
  allItems.sort((a, b) => occurrenceKey(a).localeCompare(occurrenceKey(b), 'en'));
  return { items: allItems, total, sections: sectionMetadata, attributes: initial.attributes ?? [] };
}

function detailItem(response, key, id, label) {
  const item = response.items?.find(entry => entry[key] === id);
  if (!item) throw new Error(`${label} ${id} was not returned; refusing a partial snapshot.`);
  return item;
}

export async function scrapeAgenda({ sourceUrl = SOURCE_URL, pageSize = 50,
  request = createClient(), log = console.error } = {}) {
  const source = new URL(sourceUrl);
  const path = source.pathname.match(/^\/flow\/([^/]+)\/([^/]+)\/([^/]+)\/page\/([^/]+)\/?$/);
  if (!path || source.protocol !== 'https:') throw new Error('Expected an HTTPS RainFocus agenda page URL.');
  const html = await request(source.href, { json: false });
  const workflowToken = readPageString(html, 'workflowApiToken');
  const timezone = readPageString(html, 'eventTimeZone');
  const eventId = readPageString(html, 'eventId');
  const url = new URL('/flow/loadPage', source.origin);
  url.search = new URLSearchParams({ pageUri: path[4], workflowApiToken: workflowToken }).toString();
  const pageResponse = await request(url.href);
  const page = pageResponse.data;
  apiSuccess(page, 'loadPage data');
  const { apiProfileToken, widgetToken } = page.widgetConf ?? {};
  if (!apiProfileToken || !widgetToken || !page.eventsUrl) throw new Error('Public catalogue configuration is missing.');
  // These are the public page's widget tokens, discovered afresh on every run.
  // Do not persist tokens, cookies, attendee state, or CSRF values in the snapshot.
  const apiOrigin = new URL(`https://${page.eventsUrl}`);
  if (apiOrigin.hostname !== 'event.esri.com') throw new Error('Unexpected Esri API host; review the source configuration.');
  const api = (endpoint, body = {}) => request(new URL(`/api/${endpoint}`, apiOrigin).href, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', rfApiProfileId: apiProfileToken, rfWidgetId: widgetToken }, body,
  });
  const config = await api('widgetConfig');
  const catalog = await collectCatalog(api, { type: 'session', browserTimezone: timezone, catalogDisplay: 'list' }, pageSize, log);
  const ids = [...new Set(catalog.items.map(item => item.sessionID))].sort();
  const sessions = [];
  for (const id of ids) {
    const session = detailItem(await api('session', { id }), 'sessionID', id, 'Session');
    validateSession(session);
    sessions.push(session);
    if (sessions.length % 10 === 0 || sessions.length === ids.length) log(`Session details: ${sessions.length}/${ids.length}.`);
  }
  const speakerIds = [...new Set([...catalog.items, ...sessions]
    .flatMap(session => session.participants ?? []).map(speaker => {
      if (typeof speaker.speakerId !== 'string' || !speaker.speakerId) throw new Error('Participant is missing speakerId.');
      return speaker.speakerId;
    }))].sort();
  const speakers = [];
  for (const id of speakerIds) {
    speakers.push(detailItem(await api('speaker', { id }), 'speakerId', id, 'Speaker'));
    if (speakers.length % 10 === 0 || speakers.length === speakerIds.length) log(`Speaker profiles: ${speakers.length}/${speakerIds.length}.`);
  }
  // Verify the source count again after fetching details. A later refresh captures edits.
  const check = await api('sessions', { type: 'session', browserTimezone: timezone, catalogDisplay: 'list', size: '1', from: '0' });
  if ((check.totalSearchItems ?? check.total) !== catalog.total) throw new Error('Catalogue total changed while scraping; rerun.');
  return {
    captureVersion: 1,
    source: { url: source.href, apiBaseUrl: new URL('/api/', apiOrigin).href,
      organization: path[1], eventCode: path[2], eventId, timezone,
      scope: 'All public entries exposed by the detailed agenda catalogue, including shared partner-conference activities.' },
    counts: { catalogEntries: catalog.total, sessions: sessions.length, speakers: speakers.length },
    catalogSections: catalog.sections,
    catalogConfiguration: config.config?.componentConfigs ?? [],
    attributes: catalog.attributes,
    catalogItems: catalog.items,
    sessions,
    speakers,
  };
}

export async function saveSnapshot(output, capture, { now = () => new Date().toISOString() } = {}) {
  const payload = canonical(capture);
  const contentSha256 = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.contentSha256 === contentSha256) {
    // Compare actual data too, rather than trusting a stale digest in an edited file.
    const { scrapedAt, contentSha256: oldHash, ...oldPayload } = previous;
    if (JSON.stringify(canonical(oldPayload)) === JSON.stringify(payload)) return false;
  }
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ ...payload, scrapedAt: now(), contentSha256 }, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, output);
  } finally { await rm(temporary, { force: true }); }
  return true;
}

async function main() {
  const { values } = parseArgs({ options: {
    output: { type: 'string', default: OUTPUT },
    'source-url': { type: 'string', default: SOURCE_URL },
    'page-size': { type: 'string', default: '50' },
    'delay-ms': { type: 'string', default: '150' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log(`Usage: node scripts/scrape-agenda.mjs [options]

  --output PATH       Raw snapshot (default: ${OUTPUT})
  --source-url URL    Public detailed agenda page
  --page-size N       Entries per request, 1–100 (default: 50)
  --delay-ms N        Minimum request spacing, 0–10000 (default: 150)
  --help, -h          Show this help

Requires Node.js 24+. No login, browser, or dependencies required.
Failed/incomplete runs leave the previous snapshot untouched.
Unchanged data leaves the file (including scrapedAt) untouched.`);
    return;
  }
  const pageSize = Number(values['page-size']);
  const delayMs = Number(values['delay-ms']);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('--page-size must be an integer from 1 to 100.');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 10_000) throw new Error('--delay-ms must be an integer from 0 to 10000.');
  const capture = await scrapeAgenda({ sourceUrl: values['source-url'], pageSize, request: createClient({ delayMs }) });
  const output = resolve(values.output);
  const changed = await saveSnapshot(output, capture);
  console.log(`${changed ? 'Saved' : 'Unchanged'} ${output}: ${capture.counts.catalogEntries} entries, ${capture.counts.sessions} sessions, ${capture.counts.speakers} speakers.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`Scrape failed: ${error.message}`);
    process.exitCode = 1;
  });
}
