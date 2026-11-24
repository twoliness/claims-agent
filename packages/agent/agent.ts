import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { models } from '../../config/models';
import { createClient, textOf, type Complete } from './llm';
import { executeTool, record, stamp, toolDefinitions, type Session } from './tools';
import { systemPrompt } from './system-prompt';
import { supervise } from './supervisor';
import { appendTemplates } from './templates';
export type Conversation = {session: Session; messages: MessageParam[]; complete: Complete};
export const createConversation = (session: Session, complete = createClient()): Conversation => ({session, complete, messages: []});

export async function safeHandoff(conversation: Conversation): Promise<string> {
  const {session, messages} = conversation;
  const input = {reason: 'uncertainty: unable to produce a verified safe reply'};
  const result = executeTool(session, 'handoff_to_human', input);
  const toolId = `fallback_${session.trace.length}`;
  messages.push({role: 'assistant', content: [{type: 'tool_use', id: toolId, name: 'handoff_to_human', input}]});
  messages.push({role: 'user', content: [{type: 'tool_result', tool_use_id: toolId, content: JSON.stringify(result.output)}]});
  const text = session.data.config.templates.safe_fallback;
  record(session, {role: 'template', timestamp: stamp(), name: 'safe_fallback', text});
  const final = [text, ...appendTemplates(session)].join('\n\n');
  messages.push({role: 'assistant', content: final});
  return final;
}
export async function runAgentTurn(conversation: Conversation, customer: string): Promise<string> {
  const {session, messages, complete} = conversation;
  record(session, {role: 'customer', timestamp: stamp(), text: customer});
  messages.push({role: 'user', content: customer});
  const system = systemPrompt(session.data.config, session.guardrails);
  // Bound cost and prevent an unproductive tool loop.
  for (let round = 0; round < 8; round++) {
    const response = await complete({role: 'agent', model: models.agent, system, context: `Today is ${session.today}.`, messages, tools: toolDefinitions(session.data.config)});
    const calls = response.content.filter(b => b.type === 'tool_use');
    let draft = textOf(response);
    if (calls.length) {
      if (draft) record(session, {role: 'agent', timestamp: stamp(), text: draft, visible: false});
      messages.push({role: 'assistant', content: response.content});
      messages.push({role: 'user', content: calls.map(call => {
        const result = executeTool(session, call.name, call.input);
        return {type: 'tool_result' as const, tool_use_id: call.id, content: JSON.stringify(result.output), is_error: result.rejected};
      })});
      continue;
    }
    if (!draft) throw new Error('The model returned an empty reply');
    if (session.guardrails) {
      const first = await supervise(draft, session, complete, 0);
      if (!first.pass) {
        const rewrite = await complete({role: 'agent', model: models.agent, system, context: `Today is ${session.today}.`, messages: [...messages,
          {role: 'assistant', content: draft}, {role: 'user', content: `Runtime supervisor blocked this draft: ${first.check}. Rewrite once using only successful tool results. No payment guarantees. Do not call tools or repeat regulated confirmation wording.`}]});
        draft = textOf(rewrite);
        if (!draft || !(await supervise(draft, session, complete, 1)).pass) return safeHandoff(conversation);
      }
    }
    record(session, {role: 'agent', timestamp: stamp(), text: draft, visible: true});
    const final = [draft, ...appendTemplates(session)].join('\n\n');
    messages.push({role: 'assistant', content: final});
    return final;
  }
  return safeHandoff(conversation);
}
