import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildKeywordCatalog, splitKeywords } from '../scripts/lib/keywords.mjs';
import { validateData } from '../scripts/validate-data.mjs';
import { buildAgenda } from '../scripts/lib/agenda.mjs';

const session = (id, value) => ({ sessionID: id, attributevalues: [{ attribute_id: 'Keywords', value }] });

test('splits mixed explicit delimiters and preserves phrases and compounds', () => {
  assert.deepEqual(splitKeywords('Python; Real-Time, web components\r\nArcGIS Online · UI/UX; CI/CD'),
    ['Python', 'Real-Time', 'web components', 'ArcGIS Online', 'UI/UX', 'CI/CD']);
  assert.deepEqual(splitKeywords(' , ; \n\r · '), []);
  assert.deepEqual(splitKeywords(null), []);
});

test('protects commas inside parentheses and quoted phrases', () => {
  assert.deepEqual(splitKeywords('Mapping (2D, 3D), "cloud, data", JavaScript'), ['Mapping (2D, 3D)', 'cloud, data', 'JavaScript']);
  assert.deepEqual(splitKeywords('"say ""hello""", Python'), ['say "hello"', 'Python']);
  assert.throws(() => splitKeywords('Mapping (2D, 3D'), /Unbalanced/);
  assert.throws(() => splitKeywords('"cloud, data'), /Unbalanced/);
});

test('uses exact reviewed overrides without splitting all spaces or stripping all periods', () => {
  assert.deepEqual(splitKeywords('AI Testing Enterprise Pro Claude GPT ChatGPT Copilot Data'),
    ['AI', 'Testing', 'Enterprise', 'Pro', 'Claude', 'GPT', 'ChatGPT', 'Copilot', 'Data']);
  assert.deepEqual(splitKeywords('JavaScript, Disaster Recovery., .NET'), ['JavaScript', 'Disaster Recovery', '.NET']);
  assert.deepEqual(splitKeywords('ArcGIS Maps SDK for JavaScript'), ['ArcGIS Maps SDK for JavaScript']);
});

test('merges reviewed aliases and case variants, deduplicating per-session assignments', () => {
  const result = buildKeywordCatalog([session('s', 'AI, artificial intelligence, JavaScript, javascript, GeoAI, Geospatial AI, ArcGIS Notebok Server')]);
  assert.deepEqual(result.sessionKeywords.get('s'), ['AI', 'ArcGIS Notebook Server', 'GeoAI', 'JavaScript']);
  assert.ok(result.catalog.find(term => term.label === 'AI').aliases.includes('artificial intelligence'));
  assert.equal(result.catalog.find(term => term.label === 'AI').sessionCount, 1);
});

test('does not merge nearby but different concepts', () => {
  const result = buildKeywordCatalog([session('s', 'AI, AI assistants, Agentic AI, MCP, MCP Server, REST, REST APIs')]);
  assert.equal(result.catalog.length, 7);
});

test('catalogue and readable labels are independent of session traversal order', () => {
  const sessions = [session('s1', 'data, Data, Python'), session('s2', 'DATA, python, web app')];
  const first = buildKeywordCatalog(sessions);
  const reversed = buildKeywordCatalog([...sessions].reverse());
  assert.deepEqual(first.catalog, reversed.catalog);
  assert.deepEqual(first.sessionKeywords.get('s1'), reversed.sessionKeywords.get('s1'));
});

test('new ambiguous undelimited phrases produce a review diagnostic and stay intact', () => {
  const result = buildKeywordCatalog([session('s', 'Alpha Beta Gamma Delta')]);
  assert.equal(result.catalog.length, 1);
  assert.equal(result.diagnostics.length, 1);
});

test('preserves distinct punctuation and non-Latin keyword labels', () => {
  const result = buildKeywordCatalog([session('s', 'C++, C#, .NET, UI/UX, 地図')]);
  assert.deepEqual(result.sessionKeywords.get('s'), ['.NET', 'C#', 'C++', 'UI/UX', '地図']);
});

test('conflicting reviewed aliases require explicit resolution', () => {
  const conflicting = { terms: [{ label: 'One', aliases: ['same'] }, { label: 'Two', aliases: ['same'] }], exactOverrides: [] };
  assert.throws(() => buildKeywordCatalog([], conflicting), /Conflicting configured keyword alias/);
});

test('fixture keywords produce valid readable session labels', async () => {
  const raw = JSON.parse(await readFile(new URL('./fixtures/raw-agenda.json', import.meta.url), 'utf8'));
  const proposed = buildAgenda(raw);
  const parsed = buildKeywordCatalog(raw.sessions);
  assert.deepEqual(validateData(proposed), []);
  for (const entry of proposed.sessions) {
    assert.deepEqual(entry.keywords, parsed.sessionKeywords.get(entry.id));
    assert.equal(new Set(entry.keywords).size, entry.keywords.length);
  }
});

test('public keyword lists accept labels and reject duplicates and blank values', async () => {
  const raw = JSON.parse(await readFile(new URL('./fixtures/raw-agenda.json', import.meta.url), 'utf8'));
  const proposed = buildAgenda(raw);
  proposed.sessions[0].keywords = ['C++', 'C#'];
  assert.deepEqual(validateData(proposed), []);
  for (const keywords of [['AI', 'AI'], [''], [' '], [null]]) {
    const invalid = structuredClone(proposed);
    invalid.sessions[0].keywords = keywords;
    assert.ok(validateData(invalid).length);
  }
});
