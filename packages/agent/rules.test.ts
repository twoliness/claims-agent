import { describe, it, expect } from 'vitest';
import { loadData } from './load';
import { checkEligibility } from './rules';
import { ClaimInputSchema, DateSchema } from '../types/index';
const data = loadData();
const claim = {member_id: 'LM-1001', claim_type: 'gp', amount: 45, visit_date: '2026-11-17', documents: ['receipt']};
const check = (changes = {}, member = data.members[0], config = data.config) => checkEligibility({config, member, claim: {...claim, ...changes}, today: '2026-11-24'});
describe('deterministic eligibility', () => {
  it('fast-tracks a complete claim within the limit', () => expect(check()).toMatchObject({eligible: true, covered_amount: 45, uncovered_amount: 0, suggested_outcome: 'fast_track'}));
  it('sends over-limit claims to review using exact cents', () => expect(check({amount: 90.15})).toMatchObject({covered_amount: 60, uncovered_amount: 30.15, suggested_outcome: 'needs_review'}));
  it('requires all specialist documents', () => expect(check({claim_type: 'specialist', amount: 120})).toMatchObject({missing_documents: ['referral_letter'], suggested_outcome: 'incomplete'}));
  it('uses remaining annual benefits', () => expect(check({claim_type: 'dental', amount: 250})).toMatchObject({covered_amount: 180, uncovered_amount: 70, suggested_outcome: 'needs_review'}));
  it('does not submit an exhausted annual benefit', () => expect(check({claim_type: 'dental', amount: 200}, data.members[1])).toMatchObject({eligible: false, suggested_outcome: 'not_applicable'}));
  it('includes the final day and excludes the next', () => {
    expect(check({visit_date: '2026-08-26'}).eligible).toBe(true);
    expect(check({visit_date: '2026-08-25'}).reasons).toContain('outside_submission_window');
  });
  it('rejects inactive, unsupported and future claims', () => {
    expect(check({}, data.members[3]).reasons).toContain('member_inactive');
    expect(check({claim_type: 'cosmetic'}).eligible).toBe(false);
    expect(check({visit_date: '2026-11-25'}).eligible).toBe(false);
  });
  it('uses alternate insurer config with no rule changes', () => {
    const config = structuredClone(data.config); config.plans[0].limits.gp = 110; config.claim_types.gp.required_docs = ['invoice'];
    expect(check({amount: 100, documents: ['invoice']}, data.members[0], config).suggested_outcome).toBe('fast_track');
  });
  it('rejects impossible dates and fractional cents at the boundary', () => {
    expect(DateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(ClaimInputSchema.safeParse({...claim, amount: 45.001}).success).toBe(false);
  });
});
