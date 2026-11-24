import '../../config/env';
import { parseArgs } from 'node:util';
import { loadData } from '../agent/load';
import { DateSchema, type TrialResult } from '../types/index';
import { createClient, emptyUsage } from '../agent/llm';
import { createSession } from '../agent/tools';
import { createConversation, runAgentTurn } from '../agent/agent';
import { scenarios } from './scenarios';
import { simulate } from './simulator';
import { policyCheck, trialResult } from './judge';
import { report, saveReport } from './report';
async function main() {
  const {values} = parseArgs({options: {'run-id': {type: 'string', default: 'dev'}, trials: {type: 'string', default: '1'}, only: {type: 'string'}, 'no-guardrails': {type: 'boolean', default: false}, today: {type: 'string'}, config: {type: 'string', default: 'config/lumen.json'}}});
  const runId = values['run-id'];
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid run ID');
  const trials = Number(values.trials);
  if (![1, 3].includes(trials)) throw new Error('--trials must be 1 or 3');
  const data = loadData(values.config), guardrails = !values['no-guardrails'];
  const today = DateSchema.parse(values.today ?? new Intl.DateTimeFormat('en-CA', {timeZone: data.config.timezone}).format(new Date()));
  const requested = values.only?.split(',').map(Number) ?? (runId === 'smoke' ? [1, 5, 11] : undefined);
  const all = scenarios(data, today);
  if (requested?.some(id => !all.some(s => s.id === id))) throw new Error('--only contains an unknown scenario ID');
  const selected = requested ? all.filter(s => requested.includes(s.id)) : all;
  const usage = emptyUsage(), complete = createClient(usage), results: TrialResult[] = [];
  console.log(`${runId}: ${selected.length} scenarios × ${trials} trial(s), guardrails ${guardrails ? 'on' : 'off'}`);
  for (const scenario of selected) for (let trial = 1; trial <= trials; trial++) {
    const session = createSession(data, today, guardrails), conversation = createConversation(session, complete);
    let error: string | undefined;
    let judged = {pass: false, violated_rules: [] as number[], reason: 'Evaluation did not finish.'};
    try {
      let done = false;
      for (let turn = 0; turn < 12; turn++) {
        const reply = await simulate(complete, scenario, session.trace);
        // The simulator often appends the marker to a closing sentence; that sentence is not sent.
        if (reply.includes('###DONE###')) {done = true; break;}
        await runAgentTurn(conversation, reply);
      }
      if (!done) error = 'Conversation reached the 12-turn cap.';
      judged = await policyCheck(complete, scenario, session);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Unknown evaluation failure';
      // Fail fast on account/model failures; never spend a full run retrying them.
      if (/401|403|404|credit balance|invalid.*model|not_found_error/i.test(error)) throw new Error(`API setup error: ${error}`);
    }
    const result = trialResult(scenario, session, trial, judged, error); results.push(result);
    await saveReport(report(data, runId, results, trials, guardrails, today, 'live', usage, 'running'));
    console.log(`  ${result.pass ? 'PASS' : 'FAIL'} ${scenario.id}.${trial} ${scenario.title}${error ? ` — ${error}` : ''}`);
  }
  const final = report(data, runId, results, trials, guardrails, today, 'live', usage);
  await saveReport(final);
  console.log(JSON.stringify(final.summary, null, 2));
  // Policy failures are data, operational errors fail the CLI.
  if (results.some(r => r.error)) process.exitCode = 1;
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
