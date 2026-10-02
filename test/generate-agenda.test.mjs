import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateAgenda } from '../scripts/generate-agenda.mjs';
import { buildAgenda, renderMarkdown } from '../scripts/lib/agenda.mjs';
import { saveSnapshot } from '../scripts/scrape-agenda.mjs';
import { validateData } from '../scripts/validate-data.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/raw-agenda.json', import.meta.url), 'utf8'));

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'agenda-generation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'raw.json');
  await writeFile(input, JSON.stringify(fixture));
  return { input, outputDir: join(directory, 'public') };
}

test('generates complete valid exports and leaves unchanged files untouched', async t => {
  const options = await workspace(t);
  const original = await readFile(options.input, 'utf8');
  const result = await generateAgenda(options);
  assert.deepEqual(result, { changed: ['agenda.json', 'agenda.md', 'agenda.schema.json', 'index.html'], sessions: 2, speakers: 1, occurrences: 2 });
  assert.equal(await readFile(options.input, 'utf8'), original);
  const jsonPath = join(options.outputDir, 'agenda.json');
  const mdPath = join(options.outputDir, 'agenda.md');
  const json = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.deepEqual(validateData(json), []);
  assert.equal(json.source.contentSha256, fixture.contentSha256);
  assert.deepEqual(json.sessions.map(session => session.id), fixture.sessions.map(session => session.sessionID));
  const md = await readFile(mdPath, 'utf8');
  for (const session of fixture.sessions) assert.ok(md.includes(session.title));
  assert.ok(md.includes('Example Speaker'));
  assert.ok(md.includes(fixture.contentSha256));
  const timestamps = [(await stat(jsonPath)).mtimeMs, (await stat(mdPath)).mtimeMs];
  assert.deepEqual((await generateAgenda(options)).changed, []);
  assert.deepEqual([(await stat(jsonPath)).mtimeMs, (await stat(mdPath)).mtimeMs], timestamps);
});

test('invalid captures and parsing failures preserve both previous exports', async t => {
  const options = await workspace(t);
  await generateAgenda(options);
  const files = ['agenda.json', 'agenda.md'].map(name => join(options.outputDir, name));
  const previous = await Promise.all(files.map(path => readFile(path, 'utf8')));
  const wrongCount = structuredClone(fixture);
  wrongCount.counts.sessions++;
  const multipleTopics = structuredClone(fixture);
  multipleTopics.sessions[0].attributevalues.push(...['Web', 'Native SDKs'].map(value => ({ attribute_id: 'Topic', attribute: 'Topic', value })));
  const brokenKeywords = structuredClone(fixture);
  brokenKeywords.sessions[0].attributevalues[0].value = '"unfinished keyword';
  for (const [candidate, message] of [[wrongCount, /Count mismatch/], [multipleTopics, /multiple Topic labels/], [brokenKeywords, /Unbalanced keyword/]]) {
    const { scrapedAt, contentSha256, ...payload } = candidate;
    await saveSnapshot(options.input, payload, { now: () => scrapedAt });
    await assert.rejects(generateAgenda(options), message);
    assert.deepEqual(await Promise.all(files.map(path => readFile(path, 'utf8'))), previous);
  }
});

test('Markdown orders sessions chronologically, retains repeats, and includes unscheduled entries', () => {
  const agenda = buildAgenda(fixture);
  agenda.sessions[0].title = 'Later session';
  const occurrence = agenda.sessions[0].occurrences[0];
  agenda.sessions[0].occurrences = [
    { ...occurrence, id: 'repeat-occurrence', startsAt: '2026-10-22T07:00:00Z', endsAt: '2026-10-22T08:00:00Z',
      localStart: { date: '2026-10-22', time: '09:00' }, localEnd: { date: '2026-10-22', time: '10:00' } },
    { ...occurrence, startsAt: '2026-10-21T09:00:00Z', endsAt: '2026-10-21T10:00:00Z',
      localStart: { date: '2026-10-21', time: '11:00' }, localEnd: { date: '2026-10-21', time: '12:00' } },
  ];
  agenda.sessions.push({ ...structuredClone(agenda.sessions[0]), id: 'unscheduled', title: 'Unscheduled entry', occurrences: [] });
  assert.deepEqual(validateData(agenda), []);
  const md = renderMarkdown(agenda);
  assert.ok(md.indexOf('Fixture session fixture-two') < md.indexOf('Later session'));
  assert.ok(md.indexOf('Later session') < md.indexOf('## Unscheduled'));
  assert.ok(md.includes('2026-10-21 11:00'));
  assert.ok(md.includes('2026-10-22 09:00'));
  assert.ok(md.includes('repeat-occurrence'));
  assert.ok(md.includes('Unscheduled entry'));
  assert.ok(md.includes('Not yet scheduled.'));
});

