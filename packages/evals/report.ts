import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RunResultSchema, type RunResult, type TrialResult, type Usage } from '../types/index';
import { models } from '../../config/models';
import { root, type Data } from '../agent/load';
export function report(data: Data, runId: string, results: TrialResult[], trials: number, guardrails: boolean, today: string, mode: 'live' | 'demo', usage: Usage, status: 'running' | 'completed' = 'completed'): RunResult {
  const ids = [...new Set(results.map(r => r.scenario_id))];
  const submitted = results.filter(r => r.submitted_claim);
  return RunResultSchema.parse({schema_version: 1, status, run_id: runId, model: mode === 'live' ? models.agent : 'scripted-demo', models: mode === 'live' ? models : {}, created_at: new Date().toISOString(), today, mode, guardrails,
    insurer: {name: data.config.display_name, currency: data.config.currency, claim_labels: Object.fromEntries(Object.entries(data.config.claim_types).map(([key, val]) => [key, val.label]))},
    summary: {scenarios: ids.length, trials, pass_1: results.length ? results.filter(r => r.pass).length / results.length : 0,
      pass_3: status === 'completed' && trials === 3 && ids.every(id => results.filter(r => r.scenario_id === id).length === 3) ? ids.filter(id => results.filter(r => r.scenario_id === id).every(r => r.pass)).length / ids.length : null,
      complete_and_triaged: submitted.length ? submitted.filter(r => r.complete_and_triaged).length / submitted.length : null,
      supervisor_blocks: results.flatMap(r => r.transcript).filter(e => e.role === 'supervisor' && e.result === 'blocked').length,
      tool_rejections: results.flatMap(r => r.transcript).filter(e => e.role === 'tool' && e.rejected).length, usage}, results});
}
export async function saveReport(run: RunResult) {
  if (!/^[a-zA-Z0-9_-]+$/.test(run.run_id)) throw new Error('Run ID must contain only letters, digits, _ or -');
  await mkdir(resolve(root, 'runs'), {recursive: true});
  const path = resolve(root, 'runs', `${run.run_id}.json`);
  await writeFile(`${path}.tmp`, JSON.stringify(RunResultSchema.parse(run), null, 2) + '\n');
  await rename(`${path}.tmp`, path);
}
