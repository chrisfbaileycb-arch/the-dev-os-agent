import type { Persona } from './roster';

// Agents the user writes themselves: a name, a system prompt, and a role.
//
// The roster shipped nine opinionated specialists and no way to add a tenth, so the only route to
// "an agent that talks the way I want" was to pick the least wrong one and fight its prompt every
// message. A custom agent is the same shape as a built-in one — it appears in the same drawer, is
// selected the same way, and composePrompt() treats it identically — so nothing downstream has to
// know the difference.
//
// Stored in this browser only. These are prompts, not credentials, but they are the user's writing
// and there is no account to sync them to, so they stay in localStorage and the drawer says so.
//
// Type-only import of Persona on purpose: roster.ts imports this module for the lookup, and a
// value import here would close the cycle at runtime. Types are erased, so this one does not.

const KEY = 'hb-custom-agents';
const MAX_AGENTS = 24;
export const MAX_NAME = 40;
export const MAX_ROLE = 60;
export const MAX_PROMPT = 4000;

export interface CustomAgentDraft { name: string; prompt: string; role: string; }

/** A stored agent, before it is trusted. Everything is re-checked on read. */
interface StoredAgent { id?: unknown; name?: unknown; prompt?: unknown; role?: unknown; }

let cache: Persona[] | null = null;

/**
 * `custom:` prefixed so a user-written agent can never collide with a built-in id, now or after a
 * built-in is added. The suffix is random rather than a slug of the name: two agents called
 * "Reviewer" are a reasonable thing to want, and a name is editable where an id is forever.
 */
const mintId = (): string => `custom:${crypto.randomUUID().slice(0, 8)}`;

/**
 * A stored record turned into a Persona, or undefined if it cannot be.
 *
 * Bounded rather than repaired: these strings become a model's system prompt and text on screen,
 * so a record that does not survive this is dropped. A missing role is not fatal — it is a label,
 * and an agent with a prompt and no label still works.
 */
function toPersona(raw: StoredAgent): Persona | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const id = typeof raw.id === 'string' && raw.id.startsWith('custom:') ? raw.id : undefined;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME) : '';
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, MAX_PROMPT) : '';
  const role = typeof raw.role === 'string' ? raw.role.trim().slice(0, MAX_ROLE) : '';
  if (!id || !name || !prompt) return undefined;
  return {
    id,
    name,
    group: 'custom',
    custom: true,
    icon: 'Wand2',
    tagline: role || 'Custom agent',
    capabilities: role ? [role.toLowerCase()] : ['custom'],
    prompt,
  };
}

/**
 * Every custom agent, cached for the life of the page.
 *
 * Cached because personaById() is called on every render of every message and this must not become
 * a localStorage read per message. Writes invalidate it. Reads are wrapped because localStorage
 * throws outright in a Web Worker and in a browser with site data blocked, and neither is a reason
 * for the roster to fail — there simply are no custom agents in those contexts.
 */
export function customAgents(): Persona[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    cache = (Array.isArray(raw) ? raw : []).map(toPersona).filter((p): p is Persona => Boolean(p)).slice(0, MAX_AGENTS);
  } catch { cache = []; }
  return cache;
}

/** Forget the cache so the next read comes from storage. Used after an external change. */
export function reloadCustomAgents(): Persona[] { cache = null; return customAgents(); }

function persist(list: Persona[]): Persona[] {
  cache = list.slice(0, MAX_AGENTS);
  try { localStorage.setItem(KEY, JSON.stringify(cache.map(p => ({ id: p.id, name: p.name, prompt: p.prompt, role: p.tagline })))); }
  catch { /* storage unavailable; the agents still work for this session */ }
  return cache;
}

/** What is wrong with a draft, or null if nothing is. */
export function validateDraft(draft: CustomAgentDraft): string | null {
  if (!draft.name.trim()) return 'Give the agent a name.';
  if (!draft.prompt.trim()) return 'Write a system prompt: one or two sentences telling the agent how to behave.';
  if (draft.prompt.trim().length > MAX_PROMPT) return `Keep the system prompt under ${MAX_PROMPT.toLocaleString()} characters.`;
  if (customAgents().length >= MAX_AGENTS) return `You have ${MAX_AGENTS} custom agents, which is the limit. Delete one first.`;
  return null;
}

/**
 * Save a new agent and return it, so the caller can select it immediately. A person who has just
 * written an agent wants to use it, not to go and find it in a list.
 */
export function createCustomAgent(draft: CustomAgentDraft): Persona {
  const persona = toPersona({ id: mintId(), name: draft.name, prompt: draft.prompt, role: draft.role });
  if (!persona) throw new Error('An agent needs a name and a system prompt.');
  persist([...customAgents(), persona]);
  return persona;
}

export function removeCustomAgent(id: string): Persona[] {
  return persist(customAgents().filter(p => p.id !== id));
}

export function clearCustomAgents(): void {
  cache = [];
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
