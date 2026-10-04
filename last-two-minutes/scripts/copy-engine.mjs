import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import console from 'node:console';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = fileURLToPath(import.meta.resolve('xyz.js'));
const dist = resolve(dirname(entry), '..');
for (const path of [
  'src/index.js',
  'src/index.d.ts',
  'vendor/opm/dist/api/index.js',
  'vendor/opm/dist/worklet/processor.js',
])
  await stat(resolve(dist, path));
const manifest = JSON.parse(
  await readFile(resolve(dist, '../package.json'), 'utf8'),
);
if (manifest.name !== 'xyz.js')
  throw new Error('Installed dependency is not xyz.js.');
const destination = resolve(root, 'public/engine');
await mkdir(resolve(root, 'public'), { recursive: true });
await rm(destination, { recursive: true, force: true });
await cp(dist, destination, { recursive: true });
await cp(resolve(dist, '../LICENSE'), resolve(destination, 'LICENSE'));
console.log(
  'Copied complete installed release dist, including official vendor/worklet assets.',
);
