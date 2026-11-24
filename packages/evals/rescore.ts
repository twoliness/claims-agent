// Re-applies the current state checks to a saved run. No API calls: transcripts and judge verdicts are reused.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadData, root } from '../agent/load';
import { RunResultSchema, type TrialResult } from '../types/index';
import { scenarios } from './scenarios';
import { stateCheck, type EndState } from './judge';
import { report, saveReport } from './report';
const {values} = parseArgs({options: {'run-id': {type: 'string'}}});
if (!values['run-id']) throw new Error('Pass --run-id');
const run = RunResultSchema.parse(JSON.parse(readFileSync(resolve(root, 'runs', `${values['run-id']}.json`), 'utf8')));
const data = loadData(), all = scenarios(data, run.today);
function savedState(result: TrialResult): EndState {
  // Any verify_member call resets identity first, so the last one decides.
  const verify = result.transcript.filter(e => e.role === 'tool' && e.name === 'verify_member').at(-1);
  const verified = verify?.role === 'tool' && !verify.rejected && (verify.output as {verified?: boolean}).verified === true;
  const inactive = verified && verify?.role === 'tool' && (verify.output as {active?: boolean}).active === false;
  return {submitted: result.submitted_claim, ticket: result.handoff, verified, outcome: result.actual_outcome ?? (inactive ? 'not_applicable' : null)};
}
let flipped = 0;
const results = run.results.map(result => {
  const scenario = all.find(s => s.id === result.scenario_id);
  if (!scenario) throw new Error(`Scenario ${result.scenario_id} no longer exists`);
  const state = stateCheck(scenario, savedState(result));
  const pass = state.pass && result.policy_check.pass && !result.error;
  if (pass !== result.pass) {flipped++; console.log(`  ${pass ? 'FAIL→PASS' : 'PASS→FAIL'} ${result.scenario_id}.${result.trial} ${result.title}`);}
  return {...result, expected: scenario.expected, actual_outcome: savedState(result).outcome, state_check: state, pass};
});
const rescored = {...report(data, run.run_id, results, run.summary.trials, run.guardrails, run.today, run.mode, run.summary.usage), created_at: run.created_at, models: run.models, model: run.model};
await saveReport(rescored);
console.log(`${flipped} trial(s) changed. pass_1 ${run.summary.pass_1.toFixed(2)} → ${rescored.summary.pass_1.toFixed(2)}, pass_3 ${run.summary.pass_3?.toFixed(2)} → ${rescored.summary.pass_3?.toFixed(2)}`);
