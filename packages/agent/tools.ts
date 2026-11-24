import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { ClaimInputSchema, DateSchema, SubmitInputSchema, TraceEventSchema, type ClaimCheck, type ClaimInput, type Config, type Member, type SubmittedClaim, type TraceEvent } from '../types/index';
import type { Data } from './load';
import { checkEligibility } from './rules';

export type Session = {
  data: Data; today: string; guardrails: boolean; member?: Member; boundMemberId?: string; trace: TraceEvent[];
  lastInput?: ClaimInput; lastCheck?: ClaimCheck; conflictingDetails: boolean;
  submitted?: SubmittedClaim; ticket?: {ticket_id: string; reason: string};
  pendingTemplates: Array<{name: 'after_submit' | 'handoff'; id: string}>;
};
export const stamp = () => new Date().toISOString();
export function record(session: Session, event: TraceEvent) { session.trace.push(TraceEventSchema.parse(event)); }
export function createSession(data: Data, today: string, guardrails = true): Session {
  DateSchema.parse(today);
  return {data, today, guardrails, trace: [], conflictingDetails: false, pendingTemplates: []};
}
// Document keys come from the insurer config, so free text like "dental receipt" can't slip past the rules.
function buildSchemas(config: Config) {
  const keys = [...new Set(Object.values(config.claim_types).flatMap(t => t.required_docs))] as [string, ...string[]];
  const documents = z.array(z.enum(keys)).max(20).describe(`Declared documents, using only these keys: ${keys.join(', ')}. Any receipt is "receipt".`);
  return {
    verify_member: z.object({member_id: z.string(), dob: DateSchema}).strict(),
    check_claim: ClaimInputSchema.extend({documents}),
    submit_claim: SubmitInputSchema.extend({documents}),
    handoff_to_human: z.object({member_id: z.string().optional(), reason: z.string().min(1).max(500)}).strict()
  };
}
const cache = new WeakMap<Config, ReturnType<typeof buildSchemas>>();
function schemasFor(config: Config) {
  let schemas = cache.get(config);
  if (!schemas) cache.set(config, schemas = buildSchemas(config));
  return schemas;
}
const descriptions = {
  verify_member: 'Verify identity using member ID and birth date. Successful verification returns that member’s profile and past claims.',
  check_claim: 'Check eligibility, limits, documents, and triage using verified membership. Use the returned values; never calculate coverage yourself.',
  submit_claim: 'Send one complete, eligible claim to the human adjuster. Never approves or pays. A changed detail or human handoff requires needs_review.',
  handoff_to_human: 'Create a human-support ticket for a configured escalation trigger. No payment or approval. May be used without verified identity: include member_id only after verify_member has succeeded, otherwise leave it out.'
};
export const toolDefinitions = (config: Config): Tool[] => Object.entries(schemasFor(config)).map(([name, schema]) => ({name, description: descriptions[name as keyof typeof descriptions], input_schema: z.toJSONSchema(schema) as Tool['input_schema']}));
export const moneyIn = (text: string) => [...text.matchAll(/(?:\b(?:SGD|USD)|S\$|\$)\s*([\d,]+(?:\.\d{1,2})?)|\b(\d+(?:\.\d{1,2})?)\s*(?:dollars|SGD)\b/gi)].map(m => Number((m[1] ?? m[2]).replaceAll(',', '')));
function observe(session: Session, input: ClaimInput) {
  const before = session.lastInput;
  if (before && (before.amount !== input.amount || before.claim_type !== input.claim_type || before.visit_date !== input.visit_date)) session.conflictingDetails = true;
  // Guardrail: an amount the customer changed before the first check never shows up as a diff between tool calls.
  // Only amounts stated before that first check count, so the customer echoing the agent's figures doesn't trigger it.
  if (!before && session.guardrails && session.trace.some(e => e.role === 'customer' && moneyIn(e.text).some(n => n !== input.amount))) session.conflictingDetails = true;
  const {member_id, claim_type, amount, visit_date, documents} = input;
  session.lastInput = {member_id, claim_type, amount, visit_date, documents};
}
export function executeTool(session: Session, name: string, raw: unknown): {output: unknown; rejected: boolean} {
  let output: unknown;
  let rejected = false;
  const schemas = schemasFor(session.data.config);
  try {
    if (!(name in schemas)) throw new Error('Unknown tool');
    if (name === 'verify_member') {
      const input = schemas.verify_member.parse(raw);
      // A failed re-verification must never retain the earlier identity.
      const previous = session.boundMemberId;
      session.member = undefined;
      if (previous && previous !== input.member_id) throw new Error('Start a new conversation for another member');
      const member = session.data.members.find(m => m.member_id === input.member_id && m.dob === input.dob);
      session.member = member;
      if (member) session.boundMemberId = member.member_id;
      output = member ? {verified: true, name: member.name, plan_id: member.plan_id, active: member.active, past_claims: session.data.pastClaims.filter(c => c.member_id === member.member_id)} : {verified: false};
    } else if (name === 'handoff_to_human') {
      const input = schemas.handoff_to_human.parse(raw);
      if (input.member_id && input.member_id !== session.member?.member_id) throw new Error('Verify this member before linking a ticket');
      session.ticket ??= {ticket_id: `TK-${randomUUID().slice(0, 8).toUpperCase()}`, reason: input.reason};
      if (session.submitted && session.guardrails) session.submitted.outcome = 'needs_review';
      if (!session.pendingTemplates.some(t => t.name === 'handoff')) session.pendingTemplates.push({name: 'handoff', id: session.ticket.ticket_id});
      output = {...session.ticket, ...(session.submitted ? {claim_id: session.submitted.claim_id, outcome: session.submitted.outcome} : {})};
    } else {
      const input = name === 'submit_claim' ? schemas.submit_claim.parse(raw) : schemas.check_claim.parse(raw);
      if (!session.member || session.member.member_id !== input.member_id) throw new Error('Identity verification required for this member');
      observe(session, input);
      if (name === 'check_claim') {
        session.lastCheck = checkEligibility({config: session.data.config, member: session.member, claim: input, today: session.today});
        if (session.lastCheck.suggested_outcome === 'fast_track' && (session.conflictingDetails || session.ticket)) session.lastCheck.suggested_outcome = 'needs_review';
        output = {...session.lastCheck, currency: session.data.config.currency, amount: input.amount, claim_type: input.claim_type, visit_date: input.visit_date, conflicting_details: session.conflictingDetails, human_handoff: Boolean(session.ticket)};
      } else {
        const submission = schemas.submit_claim.parse(input);
        if (session.submitted) {
          const {claim_id: _, ...existing} = session.submitted;
          if (JSON.stringify(existing) !== JSON.stringify(submission)) throw new Error('A claim was already submitted; hand off any correction to a human');
          output = {claim_id: session.submitted.claim_id, outcome: session.submitted.outcome};
        } else {
          if (session.guardrails) {
            const check = checkEligibility({config: session.data.config, member: session.member, claim: input, today: session.today});
            session.lastCheck = check;
            if (!check.eligible) throw new Error(`Cannot submit: ${check.reasons.join(', ')}`);
            if (check.missing_documents.length) throw new Error(`Missing documents: ${check.missing_documents.join(', ')}`);
            if (submission.outcome === 'fast_track' && (check.suggested_outcome !== 'fast_track' || session.conflictingDetails || session.ticket)) throw new Error('This claim requires needs_review');
          }
          session.submitted = {...submission, claim_id: `CL-${randomUUID().slice(0, 8).toUpperCase()}`};
          session.pendingTemplates.push({name: 'after_submit', id: session.submitted.claim_id});
          output = {claim_id: session.submitted.claim_id, outcome: session.submitted.outcome};
        }
      }
    }
  } catch (error) {
    rejected = true;
    output = {error: error instanceof z.ZodError ? 'Invalid tool input: ' + error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : (error as Error).message};
  }
  record(session, {role: 'tool', timestamp: stamp(), name, input: raw, output, rejected});
  return {output, rejected};
}
