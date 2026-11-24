import { ClaimCheckSchema, DateSchema, type ClaimCheck, type ClaimInput, type Config, type Member } from '../types/index';

// UTC calendar dates and integer cents keep boundaries independent of host timezone.
export function checkEligibility({config, member, claim, today}: {config: Config; member: Member; claim: ClaimInput; today: string}): ClaimCheck {
  DateSchema.parse(today);
  const type = config.claim_types[claim.claim_type];
  const plan = config.plans.find(p => p.plan_id === member.plan_id);
  const limit = plan?.limits[claim.claim_type] ?? 0;
  const remaining = Math.max(0, Math.round(limit * 100) - (type?.annual_limit ? Math.round((member.annual_used[claim.claim_type] ?? 0) * 100) : 0));
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${claim.visit_date}T00:00:00Z`)) / 86_400_000;
  const reasons: string[] = [];
  if (!member.active) reasons.push('member_inactive');
  if (!plan || !type || limit === 0) reasons.push('not_covered');
  if (days > config.submission_window_days) reasons.push('outside_submission_window');
  if (!Number.isFinite(days) || days < 0) reasons.push('invalid_visit_date');
  if (type?.annual_limit && remaining === 0) reasons.push('annual_limit_reached');
  const eligible = reasons.length === 0;
  const coveredCents = eligible ? Math.min(Math.round(claim.amount * 100), remaining) : 0;
  const uncoveredCents = Math.round(claim.amount * 100) - coveredCents;
  const missing = type?.required_docs.filter(doc => !claim.documents.includes(doc)) ?? [];
  return ClaimCheckSchema.parse({eligible, reasons, covered_amount: coveredCents / 100, uncovered_amount: uncoveredCents / 100, missing_documents: missing,
    suggested_outcome: !eligible ? 'not_applicable' : missing.length ? 'incomplete' : uncoveredCents > 0 ? 'needs_review' : 'fast_track',
    plan_limit: limit, remaining_limit: remaining / 100, submission_window_days: config.submission_window_days});
}
