// Skills are markdown pathways. A file says what the skill does, when to use it, and the steps.
// Turning one on hands those words to chat and to a workflow. It does not run a server.
//
// A connector is separate. GitHub and Context7 are live MCP servers a pathway may name.
// They are the only skills the execution engine receives as tools. Carol Ann is the owner's
// reference for the toggle, not the source of this file. The public catalogs (Claude Code,
// Codex, the VoltAgent list) are the same shape. This app does not ship those files.
// Bring a SKILL.md you already trust.

export type SkillKind = 'instructions' | 'live';

export interface SkillField { key: string; label: string; secret?: boolean; }

export interface SkillDef {
  id: string;
  name: string;
  blurb: string;
  kind: SkillKind;
  /** The pathway. Present only for instruction skills. */
  markdown?: string;
  url: string;
  fields: SkillField[];
}

export interface SkillState {
  id: string;
  enabled: boolean;
  config: Record<string, string>;
}

/** A skill the visitor wrote or imported. Stored in this browser only. */
export interface YourSkill {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
}

const DRILL = `Use when a goal is vague and the next need is dates, not a build.

1. Restate the goal in one sentence.
2. List the checkpoints that would make it true. Give each a date.
3. Mark the single next checkpoint. Leave the rest alone.
4. Stop. Do not start the work.`;

const LEDGER = `Use when the person states a commitment they want kept.

1. Write down only what they said they would do.
2. Ask what got in the way if a date passed. Do not scold.
3. Keep or drop the commitment. Do not invent a new one.`;

const SCRIBE = `Use when a thread should become one clean note.

1. Keep the decision, the open question, and the next step.
2. Drop the chatter.
3. The note is the whole reply.`;

const RESEARCHER = `Use when the answer has to come from notes the person supplied.

1. Read only what was supplied.
2. Say what those notes support, and what they do not.
3. Do not invent a source. If the notes are silent, say so.`;

export const CREW_SKILLS: SkillDef[] = [
  { id: 'drill', name: 'The Drill', kind: 'instructions', url: '', blurb: 'Turns a vague goal into dated checkpoints.', markdown: DRILL, fields: [] },
  { id: 'ledger', name: 'The Ledger', kind: 'instructions', url: '', blurb: 'Keeps the commitments you state, without punishment.', markdown: LEDGER, fields: [] },
  { id: 'scribe', name: 'Scribe', kind: 'instructions', url: '', blurb: 'Turns a thread into a clean note.', markdown: SCRIBE, fields: [] },
  { id: 'researcher', name: 'Researcher', kind: 'instructions', url: '', blurb: 'Reads the notes you supply and does not invent a source.', markdown: RESEARCHER, fields: [] },
  { id: 'github', name: 'GitHub', kind: 'live', url: 'https://api.githubcopilot.com/mcp/', blurb: 'Repos, pull requests, and issues on your own token. A connector, not a pathway.', fields: [{ key: 'token', label: 'Personal access token', secret: true }] },
  { id: 'context7', name: 'Context7', kind: 'live', url: 'https://mcp.context7.com/mcp', blurb: 'Current library docs. A connector, not a pathway.', fields: [] },
];

const KEY = 'sf-skills';
const YOURS = 'sf-your-skills';
const SKILL_CAP = 8_000;

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

export function loadYourSkills(): YourSkill[] {
  try {
    const raw = JSON.parse(localStorage.getItem(YOURS) || '[]') as Partial<YourSkill>[];
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 24).flatMap(row => {
      if (!row || typeof row.id !== 'string' || typeof row.body !== 'string') return [];
      return [{
        id: row.id.slice(0, 80),
        name: String(row.name || 'Untitled skill').slice(0, 80),
        description: String(row.description || '').slice(0, 240),
        body: row.body.slice(0, 12_000),
        enabled: row.enabled === true,
      }];
    });
  } catch { return []; }
}

export function saveYourSkills(list: YourSkill[]): void {
  try { localStorage.setItem(YOURS, JSON.stringify(list.slice(0, 24))); } catch { /* this browser refused storage */ }
}

export function skillById(id: string): SkillDef | undefined {
  return CREW_SKILLS.find(skill => skill.id === id);
}

/** Read a SKILL.md. Frontmatter name and description win. Otherwise the first heading. */
export function parseSkillFile(text: string): { name: string; description: string; body: string } {
  const raw = text.replace(/^\uFEFF/, '').slice(0, 12_000);
  let name = '';
  let description = '';
  let body = raw;
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = raw.slice(fm[0].length);
    for (const line of fm[1].split('\n')) {
      const match = line.match(/^(name|description):\s*(.*)$/i);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (match[1].toLowerCase() === 'name') name = value;
      else description = value;
    }
  }
  if (!name) {
    const heading = body.match(/^#\s+(.+)$/m);
    name = heading?.[1]?.trim() || 'Untitled skill';
  }
  if (!description) {
    const para = body.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('#') && !line.startsWith('---'));
    description = para || 'Markdown instructions.';
  }
  return { name: name.slice(0, 80), description: description.slice(0, 240), body: body.trim().slice(0, 12_000) };
}

/** Enabled pathways, capped. Live connectors are not included. */
export function instructionText(state: SkillState[] = loadSkillState(), yours: YourSkill[] = loadYourSkills()): string {
  const parts: string[] = [];
  for (const skill of CREW_SKILLS) {
    if (skill.kind !== 'instructions' || !skill.markdown) continue;
    if (!state.find(row => row.id === skill.id)?.enabled) continue;
    parts.push(`# ${skill.name}\n${skill.blurb}\n\n${skill.markdown}`);
  }
  for (const skill of yours) {
    if (!skill.enabled || !skill.body.trim()) continue;
    parts.push(`# ${skill.name}\n${skill.description}\n\n${skill.body}`);
  }
  let out = '';
  for (const part of parts) {
    if (out.length >= SKILL_CAP) break;
    out += `${out ? '\n\n' : ''}${part.slice(0, 4_000)}`;
  }
  return out.slice(0, SKILL_CAP);
}

/** Stack JSON the visitor can download. Pathways keep their markdown. Connectors keep the URL. */
export function exportSkillStack(state: SkillState[], yours: YourSkill[] = []) {
  return {
    name: 'Signal Forge crew',
    skills: [
      ...CREW_SKILLS.map(skill => {
        const row = state.find(item => item.id === skill.id);
        return {
          id: skill.id,
          name: skill.name,
          kind: skill.kind,
          enabled: Boolean(row?.enabled),
          markdown: skill.kind === 'instructions' ? skill.markdown ?? '' : '',
          url: skill.kind === 'live' ? skill.url : '',
          config: skill.kind === 'live' ? (row?.config ?? {}) : {},
        };
      }),
      ...yours.map(skill => ({
        id: skill.id,
        name: skill.name,
        kind: 'instructions' as const,
        enabled: skill.enabled,
        markdown: skill.body,
        url: '',
        config: {},
      })),
    ],
  };
}

export interface EngineSkill { name: string; url: string; token?: string; transport: 'http'; enabled: true; demo: false; }

/** What the execution engine may receive as a tool. Instruction skills are absent. SSE is not used. */
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