test('Markdown preserves paragraphs and escapes source formatting characters', () => {
  const agenda = buildAgenda(fixture);
  agenda.sessions[0].title = 'A [title] with <markup>';
  agenda.sessions[0].description = 'First paragraph.\n\n# Source heading\n\n1. Source list\n\nUse **Python** and [tools](https://example.com).';
  const md = renderMarkdown(agenda);
  assert.ok(md.includes('### A \\[title\\] with \\<markup\\>'));
  assert.ok(md.includes('First paragraph.\n\n\\# Source heading'));
  assert.ok(md.includes('1\\. Source list'));
  assert.ok(md.includes('Use \\*\\*Python\\*\\* and \\[tools\\]'));
});

test('JSON and Markdown share date, time, title, and ID ordering regardless of source traversal', () => {
  const snapshot = structuredClone(fixture);
  const pad = hour => String(hour).padStart(2, '0');
  const time = (date, hour, id) => ({ ...fixture.sessions[0].times[0], sessionTimeID: id,
    date, endDate: date, startTime: `${pad(hour)}:00`, endTime: `${pad(hour + 1)}:00`,
    utcStartTime: `${date.replaceAll('-', '/')} ${pad(hour - 2)}:00:00`,
    utcEndTime: `${date.replaceAll('-', '/')} ${pad(hour - 1)}:00:00` });
  const session = (id, title, times = []) => ({ ...structuredClone(fixture.sessions[0]), sessionID: id, title,
    times: times.map(occurrence => ({ ...occurrence, sessionID: id })) });
  snapshot.sessions = [
    session('a-zulu', 'Zulu', [time('2026-10-21', 9, 'zulu-time')]),
    session('z-alpha', 'Alpha', [time('2026-10-22', 9, 'repeat-time'), time('2026-10-21', 9, 'z-alpha-time')]),
    session('b-alpha', 'Alpha', [time('2026-10-21', 9, 'b-alpha-time-z'), time('2026-10-21', 9, 'b-alpha-time-a')]),
    session('later-time', 'A later session', [time('2026-10-21', 11, 'later-time')]),
    session('next-date', 'A next-day session', [time('2026-10-22', 8, 'next-time')]),
    session('first-date', 'Zulu on the first day', [time('2026-10-20', 11, 'first-time')]),
    session('a-unscheduled', 'Zulu unscheduled'), session('z-unscheduled', 'Alpha unscheduled'),
  ];
  const original = structuredClone(snapshot);
  const agenda = buildAgenda(snapshot);
  assert.deepEqual(validateData(agenda), []);
  const ids = ['first-date', 'b-alpha', 'z-alpha', 'a-zulu', 'later-time', 'next-date', 'z-unscheduled', 'a-unscheduled'];
  assert.deepEqual(agenda.sessions.map(entry => entry.id), ids);
  assert.deepEqual(agenda.sessions[1].occurrences.map(entry => entry.id), ['b-alpha-time-a', 'b-alpha-time-z']);
  assert.deepEqual(agenda.sessions[2].occurrences.map(entry => entry.id), ['z-alpha-time', 'repeat-time']);
  const md = renderMarkdown(agenda);
  assert.deepEqual([...md.matchAll(/^Session ID: (\S+)/gm)].map(match => match[1]), ids);
  assert.deepEqual(snapshot, original, 'projection must not mutate the raw capture');
  snapshot.sessions.reverse();
  for (const entry of snapshot.sessions) entry.times.reverse();
  const shuffled = buildAgenda(snapshot);
  assert.equal(JSON.stringify(shuffled), JSON.stringify(agenda));
  assert.equal(renderMarkdown(shuffled), md);
});
