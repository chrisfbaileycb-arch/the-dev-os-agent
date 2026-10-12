import { useEffect, useState } from 'react';
import { Check, Download, FileText, Pencil, Plug, Plus, Trash2 } from 'lucide-react';
import { CREW_SKILLS, exportSkillStack, liveMcpConnections, loadSkillState, loadYourSkills, parseSkillFile, parseSkillStack, saveSkillState, saveYourSkills, instructionText, SKILL_CAP, SKILL_FILE_CAP, refreshSystemSkills, type SkillState, type YourSkill } from '../lib/skillRegistry';
import { exportAgentBundle, type AgentExportFormat } from '../lib/exportAgentBundle';
import { defaultPersona, type Persona } from '../lib/roster';
import type { MediaConfig } from '../lib/mediaTools';
import type { McpConnection } from '../lib/mcp';

export interface AgentSkillsProps {
  persona?: Persona; secrets?: string[]; media?: MediaConfig[];
  mcp: McpConnection[];
  setMcp: (list: McpConnection[]) => void;
  notify: (message: string) => void;
  onChange?: () => void;
  adminMode?: boolean;
}

/** The same skill library is available from navigation and the connectors drawer. */
export default function AgentSkills(p: AgentSkillsProps) {
  const [exportFormat, setExportFormat] = useState<AgentExportFormat>('json');
  const [includeMemory, setIncludeMemory] = useState(true);
  const [exportingAgent, setExportingAgent] = useState(false);
  async function exportAgent() { setExportingAgent(true); try { await exportAgentBundle({ persona: p.persona ?? defaultPersona(), connectors: p.mcp, secrets: p.secrets, media: p.media }, exportFormat, includeMemory); } catch (error) { p.notify(error instanceof Error ? error.message : 'Could not export agent.'); } finally { setExportingAgent(false); } }
  const [skills, setSkills] = useState<SkillState[]>(() => loadSkillState());
  const [yours, setYours] = useState<YourSkill[]>(() => loadYourSkills());
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftUse, setDraftUse] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); void refreshSystemSkills(controller.signal).then(() => setSkills(loadSkillState())).catch(e => { if (!controller.signal.aborted) p.notify(e instanceof Error ? e.message : 'Could not read catalog.'); }); return () => controller.abort(); }, []);
  let activation = '';
  let activationError = '';
  try { activation = instructionText(skills, yours); } catch (e) { activationError = e instanceof Error ? e.message : 'Could not activate skills.'; }
  const matches = (name: string, description: string) => `${name} ${description}`.toLowerCase().includes(query.trim().toLowerCase());

  function writeSkills(next: SkillState[]) {
    saveSkillState(next);
    setSkills(next);
    p.onChange?.();
    const live = liveMcpConnections(next);
    const rest = p.mcp.filter(c => !c.id.startsWith('skill:'));
    const merged = live.map(row => {
      const existing = p.mcp.find(c => c.id === row.id);
      return existing ? { ...existing, url: row.url, token: row.token, saveToken: row.saveToken, enabled: true, name: row.name, transport: 'http' as const } : row;
    });
    p.setMcp([...merged, ...rest]);
  }
  function patchSkill(id: string, patch: Partial<SkillState>) {
    writeSkills(skills.map(row => row.id === id ? { ...row, ...patch, config: patch.config ?? row.config } : row));
  }
  function exportStack() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportSkillStack(skills, yours), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'signal-forge-skills.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function writeYours(next: YourSkill[]) {
    try { saveYourSkills(next); } catch (e) { p.notify(e instanceof Error ? e.message : 'Could not save skills.'); return false; }
    setYours(next);
    p.onChange?.();
    return true;
  }
  function saveDraft() {
    const name = draftName.trim();
    const body = draftBody.trim();
    if (!name || !body) { p.notify('A skill needs a name and the steps.'); return; }
    if (!editing && yours.length >= 24) { p.notify('This browser holds up to 24 skills. Remove one before adding another.'); return; }
    const skill: YourSkill = { id: editing ?? crypto.randomUUID(), name: name.slice(0, 80), description: draftUse.trim().slice(0, 240) || 'Markdown instructions.', body, enabled: editing ? yours.find(s => s.id === editing)?.enabled ?? true : true };
    if (!writeYours(editing ? yours.map(s => s.id === editing ? skill : s) : [skill, ...yours])) return;
    setDraftName(''); setDraftUse(''); setDraftBody(''); setAdding(false); setEditing(null);
    p.notify(skill.enabled ? 'Skill saved. Its instructions apply to the next message.' : 'Skill saved. Enable it when you want to use it.');
  }
  async function importSkill(file?: File) {
    if (!file) return;
    if (yours.length >= 24) { p.notify('This browser holds up to 24 skills. Remove one before importing another.'); return; }
    const stack = /\.json$/i.test(file.name);
    if (!/\.(md|txt|markdown|json)$/i.test(file.name) || file.size > (stack ? 5_000_000 : SKILL_FILE_CAP)) { p.notify('Choose a Markdown file under 500 KB or a skill stack under 5 MB.'); return; }
    try {
      const text = await file.text();
      if (stack) {
        const imported = parseSkillStack(text);
        if (imported.length + yours.length > 24) throw new Error('This stack will not fit the 24-skill limit. Nothing was imported.');
        for (const skill of imported) {
          if (!skill.provenance) continue;
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(skill.body));
          const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
          if (actual !== skill.provenance.sha256) throw new Error(`The content hash for ${skill.name} does not match. Nothing was imported.`);
        }
        if (writeYours([...imported, ...yours])) p.notify(`Imported ${imported.length} complete skills and their resources. Select the skills needed for your task.`);
        return;
      }
      const parsed = parseSkillFile(text);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (!parsed.body) { p.notify('That file had no instructions in it.'); return; }
      writeYours([{ id: crypto.randomUUID(), name: parsed.name, description: parsed.description, body: parsed.body, provenance: { file: file.name, sha256 }, enabled: false }, ...yours]);
      setOpenSkill(null);
      p.notify(`Imported ${parsed.name}. Complete instructions saved. Select it when this task needs it.`);
    } catch (e) { p.notify(e instanceof Error ? e.message : 'Could not read the skill file.'); }
  }

  return <section className="panel">
        <div className="panel-head"><h2>Skill library · {CREW_SKILLS.filter(s => s.kind === 'instructions').length} complete packages</h2><span className="row gap">{p.adminMode && <><button type="button" className="button small" onClick={() => { setEditing(null); setDraftName(''); setDraftUse(''); setDraftBody(''); setAdding(v => !v); }}><Plus size={13} />Add</button><label className="button small">Import<input type="file" className="sr-only" accept=".md,.txt,.markdown,.json,text/markdown,text/plain,application/json" onChange={e => { void importSkill(e.target.files?.[0]); e.target.value = ''; }} /></label></>}<button type="button" className="button small" onClick={exportStack}><Download size={13} />Export Skills</button><select aria-label="Agent export format" value={exportFormat} onChange={e => setExportFormat(e.target.value as AgentExportFormat)}><option value="json">JSON</option><option value="yaml">YAML</option></select><button type="button" className="button primary small" disabled={exportingAgent} onClick={() => void exportAgent()}><Download size={13} />Export Agent</button></span></div>
        <p className="help">Select the complete skills your agent should follow. Repository imports and system-wide catalog management belong in the protected Admin dashboard. Enabled choices stay in this browser. Supporting scripts are reference files and run only through an explicitly connected tool.</p>
        <p className={activationError ? 'msg-error' : 'help'}>{activationError || `Selected instructions: ${activation.length.toLocaleString()} / ${SKILL_CAP.toLocaleString()} characters. Each selected skill is loaded completely. Turn on only the skills needed for this task.`}</p>
        <label className="check"><input type="checkbox" checked={includeMemory} onChange={e => setIncludeMemory(e.target.checked)} />Include browser-injected memory in agent exports</label>
        <label>Search skills<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name or purpose" /></label>
        {p.adminMode && adding && <div className="stack">
          <label>Name<input value={draftName} maxLength={80} onChange={e => setDraftName(e.target.value)} placeholder="Review a pull request" /></label>
          <label>When to use it<input value={draftUse} maxLength={240} onChange={e => setDraftUse(e.target.value)} placeholder="Use when someone asks for a review before a merge." /></label>
          <label>Steps<textarea value={draftBody} maxLength={SKILL_FILE_CAP} rows={8} onChange={e => setDraftBody(e.target.value)} placeholder={'1. Read the diff.\n2. Name the risk.\n3. Stop.'} /></label>
          <button type="button" className="button primary small" onClick={saveDraft}><Check size={13} />{editing ? 'Save changes' : 'Save skill'}</button>
          <button type="button" className="button small" onClick={() => { setAdding(false); setEditing(null); }}>Cancel</button>
        </div>}
        <h3 className="group-label">Your skills</h3>
        {yours.filter(skill => matches(skill.name, skill.description)).map(skill => <div key={skill.id} className="doc-row">
          <button type="button" className="text-button" aria-label={`Read ${skill.name}`} aria-expanded={openSkill === skill.id} onClick={() => setOpenSkill(openSkill === skill.id ? null : skill.id)}><FileText size={13} /></button>
          <span>
            <strong>{skill.name}</strong>
            <small>Yours · {skill.description} · {skill.body.length.toLocaleString()} characters</small>{skill.provenance && <small>Imported from {skill.provenance.file} · SHA-256 {skill.provenance.sha256.slice(0, 12)} · content stored in full</small>}
          </span>
          {p.adminMode && <><button type="button" className="icon-button" aria-label={`Edit ${skill.name}`} onClick={() => { setEditing(skill.id); setDraftName(skill.name); setDraftUse(skill.description); setDraftBody(skill.body); setAdding(true); }}><Pencil size={13} /></button>
          <button type="button" className="icon-button" aria-label={`Delete ${skill.name}`} onClick={() => writeYours(yours.filter(row => row.id !== skill.id))}><Trash2 size={13} /></button></>}
          <label className="switch"><input type="checkbox" aria-label={`Enable ${skill.name}`} checked={skill.enabled} onChange={e => writeYours(yours.map(row => row.id === skill.id ? { ...row, enabled: e.target.checked } : row))} />{skill.enabled ? 'On' : 'Off'}</label>
          {openSkill === skill.id && <pre className="skill-body">{skill.body}</pre>}
        </div>)}
        {!yours.length && <p className="help">None yet. Add one, or import a SKILL.md.</p>}
        {query.trim() && !yours.some(skill => matches(skill.name, skill.description)) && !CREW_SKILLS.some(skill => matches(skill.name, skill.blurb)) && <p className="help">No skills match this search.</p>}
        <h3 className="group-label">Engineering &amp; published instructions</h3>
        {CREW_SKILLS.filter(skill => skill.kind === 'instructions' && matches(skill.name, skill.blurb)).map(skill => {
          const row = skills.find(item => item.id === skill.id) ?? { id: skill.id, enabled: false, config: {} };
          return <div key={skill.id} className="doc-row">
            <button type="button" className="text-button" aria-label={`Read ${skill.name}`} aria-expanded={openSkill === skill.id} onClick={() => setOpenSkill(openSkill === skill.id ? null : skill.id)}><FileText size={13} /></button>
            <span>
              <strong>{skill.name}</strong>
              <small>Instructions · {skill.blurb}</small>{skill.provenance && <small><a href={skill.provenance.source} target="_blank" rel="noreferrer">Source {skill.provenance.commit?.slice(0, 8)}</a> · {skill.provenance.license} · {skill.provenance.author} · SHA-256 {skill.provenance.sha256.slice(0, 12)}</small>}
            </span>
            <label className="switch"><input type="checkbox" aria-label={`Enable ${skill.name}`} checked={row.enabled} onChange={e => patchSkill(skill.id, { enabled: e.target.checked })} />{row.enabled ? 'On' : 'Off'}</label>
            {openSkill === skill.id && <pre className="skill-body">{skill.markdown}</pre>}
          </div>;
        })}
        <h3 className="group-label">Connectors a skill may name</h3>
        {CREW_SKILLS.filter(skill => skill.kind === 'live' && matches(skill.name, skill.blurb)).map(skill => {
          const row = skills.find(item => item.id === skill.id) ?? { id: skill.id, enabled: false, config: {} };
          return <div key={skill.id} className="doc-row">
            <Plug size={13} />
            <span>
              <strong>{skill.name}</strong>
              <small>Connector · {skill.blurb}</small>
              {row.enabled && skill.fields.map(field => <label key={field.key}>{field.label}<input type={field.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={row.config[field.key] ?? ''} onChange={e => patchSkill(skill.id, { config: { ...row.config, [field.key]: e.target.value } })} /></label>)}
            </span>
            <label className="switch"><input type="checkbox" aria-label={`Enable ${skill.name}`} checked={row.enabled} onChange={e => patchSkill(skill.id, { enabled: e.target.checked })} />{row.enabled ? 'On' : 'Off'}</label>
          </div>;
        })}
      </section>;
}
