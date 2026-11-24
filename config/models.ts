import './env';
export const models = {
  agent: process.env.AGENT_MODEL ?? 'claude-sonnet-5-5',
  supervisor: process.env.SUPERVISOR_MODEL ?? 'claude-haiku-5-5',
  simulator: process.env.SIMULATOR_MODEL ?? 'claude-haiku-5-5',
  judge: process.env.JUDGE_MODEL ?? 'claude-sonnet-5-5'
};
export type Role = keyof typeof models;
export const maxTokens: Record<Role, number> = {agent: 800, supervisor: 300, simulator: 300, judge: 300};
