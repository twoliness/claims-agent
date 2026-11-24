import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunResultSchema } from '../packages/types/index';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'packages/viewer/public/runs');
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
const files = (await readdir(resolve(root, 'runs'))).filter(f => f.endsWith('.json'));
const index: Array<{id: string; file: string; mode: string; guardrails: boolean}> = [];
for (const file of files) {
  const run = RunResultSchema.parse(JSON.parse(await readFile(resolve(root, 'runs', file), 'utf8')));
  await writeFile(resolve(output, file), JSON.stringify(run));
  index.push({id: run.run_id, file, mode: run.mode, guardrails: run.guardrails});
}
await writeFile(resolve(output, 'index.json'), JSON.stringify(index));
console.log(`Prepared ${index.length} validated runs for the static viewer.`);
