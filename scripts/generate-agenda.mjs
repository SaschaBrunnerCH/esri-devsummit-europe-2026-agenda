#!/usr/bin/env node
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildAgenda, renderMarkdown } from './lib/agenda.mjs';
import { validateData } from './validate-data.mjs';

async function writeChanged(path, content) {
  try { if (await readFile(path, 'utf8') === content) return false; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
  return true;
}

export async function generateAgenda({ input = 'data/raw/agenda.json', outputDir = 'public' } = {}) {
  const snapshot = JSON.parse(await readFile(input, 'utf8'));
  const rawErrors = validateData(snapshot, { raw: true });
  if (rawErrors.length) throw new Error(`Invalid raw capture:\n${rawErrors.join('\n')}`);
  const agenda = buildAgenda(snapshot);
  const errors = validateData(agenda);
  if (errors.length) throw new Error(`Invalid public agenda:\n${errors.join('\n')}`);
  const exports = [
    ['agenda.json', `${JSON.stringify(agenda, null, 2)}\n`],
    ['agenda.md', renderMarkdown(agenda)],
    ['agenda.schema.json', await readFile(new URL('../schemas/agenda.schema.json', import.meta.url), 'utf8')],
    ['index.html', await readFile(new URL('../site/index.html', import.meta.url), 'utf8')],
  ];
  await mkdir(outputDir, { recursive: true });
  const changed = [];
  for (const [name, content] of exports) if (await writeChanged(join(outputDir, name), content)) changed.push(name);
  return { changed, sessions: agenda.sessions.length, speakers: agenda.speakers.length,
    occurrences: agenda.sessions.reduce((total, session) => total + session.occurrences.length, 0) };
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: 'string', default: 'data/raw/agenda.json' },
    'output-dir': { type: 'string', default: 'public' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log(`Usage: node scripts/generate-agenda.mjs [options]

  --input PATH       Raw capture (default: data/raw/agenda.json)
  --output-dir PATH  Site output directory (default: public)
  --help, -h         Show this help

Validates before writing. Unchanged exports are left untouched.`);
    return;
  }
  const result = await generateAgenda({ input: values.input, outputDir: values['output-dir'] });
  console.log(`${result.changed.length ? `Updated ${result.changed.join(', ')}` : 'Exports unchanged'} in ${values['output-dir']}: ${result.sessions} sessions, ${result.occurrences} occurrences, ${result.speakers} speakers.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Generation failed: ${error.message}`); process.exitCode = 1; });
}
