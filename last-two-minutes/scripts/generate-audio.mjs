import { mkdir, writeFile } from 'node:fs/promises';
import { CONTRACT } from '../src/show/contract.ts';
import { synthesizeCue } from '../src/audio/synthesis.ts';

const directory = new URL('../public/audio/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [index, kind] of ['shot', 'shield', 'impact', 'breakup'].entries()) {
  const sound = synthesizeCue(kind, CONTRACT.seed + index * 101);
  await writeFile(new URL(`${kind}.wav`, directory), new Uint8Array(await sound.arrayBuffer()));
}
console.log('Generated four original seeded PCM cues for same-origin preloading.');
