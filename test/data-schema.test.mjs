import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { discoverData } from '../scripts/discover-data.mjs';
import { canonical } from '../scripts/scrape-agenda.mjs';
import { sourceUtc, validateData } from '../scripts/validate-data.mjs';
import { proposedAgenda } from './support/agenda-proposal.mjs';

const raw = JSON.parse(await readFile(new URL('../data/raw/agenda.json', import.meta.url), 'utf8'));
const fixture = JSON.parse(await readFile(new URL('./fixtures/raw-agenda.json', import.meta.url), 'utf8'));
const proposal = proposedAgenda(fixture);
const clone = value => structuredClone(value);
const updateDigest = data => {
  const { scrapedAt, contentSha256, ...payload } = data;
  data.contentSha256 = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
};

test('raw schema and semantic checks accept the complete captured snapshot', () => {
  assert.deepEqual(validateData(raw, { raw: true }), []);
});

test('proposed schema accepts every real session, occurrence, and speaker', () => {
  const agenda = proposedAgenda(raw);
  assert.deepEqual(validateData(agenda), []);
  assert.equal(agenda.sessions.length, raw.sessions.length);
  assert.equal(agenda.speakers.length, raw.speakers.length);
  for (const [index, session] of agenda.sessions.entries()) {
    const source = raw.sessions[index];
    assert.equal(session.occurrences.length, source.times?.length ?? 0);
    assert.equal(session.speakers.length, source.participants?.length ?? 0);
    assert.equal(session.topic, source.attributevalues.find(attribute => attribute.attribute_id === 'Topic')?.value.trim() || null);
  }
});

test('saved discovery report matches the corresponding source capture', async () => {
  const saved = JSON.parse(await readFile(new URL('../docs/data-discovery.json', import.meta.url), 'utf8'));
  assert.equal(saved.sourceContentSha256.length, 64);
  // The saved report describes a particular snapshot; daily refreshes need not rewrite it.
  if (saved.sourceContentSha256 === raw.contentSha256) assert.deepEqual(saved, discoverData(raw));
});

test('converts fixture HTML descriptions to plain text', () => {
  assert.equal(proposal.sessions[0].description, 'Learn JavaScript with examples.');
});

test('allows a missing topic and rejects multiple distinct source topics without dropping data', () => {
  const candidate = clone(fixture);
  const attributes = candidate.sessions[0].attributevalues;
  assert.equal(proposedAgenda(candidate).sessions[0].topic, null);
  const topic = { attribute_id: 'Topic', attribute: 'Topic', value: 'Web' };
  attributes.push(topic, clone(topic));
  assert.equal(proposedAgenda(candidate).sessions[0].topic, 'Web');
  attributes.push({ ...topic, value: 'Native SDKs' });
  assert.throws(() => proposedAgenda(candidate), /fixture-one: multiple Topic labels/);
});

test('accepts source refreshes with missing metadata, unscheduled sessions, and keyword review diagnostics', () => {
  const candidate = clone(fixture);
  delete candidate.sessions[0].abstract;
  delete candidate.sessions[0].times;
  delete candidate.sessions[0].participants;
  candidate.sessions[0].attributevalues[0].value = 'Alpha Beta Gamma Delta';
  updateDigest(candidate);
  assert.deepEqual(validateData(candidate, { raw: true }), []);
  const agenda = proposedAgenda(candidate);
  assert.deepEqual(validateData(agenda), []);
  assert.equal(agenda.sessions[0].description, null);
  assert.deepEqual(agenda.sessions[0].occurrences, []);
  assert.deepEqual(agenda.sessions[0].speakers, []);
  assert.deepEqual(agenda.sessions[0].keywords, ['Alpha Beta Gamma Delta']);
  assert.equal(discoverData(candidate).parsedKeywords.parsingDiagnostics.length, 1);
});

test('allows absent metadata, unscheduled sessions, repeats, and new source classification labels', () => {
  const candidate = clone(proposal);
  const session = candidate.sessions[0];
  Object.assign(session, { description: null, code: null, language: null, level: null, sourceModifiedAt: null,
    topic: null, products: [], capabilities: [], technologies: [], keywords: [], sessionType: 'Future Official Session Type' });
  const firstOccurrence = clone(session.occurrences[0]);
  session.occurrences = [];
  assert.deepEqual(validateData(candidate), []);
  session.occurrences = [firstOccurrence, { ...clone(firstOccurrence), id: 'repeat-test-occurrence' }];
  assert.deepEqual(validateData(candidate), []);
  Object.assign(session.occurrences[0], { room: null, inPerson: null, virtual: null });
  Object.assign(candidate.speakers[0], { bio: null, jobTitle: null, photoUrl: null });
  assert.deepEqual(validateData(candidate), []);
});

