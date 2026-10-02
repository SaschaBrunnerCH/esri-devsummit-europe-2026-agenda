import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectCatalog, createClient, readPageString, saveSnapshot, scrapeAgenda, SOURCE_URL } from '../scripts/scrape-agenda.mjs';

const quiet = () => {};
const item = (sessionID, sessionTimeID = `${sessionID}-time`) => ({ sessionID, sessionTimeID, title: sessionID });
const page = (items, from, total) => ({ items, from, total, numItems: items.length });

test('reads public configuration literals without executing page JavaScript', () => {
  const html = String.raw`var eventTimeZone = "Europe/Berlin"; var eventsServerUrl = 'https:\/\/event.esri.com\/'; var eventName = 'Esri\u0027s \'Agenda\'';`;
  assert.equal(readPageString(html, 'eventTimeZone'), 'Europe/Berlin');
  assert.equal(readPageString(html, 'eventsServerUrl'), 'https://event.esri.com/');
  assert.equal(readPageString(html, 'eventName'), "Esri's 'Agenda'");
  assert.throws(() => readPageString('var eventId = execute();', 'eventId'), /no longer exposes/);
});

test('follows section-to-flat pagination and preserves repeated session occurrences', async () => {
  const calls = [];
  const api = async (endpoint, body) => {
    calls.push(body);
    if (body.from === '0') return { totalSearchItems: 3, sectionList: [{ sectionId: '1', ...page([item('a', 'a1'), item('a', 'a2')], 0, 3) }], attributes: [{ name: 'Topic' }] };
    return page([item('b')], 2, 3);
  };
  const result = await collectCatalog(api, { type: 'session' }, 2, quiet);
  assert.equal(result.items.length, 3);
  assert.equal(result.items.filter(entry => entry.sessionID === 'a').length, 2);
  assert.deepEqual(calls[1], { type: 'session', from: '2', size: '2', sectionId: '1' });
});

test('handles multiple catalogue sections', async () => {
  const api = async (_, body) => body.from === '0'
    ? { totalSearchItems: 3, sectionList: [{ sectionId: 'a', ...page([item('1')], 0, 2) }, { sectionId: 'b', ...page([item('3')], 0, 1) }] }
    : page([item('2')], 1, 2);
  assert.equal((await collectCatalog(api, {}, 1, quiet)).total, 3);
});

test('rejects empty, repeated, truncated, or changing catalogue pages', async () => {
  await assert.rejects(collectCatalog(async () => page([], 0, 0), {}, 2, quiet), /Empty or incomplete/);
  for (const next of [page([], 1, 2), page([item('a')], 1, 2), page([item('b')], 1, 3), page([item('b')], 0, 2)]) {
    await assert.rejects(collectCatalog(async (_, body) => body.from === '0' ? page([item('a')], 0, 2) : next, {}, 1, quiet), /Incomplete|repeated|changed/);
  }
});

test('retries transient HTTP failures and accepts loadPage envelopes', async () => {
  let count = 0;
  const waits = [];
  const request = createClient({ delayMs: 0, log: quiet, sleepImpl: async ms => waits.push(ms), fetchImpl: async () => {
    count++;
    return count === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } })
      : new Response(JSON.stringify({ data: { responseCode: '0', answer: 42 } }));
  } });
  assert.equal((await request('https://event.esri.com/api/sessions')).data.answer, 42);
  assert.equal(count, 2);
  assert.ok(waits.includes(2000));
});

test('does not retry permanent HTTP errors, invalid JSON, or API failure codes', async () => {
  for (const response of [new Response('', { status: 403 }), new Response('<html>login</html>'), new Response('{"responseCode":"101"}')]) {
    let count = 0;
    const request = createClient({ delayMs: 0, sleepImpl: async () => {}, fetchImpl: async () => { count++; return response; } });
    await assert.rejects(request('https://event.esri.com/api/sessions'));
    assert.equal(count, 1);
  }
});

test('stops after bounded transient retries', async () => {
  let count = 0;
  const request = createClient({ retries: 2, delayMs: 0, log: quiet, sleepImpl: async () => {}, fetchImpl: async () => { count++; return new Response('', { status: 503 }); } });
  await assert.rejects(request('https://event.esri.com/api/sessions'), /HTTP 503/);
  assert.equal(count, 3);
});

function fixtureRequest({ missingSpeaker = false, changedCount = false } = {}) {
  let searches = 0;
  const session = { ...item('a'), abstract: '<p>Full description</p>', participants: [{ speakerId: 's', fullName: 'Speaker' }], attributevalues: [{ attribute: 'Topic', value: 'Web' }] };
  return async (url, options) => {
    if (options?.json === false) return `var workflowApiToken = 'public-workflow'; var eventTimeZone = 'Europe/Berlin'; var eventId = 'event';`;
    if (url.includes('loadPage')) return { data: { responseCode: '0', eventsUrl: 'event.esri.com', widgetConf: { apiProfileToken: 'public-api-token', widgetToken: 'public-widget-token' }, rfcsrf: 'csrf-value' } };
    switch (new URL(url).pathname) {
      case '/api/widgetConfig': return { config: { componentConfigs: [{ dataSetFilterCode: 'dev-catalog' }] } };
      case '/api/sessions': searches++; return page([session], 0, changedCount && searches === 2 ? 2 : 1);
      case '/api/session': return { items: [session] };
      case '/api/speaker': return { items: missingSpeaker ? [] : [{ speakerId: 's', bio: 'Full biography', jobTitle: 'Engineer' }] };
      default: throw new Error(`Unexpected URL ${url}`);
    }
  };
}

test('fetches full sessions and speaker profiles without persisting request tokens', async () => {
  const result = await scrapeAgenda({ request: fixtureRequest(), log: quiet });
  assert.deepEqual(result.counts, { catalogEntries: 1, sessions: 1, speakers: 1 });
  assert.equal(result.sessions[0].abstract, '<p>Full description</p>');
  assert.equal(result.speakers[0].jobTitle, 'Engineer');
  assert.equal(result.source.url, SOURCE_URL);
  assert.doesNotMatch(JSON.stringify(result), /public-api-token|public-widget-token|csrf-value/);
});

test('fails the full scrape if a speaker is missing or catalogue count changes', async () => {
  await assert.rejects(scrapeAgenda({ request: fixtureRequest({ missingSpeaker: true }), log: quiet }), /Speaker s was not returned/);
  await assert.rejects(scrapeAgenda({ request: fixtureRequest({ changedCount: true }), log: quiet }), /total changed/);
});

test('writes atomically, skips unchanged data, and detects changes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agenda-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'data', 'agenda.json');
  const capture = { sessions: [item('a')], counts: { sessions: 1 } };
  assert.equal(await saveSnapshot(output, capture, { now: () => 'first' }), true);
  const first = await readFile(output, 'utf8');
  assert.equal(await saveSnapshot(output, capture, { now: () => 'second' }), false);
  assert.equal(await readFile(output, 'utf8'), first);
  assert.equal(await saveSnapshot(output, { ...capture, sessions: [item('b')] }, { now: () => 'third' }), true);
  assert.equal(JSON.parse(await readFile(output)).scrapedAt, 'third');
  await writeFile(output, 'broken previous snapshot');
  await assert.rejects(saveSnapshot(output, capture), SyntaxError);
  assert.equal(await readFile(output, 'utf8'), 'broken previous snapshot');
});
