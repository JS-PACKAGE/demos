import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const destination = resolve(root, '.pages');
const domain = await readFile(resolve(root, 'CNAME'), 'utf8');
const license = await readFile(resolve(root, 'LICENSE'), 'utf8');
if (domain.trim() !== 'demos.js-package.xyz' || !license.includes('GNU AFFERO GENERAL PUBLIC LICENSE'))
  throw new Error('倉庫網域或 AGPL-3.0 授權與企劃不符。');
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
if (!html.includes('/last-two-minutes/') || !html.includes('http-equiv="Content-Security-Policy"') || /<video\b/i.test(html))
  throw new Error('請先執行 GAME_BASE=/last-two-minutes/ pnpm build；正式頁需 CSP 且不得使用影片。');
await stat(resolve(dist, 'engine/src/index.js'));
// An absent output prevents accidentally publishing stale files or other demos.
await mkdir(destination);
await cp(dist, resolve(destination, 'last-two-minutes'), { recursive: true });
await cp(resolve(root, 'CNAME'), resolve(destination, 'CNAME'));
await cp(resolve(root, '.nojekyll'), resolve(destination, '.nojekyll'));
console.log(`Pages artifact prepared: ${destination}`);
