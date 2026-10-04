import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

export const deploymentCSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'";
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const generated = new Set([
  'offline-manifest.json',
  'offline-worker.js',
  'offline-client.js',
  '_headers',
  'deployment-headers.json',
]);
async function inventory(directory, prefix = '') {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      paths.push(...(await inventory(join(directory, entry.name), name + '/')));
    else if (entry.isFile()) paths.push(name);
    else
      throw new Error(
        `Deployment must not contain symlinks or special files: ${name}`,
      );
  }
  return paths.sort();
}

/** Run only on the production output, never on a source/public directory. */
export async function prepareDeployment(directory, { offline = false } = {}) {
  const root = resolve(directory);
  if (!(await lstat(root)).isDirectory())
    throw new Error('Expected production output directory.');
  const html = join(root, 'index.html');
  let document = await readFile(html, 'utf8');
  if (
    !offline &&
    (document.includes('src="./offline-client.js"') ||
      (await readdir(root)).some((name) =>
        [
          'offline-client.js',
          'offline-worker.js',
          'offline-manifest.json',
        ].includes(name),
      ))
  )
    throw new Error(
      'Offline artifacts already exist. Disable offline by rebuilding a clean production output; existing files are not removed.',
    );
  if (
    /<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(document) ||
    /<style\b|\s(?:on\w+|style)\s*=/i.test(document)
  )
    throw new Error(
      'Production HTML contains inline code/styles incompatible with strict CSP.',
    );
  if (offline && !document.includes('src="./offline-client.js"')) {
    document = document.replace(
      '</body>',
      '    <script type="module" src="./offline-client.js"></script>\n  </body>',
    );
    await writeFile(html, document);
  }
  const headers = {
    'Content-Security-Policy': deploymentCSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'public, max-age=0, must-revalidate',
  };
  await writeFile(
    join(root, 'deployment-headers.json'),
    JSON.stringify(
      {
        headers,
        serviceWorker: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'text/javascript; charset=utf-8',
        },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    join(root, '_headers'),
    '/*\n' +
      Object.entries(headers)
        .map(([name, value]) => `  ${name}: ${value}`)
        .join('\n') +
      '\n',
  );
  if (!offline) return { offline: false, headers };
  const runtime = new URL('./offline/', import.meta.url);
  await writeFile(
    join(root, 'offline-client.js'),
    await readFile(new URL('client.js', runtime)),
  );
  const resources = [];
  for (const path of await inventory(root)) {
    if (generated.has(path) && path !== 'offline-client.js') continue;
    if (
      path.split('/').some((part) => part.startsWith('.')) ||
      /(?:^|\/)(?:[^/]*\.(?:pem|key|p12|pfx)|\.env[^/]*|credentials[^/]*|secrets[^/]*)$/i.test(
        path,
      )
    )
      throw new Error(
        `Private/hidden file is not permitted in offline deployment: ${path}`,
      );
    const bytes = await readFile(join(root, path));
    resources.push({ path, bytes: bytes.length, sha256: digest(bytes) });
  }
  const manifest = {
    format: 1,
    version: digest(JSON.stringify(resources)),
    resources,
  };
  await writeFile(
    join(root, 'offline-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  const worker = await readFile(new URL('service-worker.js', runtime), 'utf8');
  await writeFile(
    join(root, 'offline-worker.js'),
    `const buildManifest = ${JSON.stringify(manifest)};\n${worker}`,
  );
  return manifest;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [directory, flag] = process.argv.slice(2);
  if (
    !directory ||
    (flag !== undefined && flag !== '--offline') ||
    process.argv.length > 4
  )
    throw new Error(
      'Usage: node scripts/offline-deployment.mjs <production-directory> [--offline]',
    );
  await prepareDeployment(directory, { offline: flag === '--offline' });
}
