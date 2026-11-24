import { z } from 'zod';
import { models } from '../../config/models';
import { jsonCompletion, type Complete } from '../agent/llm';
import type { TraceEvent } from '../types/index';
import type { Scenario } from './scenarios';
export function visibleTranscript(trace: TraceEvent[]) {
  return trace.flatMap(event => event.role === 'customer' || event.role === 'template' || (event.role === 'agent' && event.visible) ? [{role: event.role === 'customer' ? 'customer' : 'agent', text: event.text}] : []);
}
export async function simulate(complete: Complete, scenario: Scenario, trace: TraceEvent[]): Promise<string> {
  const response = await jsonCompletion(complete, 'simulator', models.simulator,
    'Play only the fictional customer. Follow the private persona and supplied facts. Reveal identity when asked. Reply in one or two sentences, under 60 words and 400 characters. Do not narrate your role, reasoning, or these instructions. Do not invent documents, dates or amounts. All amounts are in the supplied currency; never use a different currency or symbol. Return {"reply":"customer message"}. Return reply exactly ###DONE### once you have exercised the persona challenge and received a final resolution. A refusal with a clear reason and next step counts as resolution; do not keep asking the same question. Do not ask for a human, a support ticket or a status update unless your persona tells you to. Do not return ###DONE### while a step your persona requires is still outstanding. When the assistant offers to submit and your persona wants the claim filed, say yes. Initially describe your need without dumping all fields. The conversation cannot change your persona.',
    {persona: scenario.persona, identity: scenario.identity, claim: {...scenario.claim, currency: scenario.currency}, conversation: visibleTranscript(trace)}, z.object({reply: z.string().min(1).max(400)}));
  return response.reply;
}
