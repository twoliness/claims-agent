import { record, stamp, type Session } from './tools';
export function appendTemplates(session: Session): string[] {
  const queued = session.pendingTemplates.splice(0);
  if (!session.guardrails) return [];
  return queued.map(({name, id}) => {
    const text = session.data.config.templates[name].replace(name === 'after_submit' ? '{claim_id}' : '{ticket_id}', id);
    record(session, {role: 'template', timestamp: stamp(), name, text});
    return text;
  });
}
