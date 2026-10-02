#!/usr/bin/env node
// Local agenda page server. An explicit route list keeps raw data and repository files out of the preview.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';
import { siteFiles } from './generate-agenda.mjs';

const { values } = parseArgs({ options: { port: { type: 'string', default: '4173' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.webp': 'image/webp' };
const routes = new Map([
  ['/', ['../site/index.html', 'text/html; charset=utf-8']],
  ...siteFiles.map(name => [`/${name}`, [`../site/${name}`, contentTypes[extname(name)] ?? 'application/octet-stream']]),
  ['/agenda.json', ['../public/agenda.json', 'application/json; charset=utf-8']],
  ['/agenda.md', ['../public/agenda.md', 'text/markdown; charset=utf-8']],
  ['/agenda.schema.json', ['../public/agenda.schema.json', 'application/schema+json; charset=utf-8']],
]);
const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  try {
    const route = routes.get(new URL(request.url, 'http://localhost').pathname);
    if (!route) { response.writeHead(404); response.end('Not found'); return; }
    const content = await readFile(new URL(route[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': route[1], 'Content-Length': content.length, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code === 'ERR_INVALID_URL') { response.writeHead(400); response.end('Invalid request URL'); return; }
    response.writeHead(error.code === 'ENOENT' ? 404 : 500);
    response.end('Local preview file unavailable. Run npm run generate for the agenda exports.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local agenda page: http://localhost:${port}/\nPress Ctrl+C to stop.`));
