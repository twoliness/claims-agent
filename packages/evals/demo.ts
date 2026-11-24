// Offline examples exercise real rules/tools. These are not LLM evaluation results.
import { loadData } from '../agent/load';
import { createSession, executeTool, record, stamp } from '../agent/tools';
import { appendTemplates } from '../agent/templates';
import { emptyUsage } from '../agent/llm';
import { scenarios } from './scenarios';
import { trialResult } from './judge';
import { report, saveReport } from './report';
const data = loadData(), today = '2026-11-24';
const results = scenarios(data, today).filter(s => [1, 2, 4, 5].includes(s.id)).map(s => {
  const session = createSession(data, today);
  const customer = `I would like to file a ${s.claim.claim_type} claim for ${s.claim.amount}. My ID is ${s.identity.member_id}, date of birth ${s.identity.dob}. I visited on ${s.claim.visit_date} and have ${s.claim.documents.join(', ')}.`;
  record(session, {role: 'customer', timestamp: stamp(), text: customer});
  executeTool(session, 'verify_member', s.identity);
  executeTool(session, 'check_claim', s.claim);
  const check = session.lastCheck!;
  let reply: string;
  if (!check.eligible) reply = `This visit is not applicable: ${check.reasons.map(r => r.replaceAll('_', ' ')).join(', ')}. Please contact your benefits team to discuss your options.`;
  else if (check.missing_documents.length) reply = `Please bring back ${check.missing_documents.map(d => d.replaceAll('_', ' ')).join(', ')}. Nothing has been submitted.`;
  else {
    executeTool(session, 'submit_claim', {...s.claim, outcome: check.suggested_outcome, summary_for_adjuster: `${data.config.claim_types[s.claim.claim_type].label}. Documents declared. ${check.uncovered_amount ? 'Above the plan limit; human review needed.' : 'Within the plan limit.'}`});
    reply = `${data.config.currency} ${check.covered_amount} is potentially covered and ${data.config.currency} ${check.uncovered_amount} exceeds the limit. An adjuster decides payment.`;
  }
  record(session, {role: 'agent', timestamp: stamp(), text: reply, visible: true}); appendTemplates(session);
  return trialResult(s, session, 1, {pass: true, violated_rules: [], reason: 'Scripted illustration only. No independent model judge or runtime model supervisor was run.'});
});
await saveReport(report(data, 'demo', results, 1, true, today, 'demo', emptyUsage()));
console.log('Wrote runs/demo.json — scripted illustrations, not measured LLM reliability.');
