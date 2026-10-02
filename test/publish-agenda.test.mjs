import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateAgenda } from '../scripts/generate-agenda.mjs';
import { publishAgenda } from '../scripts/publish-agenda.mjs';
import { saveSnapshot } from '../scripts/scrape-agenda.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/raw-agenda.json', import.meta.url), 'utf8'));

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'agenda-publish-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remote = join(directory, 'remote.git');
  const repository = join(directory, 'source');
  await mkdir(repository);
  git(directory, 'init', '--bare', remote);
  git(repository, 'init', '-b', 'main');
  await writeFile(join(repository, 'source.txt'), 'Source code stays on main.');
  git(repository, 'add', 'source.txt');
  git(repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Initial source');
  git(repository, 'remote', 'add', 'origin', remote);
  git(repository, 'push', 'origin', 'main');
  const input = join(directory, 'raw.json');
  const outputDir = join(directory, 'public');
  await writeFile(input, JSON.stringify(fixture));
  await generateAgenda({ input, outputDir });
  return { repository, remote, input, outputDir, options: { repository, directory: outputDir } };
}

test('publication creates a separate history containing only public files and no clock-only changes', async t => {
  const { repository, remote, input, outputDir, options } = await workspace(t);
  const main = git(repository, 'rev-parse', 'HEAD');
  const first = await publishAgenda(options);
  assert.equal(first.changed, true);
  assert.equal(git(remote, 'rev-list', '--count', 'gh-pages'), '1');
  assert.equal(git(remote, 'ls-tree', '-r', '--name-only', 'gh-pages'), 'agenda.json\nagenda.md\nagenda.schema.json\nindex.html');
  for (const name of ['agenda.json', 'agenda.md', 'agenda.schema.json', 'index.html']) {
    assert.equal(git(remote, 'show', `gh-pages:${name}`), (await readFile(join(outputDir, name), 'utf8')).trim());
  }
  const later = { ...structuredClone(fixture), scrapedAt: '2026-10-03T06:57:19.559Z' };
  await writeFile(input, JSON.stringify(later));
  await generateAgenda({ input, outputDir });
  assert.deepEqual(await publishAgenda(options), { changed: false, commit: first.commit });
  const published = JSON.parse(await readFile(join(outputDir, 'agenda.json'), 'utf8'));
  assert.equal(published.source.scrapedAt, fixture.scrapedAt);
  assert.ok((await readFile(join(outputDir, 'agenda.md'), 'utf8')).includes(fixture.scrapedAt));
  const { scrapedAt, contentSha256, ...payload } = later;
  payload.sessions[0].title = 'A changed source session';
  await saveSnapshot(input, payload, { now: () => scrapedAt });
  await generateAgenda({ input, outputDir });
  const second = await publishAgenda(options);
  assert.equal(second.changed, true);
  assert.notEqual(second.commit, first.commit);
  assert.equal(git(remote, 'rev-parse', 'gh-pages^'), first.commit);
  assert.equal(git(remote, 'rev-parse', 'main'), main);
  assert.equal(git(repository, 'rev-parse', 'HEAD'), main);
  assert.equal(git(repository, 'status', '--porcelain'), '');
  assert.equal(git(repository, 'worktree', 'list', '--porcelain').split('worktree ').length, 2);
});

test('invalid JSON or mismatched Markdown leaves the publication branch unchanged', async t => {
  const { remote, outputDir, options } = await workspace(t);
  const first = await publishAgenda(options);
  await writeFile(join(outputDir, 'agenda.md'), 'Stale Markdown');
  await assert.rejects(publishAgenda(options), /Markdown does not match/);
  const agenda = JSON.parse(await readFile(join(outputDir, 'agenda.json'), 'utf8'));
  agenda.sessions[0].speakers[0].speakerId = 'missing';
  await writeFile(join(outputDir, 'agenda.json'), JSON.stringify(agenda));
  await assert.rejects(publishAgenda(options), /unknown speaker/);
  assert.equal(git(remote, 'rev-parse', 'gh-pages'), first.commit);
});

test('a rejected push cleans up its temporary worktree and leaves remote history unchanged', async t => {
  const { repository, remote, options } = await workspace(t);
  await writeFile(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await assert.rejects(publishAgenda(options), /git push failed/);
  assert.equal(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/heads'), 'refs/heads/main');
  assert.equal(git(repository, 'branch', '--format=%(refname)'), 'refs/heads/main');
  assert.equal(git(repository, 'status', '--porcelain'), '');
  assert.equal(git(repository, 'worktree', 'list', '--porcelain').split('worktree ').length, 2);
});
