#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { renderMarkdown } from './lib/agenda.mjs';
import { validateData } from './validate-data.mjs';

const files = ['agenda.json', 'agenda.md', 'agenda.schema.json', 'index.html'];

function git(cwd, args, allowed = [0]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status)) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return { status: result.status, output: result.stdout.trim() };
}

export async function publishAgenda({ directory = 'public', repository = process.cwd(), remote = 'origin' } = {}) {
  directory = resolve(directory);
  repository = resolve(repository);
  const content = new Map(await Promise.all(files.map(async name => [name, await readFile(join(directory, name), 'utf8')])));
  const agenda = JSON.parse(content.get('agenda.json'));
  const errors = validateData(agenda);
  if (errors.length) throw new Error(`Invalid public agenda:\n${errors.join('\n')}`);
  if (content.get('agenda.md') !== renderMarkdown(agenda)) throw new Error('Markdown does not match the JSON agenda');
  const sourceCommit = git(repository, ['rev-parse', 'HEAD']).output;
  const exists = git(repository, ['ls-remote', '--exit-code', '--heads', remote, 'refs/heads/gh-pages'], [0, 2]).status === 0;
  let base = 'HEAD';
  if (exists) {
    git(repository, ['fetch', '--no-tags', remote, 'refs/heads/gh-pages']);
    base = git(repository, ['rev-parse', 'FETCH_HEAD']).output;
  }
  const temporary = await mkdtemp(join(tmpdir(), 'agenda-publication-'));
  const worktree = join(temporary, 'site');
  const branch = basename(temporary);
  let added = false;
  let orphan = false;
  try {
    git(repository, ['worktree', 'add', '--detach', worktree, base]);
    added = true;
    if (!exists) {
      git(worktree, ['switch', '--orphan', branch]);
      orphan = true;
    } else {
      const previous = JSON.parse(await readFile(join(worktree, 'agenda.json'), 'utf8'));
      // Keep the first capture time for unchanged source content; raw artifacts retain each run's capture time.
      if (previous.source.contentSha256 === agenda.source.contentSha256) {
        agenda.source.scrapedAt = previous.source.scrapedAt;
        const errors = validateData(agenda);
        if (errors.length) throw new Error(`Invalid publication timestamp:\n${errors.join('\n')}`);
        content.set('agenda.json', `${JSON.stringify(agenda, null, 2)}\n`);
        content.set('agenda.md', renderMarkdown(agenda));
      }
    }
    git(worktree, ['rm', '-r', '--ignore-unmatch', '.']);
    for (const [name, value] of content) {
      await writeFile(join(worktree, name), value);
      // The Pages artifact and history branch must contain the same files.
      await writeFile(join(directory, name), value);
    }
    git(worktree, ['add', '--', ...files]);
    const changed = git(worktree, ['diff', '--cached', '--quiet'], [0, 1]).status === 1;
    if (changed) {
      git(worktree, ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '-m', 'data: refresh agenda', '-m', `Source SHA-256: ${agenda.source.contentSha256}\nGenerator commit: ${sourceCommit}`]);
      git(worktree, ['push', remote, 'HEAD:refs/heads/gh-pages']);
    }
    return { changed, commit: git(worktree, ['rev-parse', 'HEAD']).output };
  } finally {
    if (added) git(repository, ['worktree', 'remove', '--force', worktree]);
    if (orphan && git(repository, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], [0, 1]).status === 0) {
      git(repository, ['branch', '-D', branch]);
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: { directory: { type: 'string', default: 'public' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log('Usage: node scripts/publish-agenda.mjs [--directory public]\n\nPushes validated site exports to origin/gh-pages with normal history commits.');
    return;
  }
  const result = await publishAgenda({ directory: values.directory });
  console.log(`${result.changed ? 'Updated' : 'Unchanged'} gh-pages: ${result.commit}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Publication failed: ${error.message}`); process.exitCode = 1; });
}
