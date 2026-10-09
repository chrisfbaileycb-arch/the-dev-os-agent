// Skills the visitor can switch on. Original registry. Carol Ann is the owner's reference
// for the shape (toggle, a few fields, export a stack), not the source of this file.
//
// A skill is either demo or live. Demo means it is a crew preset with no server behind it.
// Live means a real MCP URL the visitor turned on. Only live skills are callable, and only
// live streamable-HTTP skills are handed to the execution engine.

export type SkillKind = 'demo' | 'live';

export interface SkillField { key: string; label: string; secret?: boolean; }

export interface SkillDef {
  id: string;
  name: string;
  blurb: string;
  kind: SkillKind;
  /** Preset URL for a live skill. Empty when the visitor has to type one. */
  url: string;
  fields: SkillField[];
}

export interface SkillState {
  id: string;
  enabled: boolean;
  config: Record<string, string>;
}

export const CREW_SKILLS: SkillDef[] = [
  { id: 'drill', name: 'The Drill', kind: 'demo', url: '', blurb: 'Turns a vague goal into dated checkpoints. Demo preset. Not callable.', fields: [] },
  { id: 'ledger', name: 'The Ledger', kind: 'demo', url: '', blurb: 'Keeps the commitments you state, without punishment. Demo preset. Not callable.', fields: [] },
  { id: 'scribe', name: 'Scribe', kind: 'demo', url: '', blurb: 'Turns a thread into a clean note. Demo preset. Not callable.', fields: [] },
  { id: 'researcher', name: 'Researcher', kind: 'demo', url: '', blurb: 'Reads the notes you supply. Demo preset. Not callable until a live connector is attached.', fields: [] },
  { id: 'github', name: 'GitHub', kind: 'live', url: 'https://api.githubcopilot.com/mcp/', blurb: 'Repos, pull requests, and issues on your own token. Live MCP.', fields: [{ key: 'token', label: 'Personal access token', secret: true }] },
  { id: 'context7', name: 'Context7', kind: 'live', url: 'https://mcp.context7.com/mcp', blurb: 'Current library docs. Live MCP. No token.', fields: [] },
];

const KEY = 'sf-skills';

export function defaultSkillState(): SkillState[] {
  return CREW_SKILLS.map(skill => ({ id: skill.id, enabled: false, config: {} }));
}

export function loadSkillState(): SkillState[] {
  const base = defaultSkillState();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as Partial<SkillState>[];
    if (!Array.isArray(raw)) return base;
    return base.map(item => {
      const saved = raw.find(row => row.id === item.id);
      if (!saved) return item;
      const config: Record<string, string> = {};
      if (saved.config && typeof saved.config === 'object') {
        for (const [k, v] of Object.entries(saved.config)) if (typeof v === 'string') config[k] = v.slice(0, 500);
      }
      return { id: item.id, enabled: saved.enabled === true, config };
    });
  } catch { return base; }
}

export function saveSkillState(list: SkillState[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* this browser refused storage */ }
}

export function skillById(id: string): SkillDef | undefined {
  return CREW_SKILLS.find(skill => skill.id === id);
}

/** Stack JSON the visitor can download. Demo skills stay in the file and are marked demo. */
export function exportSkillStack(state: SkillState[]) {
  return {
    name: 'Signal Forge crew',
    skills: CREW_SKILLS.map(skill => {
      const row = state.find(item => item.id === skill.id);
      return {
        id: skill.id,
        name: skill.name,
        demo: skill.kind === 'demo',
        enabled: Boolean(row?.enabled),
        url: skill.kind === 'live' ? skill.url : '',
        config: skill.kind === 'live' ? (row?.config ?? {}) : {},
      };
    }),
  };
}

export interface EngineSkill { name: string; url: string; token?: string; transport: 'http'; enabled: true; demo: false; }

/** What the execution engine may receive. Demo skills are absent. SSE is not used. */
export function liveSkillsForEngine(state: SkillState[]): EngineSkill[] {
  const out: EngineSkill[] = [];
  for (const row of state) {
    if (!row.enabled) continue;
    const skill = skillById(row.id);
    if (!skill || skill.kind !== 'live' || !skill.url.startsWith('https://')) continue;
    const token = row.config.token?.trim();
    out.push({ name: skill.id, url: skill.url, transport: 'http', enabled: true, demo: false, ...(token ? { token } : {}) });
  }
  return out;
}

/** Enabled live skills as MCP connections the existing /api/mcp proxy can call. */
export function liveMcpConnections(state: SkillState[]) {
  return liveSkillsForEngine(state).map(skill => ({
    id: `skill:${skill.name}`,
    name: skillById(skill.name)?.name ?? skill.name,
    url: skill.url,
    transport: 'http' as const,
    token: skill.token ?? '',
    saveToken: Boolean(skill.token),
    enabled: true,
    tools: [] as [],
  }));
}
