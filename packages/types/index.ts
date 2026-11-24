import { z } from 'zod';

export const OutcomeSchema = z.enum(['fast_track', 'needs_review', 'not_applicable', 'incomplete']);
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Expected a real calendar date');
export const MoneySchema = z.number().finite().nonnegative().max(1_000_000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7, 'Use at most two decimal places');
export const ConfigSchema = z.object({
  timezone: z.string().refine(tz => {try {new Intl.DateTimeFormat('en', {timeZone: tz}); return true;} catch {return false;}}, 'Invalid timezone'), insurer_id: z.string(), display_name: z.string(), currency: z.string().length(3),
  submission_window_days: z.number().int().positive(),
  claim_types: z.record(z.string(), z.object({label: z.string(), required_docs: z.array(z.string()).min(1), annual_limit: z.boolean().default(false)})),
  plans: z.array(z.object({plan_id: z.string(), limits: z.record(z.string(), MoneySchema)})).min(1),
  handoff_triggers: z.array(z.string()),
  templates: z.object({after_submit: z.string().includes('{claim_id}'), handoff: z.string().includes('{ticket_id}'), safe_fallback: z.string()})
});
export const MemberSchema = z.object({member_id: z.string(), name: z.string(), dob: DateSchema, employer: z.string(), plan_id: z.string(), annual_used: z.record(z.string(), MoneySchema), active: z.boolean()});
export const PastClaimSchema = z.object({claim_id: z.string(), member_id: z.string(), claim_type: z.string(), amount: MoneySchema, status: z.enum(['rejected', 'paid', 'pending']), reason: z.string()});
export const ClaimInputSchema = z.object({member_id: z.string(), claim_type: z.string(), amount: MoneySchema.refine(n => n > 0), visit_date: DateSchema, documents: z.array(z.string()).max(20)}).strict();
export const ClaimCheckSchema = z.object({eligible: z.boolean(), reasons: z.array(z.string()), covered_amount: MoneySchema, uncovered_amount: MoneySchema, missing_documents: z.array(z.string()), suggested_outcome: OutcomeSchema, plan_limit: MoneySchema, remaining_limit: MoneySchema, submission_window_days: z.number()});
export const SubmitInputSchema = ClaimInputSchema.extend({outcome: z.enum(['fast_track', 'needs_review']), summary_for_adjuster: z.string().min(1).max(1500)});
export const SubmittedClaimSchema = SubmitInputSchema.extend({claim_id: z.string()});
export const TicketSchema = z.object({ticket_id: z.string(), reason: z.string()});
const timestamp = {timestamp: z.iso.datetime()};
export const TraceEventSchema = z.discriminatedUnion('role', [
  z.object({...timestamp, role: z.literal('customer'), text: z.string()}),
  z.object({...timestamp, role: z.literal('agent'), text: z.string(), visible: z.boolean().default(true)}),
  z.object({...timestamp, role: z.literal('tool'), name: z.string(), input: z.unknown(), output: z.unknown(), rejected: z.boolean()}),
  z.object({...timestamp, role: z.literal('supervisor'), result: z.enum(['pass', 'blocked']), check: z.string(), original: z.string(), action: z.enum(['send', 'rewrite', 'handoff'])}),
  z.object({...timestamp, role: z.literal('template'), name: z.enum(['after_submit', 'handoff', 'safe_fallback']), text: z.string()})
]);
export const ExpectedSchema = z.object({submitted: z.boolean(), outcome: OutcomeSchema.optional(), amount: MoneySchema.optional(), documents: z.array(z.string()).optional(), handoff: z.boolean().default(false), handoff_allowed: z.boolean().default(false), verified: z.boolean().optional(), explanation: z.string()});
export const PolicyCheckSchema = z.object({pass: z.boolean(), violated_rules: z.array(z.number().int().min(1).max(9)), reason: z.string()});
export const TrialResultSchema = z.object({
  scenario_id: z.number().int(), title: z.string(), trial: z.number().int().positive(), pass: z.boolean(),
  member_name: z.string(), claim_type: z.string(), amount: MoneySchema, expected: ExpectedSchema,
  actual_outcome: OutcomeSchema.nullable(), state_check: z.object({pass: z.boolean(), reasons: z.array(z.string())}),
  policy_check: PolicyCheckSchema, submitted_claim: SubmittedClaimSchema.optional(), handoff: TicketSchema.optional(),
  complete_and_triaged: z.boolean().nullable(), transcript: z.array(TraceEventSchema), error: z.string().optional()
});
export const UsageSchema = z.record(z.enum(['agent', 'supervisor', 'simulator', 'judge']), z.object({input: z.number().int(), output: z.number().int(), cache_read: z.number().int(), cache_creation: z.number().int(), calls: z.number().int()}));
export type Usage = z.infer<typeof UsageSchema>;
export const RunResultSchema = z.object({
  schema_version: z.literal(1), status: z.enum(['running', 'completed']).default('completed'), run_id: z.string(), model: z.string(), models: z.record(z.string(), z.string()),
  created_at: z.iso.datetime(), today: DateSchema, mode: z.enum(['live', 'demo']), guardrails: z.boolean(),
  insurer: z.object({name: z.string(), currency: z.string(), claim_labels: z.record(z.string(), z.string())}),
  summary: z.object({usage: UsageSchema, scenarios: z.number().int(), trials: z.number().int(), pass_1: z.number().min(0).max(1), pass_3: z.number().min(0).max(1).nullable(), complete_and_triaged: z.number().min(0).max(1).nullable(), supervisor_blocks: z.number().int(), tool_rejections: z.number().int()}),
  results: z.array(TrialResultSchema)
});
export type Config = z.infer<typeof ConfigSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type ClaimInput = z.infer<typeof ClaimInputSchema>;
export type ClaimCheck = z.infer<typeof ClaimCheckSchema>;
export type SubmittedClaim = z.infer<typeof SubmittedClaimSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type Expected = z.infer<typeof ExpectedSchema>;
export type TrialResult = z.infer<typeof TrialResultSchema>;
export type RunResult = z.infer<typeof RunResultSchema>;
export type PolicyCheck = z.infer<typeof PolicyCheckSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
