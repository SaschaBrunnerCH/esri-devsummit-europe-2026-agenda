#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonical } from './scrape-agenda.mjs';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validators = Object.fromEntries(await Promise.all(['raw-agenda', 'agenda'].map(async name => {
  const schema = JSON.parse(await readFile(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8'));
  return [name, ajv.compile(schema)];
})));

export function sourceUtc(value) {
  const iso = value.replaceAll('/', '-').replace(' ', 'T') + 'Z';
  const millis = Date.parse(iso);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().replace('.000Z', 'Z') !== iso) throw new Error(`Invalid source UTC timestamp: ${value}`);
  return iso;
}

function localDateTime(iso, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = name => parts.find(part => part.type === name).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function validateData(data, { raw = false } = {}) {
  const validate = validators[raw ? 'raw-agenda' : 'agenda'];
  if (!validate(data)) return validate.errors.map(error => `${error.instancePath || '/'} ${error.message}`);
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const uniqueIds = (records, key, kind) => {
    const seen = new Set();
    for (const record of records) {
      require(!seen.has(record[key]), `Duplicate ${kind} ID: ${record[key]}`);
      seen.add(record[key]);
    }
    return seen;
  };
  const timezone = raw ? data.source.timezone : data.event.timezone;
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
  catch { return [`Invalid event timezone: ${timezone}`]; }
  const sessionIds = uniqueIds(data.sessions, raw ? 'sessionID' : 'id', 'session');
  const speakerIds = raw ? uniqueIds(data.speakers, 'speakerId', 'speaker') : null;
  const profiles = raw ? new Map(data.speakers.map(speaker => [speaker.speakerId, speaker])) : null;
  const occurrenceIds = new Set();
  const checkTime = (occurrence, label) => {
    const start = Date.parse(occurrence.startsAt);
    const end = Date.parse(occurrence.endsAt);
    require(end > start, `${label}: end must be after start`);
    if (raw) require((end - start) / 60_000 === occurrence.durationMinutes, `${label}: duration does not match UTC interval`);
    for (const [iso, local] of [[occurrence.startsAt, occurrence.localStart], [occurrence.endsAt, occurrence.localEnd]]) {
      const expected = localDateTime(iso, timezone);
      require(expected.date === local.date && expected.time === local.time, `${label}: local date/time disagrees with ${timezone}`);
    }
  };
  for (const session of data.sessions) {
    const id = raw ? session.sessionID : session.id;
    if (raw) require(session.eventId === data.source.eventId, `Session ${id}: wrong source event`);
    const assignments = raw ? session.participants ?? [] : [];
    if (raw) uniqueIds(assignments, 'speakerId', `speaker assignment in ${id}`);
    if (raw) for (const assignment of assignments) {
      require(speakerIds.has(assignment.speakerId), `Session ${id}: unknown speaker ${assignment.speakerId}`);
      const profile = profiles.get(assignment.speakerId);
      if (profile) {
        require(assignment.fullName === profile.fullName, `Session ${id}: speaker name disagrees with profile`);
        require((assignment.companyName?.trim() || null) === (profile.companyName?.trim() || null),
          `Session ${id}: speaker company disagrees with profile`);
      }
    }
    for (const time of raw ? session.times ?? [] : session.occurrences) {
      const occurrenceId = raw ? time.sessionTimeID : time.id;
      require(!occurrenceIds.has(occurrenceId), `Duplicate occurrence ID: ${occurrenceId}`);
      occurrenceIds.add(occurrenceId);
      try {
        if (raw) {
          require(time.sessionID === id, `Occurrence ${occurrenceId}: wrong parent session`);
          checkTime({ startsAt: sourceUtc(time.utcStartTime), endsAt: sourceUtc(time.utcEndTime), durationMinutes: time.length,
            localStart: { date: time.date, time: time.startTime }, localEnd: { date: time.endDate, time: time.endTime } }, `Occurrence ${occurrenceId}`);
        } else checkTime(time, `Occurrence ${occurrenceId}`);
      } catch (error) { errors.push(`Occurrence ${occurrenceId}: ${error.message}`); }
    }
  }
  if (raw) {
    for (const [key, array] of [['catalogEntries', data.catalogItems], ['sessions', data.sessions], ['speakers', data.speakers]]) require(data.counts[key] === array.length, `Count mismatch: ${key}`);
    require(data.catalogSections.reduce((total, section) => total + section.total, 0) === data.counts.catalogEntries, 'Catalogue section totals disagree with catalogue count');
    const catalogIds = new Set(data.catalogItems.map(session => session.sessionID));
    for (const session of data.catalogItems) {
      require(sessionIds.has(session.sessionID), `Catalogue entry has no session detail: ${session.sessionID}`);
      require(session.eventId === data.source.eventId, `Catalogue entry ${session.sessionID}: wrong source event`);
    }
    for (const id of sessionIds) require(catalogIds.has(id), `Session detail is absent from catalogue: ${id}`);
    for (const speaker of data.speakers) require(speaker.eventId === data.source.eventId, `Speaker ${speaker.speakerId}: wrong source event`);
    const { contentSha256, scrapedAt, ...payload } = data;
    const digest = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
    require(digest === contentSha256, 'Raw capture contentSha256 mismatch');
  }
  return errors;
}

async function main() {
  const [mode = '--raw', path] = process.argv.slice(2);
  if (!['--raw', '--agenda'].includes(mode) || process.argv.length > 4 || mode === '--agenda' && !path) throw new Error('Usage: node scripts/validate-data.mjs [--raw [PATH] | --agenda PATH]');
  const input = path ?? 'data/raw/agenda.json';
  const errors = validateData(JSON.parse(await readFile(input, 'utf8')), { raw: mode === '--raw' });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Valid ${mode === '--raw' ? 'raw capture' : 'agenda'}: ${input}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Validation failed: ${error.message}`); process.exitCode = 1; });
}
