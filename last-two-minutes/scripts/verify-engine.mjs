import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const expected = '353d97d6e8fe16346fc75db04e1263bcd774fef370425d6fe1c9fe80136db915';
const archive = await readFile(new URL('../vendor/xyz.js.tgz', import.meta.url));
const sums = await readFile(new URL('../vendor/SHA256SUMS', import.meta.url), 'utf8');
const published = sums.trim().split(/\s+/);
const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== expected || published[0] !== expected || published[1] !== 'xyz.js-1.13.0.tgz')
  throw new Error('XYZ.js 發行包雜湊不符。停止安裝與建置；不得放寬門檻。');
console.log(`XYZ.js 1.13.0 SHA-256 verified: ${actual}`);
