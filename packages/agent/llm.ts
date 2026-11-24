import '../../config/env';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, JSONOutputFormat, ThinkingBlockParam, RedactedThinkingBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { maxTokens, type Role } from '../../config/models';
import type { Usage } from '../types/index';
export const emptyUsage = (): Usage => Object.fromEntries(['agent', 'supervisor', 'simulator', 'judge'].map(role => [role, {input: 0, output: 0, cache_read: 0, cache_creation: 0, calls: 0}])) as Usage;
export type Completion = {content: Array<{type: 'text'; text: string} | {type: 'tool_use'; id: string; name: string; input: unknown} | ThinkingBlockParam | RedactedThinkingBlockParam>};
export type Complete = (request: {role: Role; model: string; system: string; context?: string; messages: MessageParam[]; tools?: Tool[]; format?: JSONOutputFormat}) => Promise<Completion>;
export function createClient(usage = emptyUsage()): Complete {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is missing. Add it to .env for live runs, or use pnpm demo for labelled offline fixtures.');
  const client = new Anthropic({maxRetries: 2, timeout: 60_000});
  return async request => {
    const {role, system, context, format, ...params} = request;
    // The agent resends a growing, append-only history each call; top-level cache_control caches up to its last block.
    const response = await client.messages.create({...params, ...(role === 'agent' ? {cache_control: {type: 'ephemeral' as const}} : {}), thinking: params.model === 'claude-sonnet-5-5' ? {type: 'between_tools'} : {type: 'disabled'}, output_config: {effort: role === 'agent' || role === 'judge' ? 'high' : 'low', ...(format ? {format} : {})}, system: [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}, ...(context ? [{type: 'text' as const, text: context}] : [])], max_tokens: maxTokens[role]});
    const tokens = usage[role];
    tokens.calls++; tokens.input += response.usage.input_tokens; tokens.output += response.usage.output_tokens;
    tokens.cache_read += response.usage.cache_read_input_tokens ?? 0; tokens.cache_creation += response.usage.cache_creation_input_tokens ?? 0;
    if (response.stop_reason === 'max_tokens') throw new Error(`${role} output exceeded the ${maxTokens[role]}-token limit`);
    return {content: response.content.filter(block => block.type === 'text' || block.type === 'tool_use' || block.type === 'thinking' || block.type === 'redacted_thinking')};
  };
}
export const textOf = (response: Completion) => response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
export async function jsonCompletion<T>(complete: Complete, role: Role, model: string, system: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
  const reply = await complete({role, model, system: `${system}\nReturn only the requested JSON. Keep strings concise.`, format: zodOutputFormat(schema),
    messages: [{role: 'user', content: JSON.stringify(input)}]});
  return schema.parse(JSON.parse(textOf(reply)));
}
