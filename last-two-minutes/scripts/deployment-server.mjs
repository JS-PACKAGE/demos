import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { deploymentCSP } from './offline-deployment.mjs';
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

/** Static public artifacts only; never point this at an application/source tree. */
export async function serveDeployment({
  directory,
  base = '/',
  port = 0,
  fault,
}) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))
    throw new Error('Base must be a canonical absolute directory path.');
  const root = await realpath(resolve(directory));
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', deploymentCSP);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    try {
      const url = new URL(request.url, 'http://localhost');
      if (
        !['GET', 'HEAD'].includes(request.method) ||
        !url.pathname.startsWith(base)
      ) {
        response.writeHead(404);
        response.end();
        return;
      }
      let name = decodeURIComponent(url.pathname.slice(base.length));
      if (name === '') name = 'index.html';
      if (
        name
          .split('/')
          .some(
            (part) => part === '..' || part === '.' || part.startsWith('.'),
          ) ||
        name.includes('\\')
      )
        throw new Error('Unsafe public path.');
      const path = await realpath(resolve(root, name));
      const rel = relative(root, path);
      if (isAbsolute(rel) || rel.startsWith('..'))
        throw new Error('Public path escapes deployment.');
      if (fault?.(name)) {
        response.writeHead(503);
        response.end('Deliberate deployment failure');
        return;
      }
      const bytes = await readFile(path);
      response.setHeader(
        'Content-Type',
        types[extname(name)] ?? 'application/octet-stream',
      );
      if (name === 'offline-worker.js')
        response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Content-Length', bytes.length);
      response.writeHead(200);
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 400);
      response.end('Public artifact unavailable');
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', accept);
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}${base}`,
    close: () =>
      new Promise((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      ),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [directory, base = '/', port = '4173'] = process.argv.slice(2);
  if (
    !directory ||
    !/^\d+$/.test(port) ||
    Number(port) > 65535 ||
    process.argv.length > 5
  )
    throw new Error(
      'Usage: node scripts/deployment-server.mjs <production-directory> [base=/] [port=4173]',
    );
  const deployment = await serveDeployment({
    directory,
    base,
    port: Number(port),
  });
  console.log(`Strict CSP production deployment: ${deployment.url}`);
}