test('rejects unknown public properties and invalid formats', () => {
  for (const mutate of [
    data => { data.unexpected = true; },
    data => { data.sessions[0].url = 'http://example.com/session'; },
    data => { data.sessions[0].occurrences[0].startsAt = '2026-02-30T10:00:00Z'; },
    data => { data.sessions[0].occurrences[0].startsAt = '2026-10-21T10:00:00'; },
    data => { data.sessions[0].level = ''; },
    data => { delete data.sessions[0].topic; },
  ]) {
    const candidate = clone(proposal); mutate(candidate);
    assert.ok(validateData(candidate).length);
  }
});

test('rejects duplicate IDs and broken speaker references', () => {
  for (const [mutate, expected] of [
    [data => data.sessions.push(clone(data.sessions[0])), /Duplicate session ID/],
    [data => data.speakers.push(clone(data.speakers[0])), /Duplicate speaker ID/],
    [data => { data.sessions[1].occurrences[0].id = data.sessions[0].occurrences[0].id; }, /Duplicate occurrence ID/],
    [data => { data.sessions[0].speakers[0].speakerId = 'missing-speaker'; }, /unknown speaker/],
    [data => { data.sessions[0].speakers[0].name = 'Incorrect display name'; }, /name disagrees/],
    [data => data.sessions[0].speakers.push(clone(data.sessions[0].speakers[0])), /Duplicate speaker assignment/],
  ]) {
    const candidate = clone(proposal); mutate(candidate);
    assert.match(validateData(candidate).join('\n'), expected);
  }
});

test('rejects incorrect durations, reversed times, local dates, and timezones', () => {
  for (const [mutate, expected] of [
    [data => { data.sessions[0].occurrences[0].durationMinutes++; }, /duration/],
    [data => { data.sessions[0].occurrences[0].endsAt = data.sessions[0].occurrences[0].startsAt; }, /end must be after/],
    [data => { data.sessions[0].occurrences[0].localEnd.date = '2026-10-22'; }, /local date\/time/],
    [data => { data.event.timezone = 'UTC'; }, /local date\/time/],
    [data => { data.event.timezone = 'Invalid/Timezone'; }, /Invalid event timezone/],
  ]) {
    const candidate = clone(proposal); mutate(candidate);
    assert.match(validateData(candidate).join('\n'), expected);
  }
});

test('validates timezone offsets across midnight and daylight saving changes', () => {
  const candidate = clone(proposal);
  candidate.sessions[0].occurrences = [{ ...candidate.sessions[0].occurrences[0],
    startsAt: '2026-10-24T23:30:00Z', endsAt: '2026-10-25T02:30:00Z', durationMinutes: 180,
    localStart: { date: '2026-10-25', time: '01:30' }, localEnd: { date: '2026-10-25', time: '03:30' } }];
  assert.deepEqual(validateData(candidate), []);
  candidate.sessions[0].occurrences[0] = { ...candidate.sessions[0].occurrences[0],
    startsAt: '2026-10-21T21:30:00Z', endsAt: '2026-10-21T22:30:00Z', durationMinutes: 60,
    localStart: { date: '2026-10-21', time: '23:30' }, localEnd: { date: '2026-10-22', time: '00:30' } };
  assert.deepEqual(validateData(candidate), []);
});

test('raw validator detects digest, count, event, parent, and detail inconsistencies', () => {
  for (const [mutate, expected] of [
    [data => { data.contentSha256 = '0'.repeat(64); }, /contentSha256 mismatch/],
    [data => { data.counts.sessions++; }, /Count mismatch/],
    [data => { data.sessions[0].eventId = 'wrong-event'; }, /wrong source event/],
    [data => { data.sessions[0].times[0].sessionID = 'wrong-parent'; }, /wrong parent session/],
    [data => { data.catalogItems[0].sessionID = 'missing-session'; }, /no session detail/],
    [data => { data.sessions[0].times[0].utcStartTime = '2026/02/30 10:00:00'; }, /Invalid source UTC timestamp/],
  ]) {
    const candidate = clone(fixture); mutate(candidate);
    assert.match(validateData(candidate, { raw: true }).join('\n'), expected);
  }
});

test('raw source records allow additional official fields without weakening public shape', () => {
  const candidate = clone(fixture);
  candidate.sessions[0].newOfficialField = { future: true };
  updateDigest(candidate);
  assert.deepEqual(validateData(candidate, { raw: true }), []);
});

test('source UTC parsing rejects normalized impossible calendar values', () => {
  assert.equal(sourceUtc('2026/10/21 07:00:00'), '2026-10-21T07:00:00Z');
  assert.throws(() => sourceUtc('2026/02/30 07:00:00'), /Invalid/);
});
