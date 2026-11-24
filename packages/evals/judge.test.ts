import { describe, it, expect } from 'vitest';
import { loadData } from '../agent/load';
import { createSession, executeTool } from '../agent/tools';
import { emptyUsage } from '../agent/llm';
import { stateCheck, endState, completeAndTriaged, trialResult } from './judge';
import { scenarios } from './scenarios';
import { report } from './report';
const data = loadData(), today = '2026-11-24', scenario = scenarios(data, today)[0];
function good() {
  const session = createSession(data, today); executeTool(session, 'verify_member', scenario.identity);
  executeTool(session, 'check_claim', scenario.claim);
  executeTool(session, 'submit_claim', {...scenario.claim, outcome: 'fast_track', summary_for_adjuster: 'Complete GP claim.'});
  return session;
}
describe('evaluation integrity', () => {
  it('requires the actual amount, documents and handoff state', () => {
    const s = good(); expect(stateCheck(scenario, endState(s)).pass).toBe(true);
    s.submitted!.amount = 50; expect(stateCheck(scenario, endState(s)).pass).toBe(false);
    s.submitted!.amount = 45; s.submitted!.documents = []; expect(completeAndTriaged(scenario, s)).toBe(false);
    executeTool(s, 'handoff_to_human', {reason: 'uncertainty'}); expect(stateCheck(scenario, endState(s)).pass).toBe(false);
  });
  it('accepts a handoff only where the scenario allows one', () => {
    const all = scenarios(data, today), noClaim = all.find(s => s.id === 7)!;
    const s = createSession(data, today); executeTool(s, 'verify_member', noClaim.identity); executeTool(s, 'check_claim', noClaim.claim);
    executeTool(s, 'handoff_to_human', {reason: 'customer asked for a person'});
    expect(stateCheck(noClaim, endState(s)).pass).toBe(true);
    expect(stateCheck(all.find(x => x.id === 5)!, {...endState(s), outcome: 'not_applicable'}).reasons).toContain('Unexpected human handoff.');
  });
  it('distinguishes trial pass rate from all-three reliability', () => {
    const s = good(); const result = trialResult(scenario, s, 1, {pass: true, violated_rules: [], reason: 'OK'});
    const results = [result, {...result, trial: 2}, {...result, trial: 3, pass: false}];
    const r = report(data, 'test', results, 3, true, today, 'demo', emptyUsage());
    expect(r.summary.pass_1).toBeCloseTo(2 / 3); expect(r.summary.pass_3).toBe(0);
    expect(report(data, 'partial', [result], 3, true, today, 'demo', emptyUsage(), 'running').summary.pass_3).toBeNull();
  });
  it('does not report a perfect score for zero submissions', () => {
    const s = createSession(data, today); const result = trialResult(scenario, s, 1, {pass: false, violated_rules: [], reason: 'Incomplete'});
    const run = report(data, 'empty', [result], 1, true, today, 'demo', emptyUsage());
    expect(run.summary.complete_and_triaged).toBeNull(); expect(run.summary.pass_3).toBeNull();
  });
});
