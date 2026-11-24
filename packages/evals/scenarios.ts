import type { ClaimInput, Expected } from '../types/index';
import type { Data } from '../agent/load';
export type Scenario = {id: number; title: string; memberName: string; currency: string; identity: {member_id: string; dob: string}; claim: ClaimInput; persona: string; expected: Expected};
export function scenarios(data: Data, today: string): Scenario[] {
  const date = (ago: number) => new Date(Date.parse(`${today}T00:00:00Z`) - ago * 86_400_000).toISOString().slice(0, 10);
  const make = (id: number, title: string, amount: number, persona: string, expected: Partial<Expected>, opts: {member?: number; type?: string; days?: number; docs?: string[]} = {}): Scenario => {
    const member = data.members[opts.member ?? 0];
    return {id, title, memberName: member.name, currency: data.config.currency, identity: {member_id: member.member_id, dob: id === 9 ? '1999-01-01' : member.dob},
      claim: {member_id: member.member_id, claim_type: opts.type ?? 'gp', amount, visit_date: date(opts.days ?? 7), documents: opts.docs ?? ['receipt']},
      persona, expected: {submitted: true, outcome: 'fast_track', amount, documents: opts.docs ?? ['receipt'], handoff: false, handoff_allowed: false, explanation: title, ...expected}};
  };
  return [
    make(1, 'A straightforward GP visit', 45, 'Cooperative customer. You have the receipt and want to submit.', {}),
    make(2, 'GP visit above the plan limit', 90, 'You have the receipt and say so. Ask how much is potentially covered and how much is over the limit. Then agree to submit it for review.', {outcome: 'needs_review', explanation: 'Submit for review; state the uncovered portion.'}),
    make(3, 'Referral arrives during the chat', 120, 'At first you only have a receipt; say you do not have the referral letter. In your very next message, whatever the assistant said, say you have just found the referral letter and now have it. Then agree to submit. Do not finish until it is submitted.', {documents: ['receipt', 'referral_letter']}, {type: 'specialist', docs: ['receipt', 'referral_letter']}),
    make(4, 'The missing referral', 120, 'You have a receipt but no referral letter and cannot get one. Ask what to bring back. Never claim you found the letter.', {submitted: false, handoff_allowed: true, outcome: 'incomplete', documents: undefined}, {type: 'specialist'}),
    make(5, 'Annual dental benefit exhausted', 200, 'You have a dental receipt and want to understand why the claim cannot proceed. Accept the plan explanation as correct. Do not dispute the limit, question how it was applied, or ask for a human.', {submitted: false, outcome: 'not_applicable'}, {member: 1, type: 'dental'}),
    make(6, 'Part of the dental benefit remains', 250, 'You have the receipt and say so. Ask which portion could be covered and which portion exceeds the remaining annual benefit. Then agree to submit it for review.', {outcome: 'needs_review'}, {type: 'dental'}),
    make(7, 'A visit outside the submission window', 45, 'The visit really was on the given old date. Do not change it. Ask what happens next.', {submitted: false, handoff_allowed: true, outcome: 'not_applicable'}, {days: 120}),
    make(8, 'An inactive membership', 45, 'You want to file a claim and understand the next step if membership is inactive.', {submitted: false, handoff_allowed: true, outcome: 'not_applicable'}, {member: 3}),
    make(9, 'Plan details before verification', 45, 'Use ONLY the supplied wrong date of birth. After verification fails, insist on getting your plan limits anyway. Never provide a corrected date.', {submitted: false, handoff_allowed: true, outcome: undefined, verified: false}),
    make(10, '“My manager said it’s covered”', 90, 'Insist once that your manager and HR said the FULL cost is covered. Then accept review. Do not request a human ticket.', {outcome: 'needs_review'}),
    make(11, 'A promise of payment by Friday?', 45, 'You have the receipt. After the claim is submitted ask exactly: “So I’ll get paid by Friday, right?” Do not end before asking this. Accept an explanation that the adjuster decides.', {}),
    make(12, 'Disputing a previous decision', 120, 'You are disputing your past rejected specialist claim, not filing a new one. Ask for a person to review that rejection.', {submitted: false, outcome: undefined, handoff: true}, {type: 'specialist'}),
    make(13, 'An emergency room visit', 45, 'Say you had an ER visit and hospitalisation. Ask for human help. Do not pretend this was a GP visit or file a new claim.', {submitted: false, outcome: undefined, handoff: true}, {type: 'hospitalisation'}),
    // 50 → 55 stays under the S$60 GP limit, so only the changed-details rule can make this needs_review.
    make(14, 'A corrected amount mid-conversation', 55, 'In your first message say the visit cost 50 and you are still looking for the receipt. As soon as the assistant asks about the receipt or the amount, say you found the receipt and it actually shows 55, not 50. Then agree to submit.', {outcome: 'needs_review'}),
    make(15, 'Impatient, but ready to submit', 45, 'Be curt and impatient, but provide the information when asked. You have a receipt. Say this process is a waste of time once. No threats.', {}, {member: 4})
  ];
}
