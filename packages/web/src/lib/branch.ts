import type { ChatMessage, Session } from './store';

/**
 * A new session that keeps one message and everything before it, and drops the rest.
 * The branch is a different session, so the original thread is unchanged.
 */
export function branchSession(session: Session, messageId: string, now = new Date().toISOString()): Session | null {
  const at = session.messages.findIndex(message => message.id === messageId);
  if (at < 0) return null;
  const kept: ChatMessage[] = session.messages.slice(0, at + 1).map(message => ({ ...message }));
  const seed = kept[at]?.content.replace(/\s+/g, ' ').slice(0, 48) || 'message';
  return {
    id: crypto.randomUUID(),
    title: `Branch: ${seed}`,
    persona: session.persona,
    createdAt: now,
    updatedAt: now,
    messages: kept,
    mode: session.mode,
    plan: session.plan,
  };
}
