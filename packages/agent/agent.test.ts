import { describe, it, expect } from 'vitest';
import { loadData } from './load';
import { createSession, executeTool, record, stamp } from './tools';
import { createConversation, runAgentTurn } from './agent';
import { stateChecks } from './supervisor';
import type { Complete, Completion } from './llm';
const data = loadData();
const input = {member_id: 'LM-1001', claim_type: 'gp', amount: 45, visit_date: '2026-11-17', documents: ['receipt']};
function session(guardrails = true) {
  const s = createSession(data, '2026-11-24', guardrails);
  executeTool(s, 'verify_member', {member_id: 'LM-1001', dob: '1991-04-12'}); return s;
}
const submit = {...input, outcome: 'fast_track', summary_for_adjuster: 'GP visit, receipt declared.'};
const text = (value: string): Completion => ({content: [{type: 'text', text: value}]});
function queued(responses: Completion[]): Complete {
  return async () => {const next = responses.shift(); if (!next) throw new Error('Unexpected extra completion'); return next;};
}
describe('tool boundaries', () => {
  it('requires verified identity even in baseline mode', () => {
    const s = createSession(data, '2026-11-24', false);
    expect(executeTool(s, 'check_claim', input).rejected).toBe(true);
    executeTool(s, 'verify_member', {member_id: 'LM-1001', dob: '1991-04-12'});
    expect(executeTool(s, 'check_claim', {...input, member_id: 'LM-1002'}).rejected).toBe(true);
    executeTool(s, 'verify_member', {member_id: 'LM-1001', dob: '1990-01-01'});
    expect(s.member).toBeUndefined();
  });
  it('rejects missing docs, mis-triage and ineligible submissions', () => {
    for (const changes of [{documents: []}, {amount: 90}, {visit_date: '2026-01-01'}]) {
      const s = session(); expect(executeTool(s, 'submit_claim', {...submit, ...changes}).rejected).toBe(true); expect(s.submitted).toBeUndefined();
    }
  });
  it('baseline really bypasses the submission recheck', () => expect(executeTool(session(false), 'submit_claim', {...submit, documents: []}).rejected).toBe(false));
  it('keeps changed amounts in review, even when both are within the limit', () => {
    const s = session(); executeTool(s, 'check_claim', {...input, amount: 40});
    expect(executeTool(s, 'submit_claim', submit).rejected).toBe(true);
  });
  it('is idempotent and escalates an existing claim on handoff', () => {
    const s = session(); const first = executeTool(s, 'submit_claim', submit);
    expect(executeTool(s, 'submit_claim', submit).output).toEqual(first.output);
    executeTool(s, 'handoff_to_human', {reason: 'dispute'});
    expect(s.submitted?.outcome).toBe('needs_review');
    expect(executeTool(s, 'submit_claim', {...submit, amount: 50}).rejected).toBe(true);
  });
});
describe('runtime supervisor and delivery', () => {
  it('blocks promises, invented facts and unverified disclosure', () => {
    const s = session();
    expect(stateChecks('I cannot share plan limits until you are verified.', createSession(data, s.today)).pass).toBe(true);
    expect(stateChecks("You'll be paid by Friday.", s).pass).toBe(false);
    expect(stateChecks('Claim CL-MADEUP is ready.', s).check).toBe('invented_id');
    expect(stateChecks('You have SGD 999 available.', s).check).toBe('invented_amount');
    expect(stateChecks('Your plan covers SGD 60.', createSession(data, s.today)).check).toBe('unverified_disclosure');
    executeTool(s, 'check_claim', input);
    expect(stateChecks('The plan limit is SGD 60. I cannot promise payment.', s).pass).toBe(true);
  });
  it('allows honest non-submission wording but blocks an invented submission', () => {
    const s = session();
    for (const ok of ['Nothing has been submitted for this visit.', 'No claim was submitted, as the limit is used up.', "Your claim wasn't submitted.", "I'll tell you once it has been submitted."])
      expect(stateChecks(ok, s).pass).toBe(true);
    for (const bad of ["I've submitted your claim.", 'Your claim is with the adjuster now.', 'Good news. It has been submitted.'])
      expect(stateChecks(bad, s).check).toBe('invented_submission');
  });
  it('lets the agent repeat amounts the customer gave, before and after verification', () => {
    const fresh = createSession(data, '2026-11-24');
    record(fresh, {role: 'customer', timestamp: stamp(), text: 'I paid 45 for a GP visit.'});
    expect(stateChecks('Thanks. Once you are verified I can check the SGD 45 visit.', fresh).pass).toBe(true);
    expect(stateChecks('Your limit is SGD 60.', fresh).check).toBe('unverified_disclosure');
    const s = session(); record(s, {role: 'customer', timestamp: stamp(), text: 'It cost S$45.'});
    expect(stateChecks('Got it, SGD 45.', s).pass).toBe(true);
    expect(stateChecks('You have SGD 999 left.', s).check).toBe('invented_amount');
  });
  it('treats an amount changed in conversation as a changed detail, with guardrails only', () => {
    for (const guardrails of [true, false]) {
      const s = session(guardrails);
      record(s, {role: 'customer', timestamp: stamp(), text: 'It cost 40 SGD. Sorry, the receipt says SGD 45.'});
      expect((executeTool(s, 'check_claim', input).output as {suggested_outcome: string}).suggested_outcome).toBe(guardrails ? 'needs_review' : 'fast_track');
    }
    const s = session(); record(s, {role: 'customer', timestamp: stamp(), text: 'The receipt is SGD 45.'});
    executeTool(s, 'check_claim', input); record(s, {role: 'customer', timestamp: stamp(), text: 'So SGD 60 is my limit?'});
    expect(executeTool(s, 'submit_claim', submit).rejected).toBe(false);
  });
  it('treats refusals to promise payment as safe', () => {
    const s = session();
    expect(stateChecks("I can't promise payment by Friday, or by any date.", s).pass).toBe(true);
    expect(stateChecks("I can't say whether you'll be paid by Friday.", s).pass).toBe(true);
    expect(stateChecks("If it's approved, you'll be paid by Friday.", s).check).toBe('payment_promise');
  });
  it('accepts only configured document keys and reports the currency', () => {
    const s = session();
    expect(executeTool(s, 'check_claim', {...input, documents: ['dental receipt']}).rejected).toBe(true);
    expect(executeTool(s, 'check_claim', input).output).toMatchObject({currency: data.config.currency, suggested_outcome: 'fast_track'});
  });
  it('rewrites once before sending and appends exact template wording', async () => {
    const s = session(); executeTool(s, 'submit_claim', submit);
    const complete = queued([text("You'll be paid by Friday."), text('The claims team will review your documents.'), text('{"quote":null}')]);
    const response = await runAgentTurn(createConversation(s, complete), 'Is it ready?');
    expect(response).not.toContain('Friday');
    expect(response).toContain(data.config.templates.after_submit.replace('{claim_id}', s.submitted!.claim_id));
    expect(s.trace.some(e => e.role === 'supervisor' && e.result === 'blocked')).toBe(true);
  });
  it('hands off safely after a second blocked draft', async () => {
    const s = session();
    const response = await runAgentTurn(createConversation(s, queued([text("You'll be paid by Friday."), text("You'll be paid by Friday.")])), 'Can you promise?');
    expect(s.ticket).toBeDefined(); expect(response).toContain(data.config.templates.safe_fallback);
    expect(s.trace.filter(e => e.role === 'supervisor')).toHaveLength(2);
  });
  it('never exposes text alongside tool calls without supervision', async () => {
    const s = session();
    const tool: Completion = {content: [{type: 'text', text: 'Your claim is approved.'}, {type: 'tool_use', id: 'call_1', name: 'check_claim', input}]};
    const response = await runAgentTurn(createConversation(s, queued([tool, text('I have checked the details.'), text('{"quote":null}')])), 'Please check.');
    expect(response).not.toContain('approved');
    expect(s.trace.some(e => e.role === 'agent' && !e.visible && e.text.includes('approved'))).toBe(true);
  });
});
