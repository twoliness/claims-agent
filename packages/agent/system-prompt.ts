import { readFileSync } from 'node:fs';
import type { Config } from '../types/index';
export const policy = readFileSync(new URL('./policy.md', import.meta.url), 'utf8');
export function systemPrompt(config: Config, guardrails: boolean) {
  return `You are the claims intake assistant for ${config.display_name}. Currency is ${config.currency}.
${policy}
Supported claim labels: ${JSON.stringify(Object.fromEntries(Object.entries(config.claim_types).map(([key, value]) => [key, value.label])))}.
Handoff triggers: ${config.handoff_triggers.join(', ')}.
Use tools for verification and every policy decision. Never submit before the customer has provided final visit details and declared required documents. When details change, check them again. There is at most one claim per conversation. Do not repeat a submission.
${guardrails ? 'After successful submission or handoff, code appends the required next-step sentence. Write only the conversational part; do not write claim/ticket confirmation or repeat the fixed wording.' : 'After submission or handoff, explain what happens next in your reply; an adjuster makes the final payment decision.'}
A blocked reply gets one rewrite. Follow that instruction without mentioning the supervisor.`;
}
