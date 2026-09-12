import { useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { businessPersonas, generalPersonas, skills, workflows, type Persona } from '../lib/roster';
import { MAX_NAME, MAX_PROMPT, MAX_ROLE, createCustomAgent, validateDraft, type CustomAgentDraft } from '../lib/customAgents';
import type { Workflow } from '../lib/types';
import { iconFor } from './icons';
import { useDismiss } from './useDismiss';

// The agent drawer.
//
// Ordered by how likely it is to be what you want, which was not the previous order: the general
// agents lead, the business specialists follow, and the workflow machinery — five stage agents and
// three multi-agent sequences — sits at the bottom behind a disclosure, because it is a thing you
// occasionally ask for rather than the point of the product.
//
// Creating an agent is the first control in the drawer for the same reason. If none of the shipped
// personas talks the way you want, writing one is the answer, and it should not be the thing you
// discover last.

function Card({ p, active, onPick, onDelete }: { p: Persona; active: boolean; onPick?: (id: string) => void; onDelete?: (id: string) => void }) {
  const Icon = iconFor(p.icon);
  return <div className={active ? 'persona-card active' : 'persona-card'}>
    <button className="persona-hit" onClick={() => onPick?.(p.id)} disabled={!onPick} aria-pressed={active}>
      <span className="persona-icon"><Icon size={17} strokeWidth={1.75} /></span>
      <span className="persona-text"><strong>{p.name}{active && <Check size={13} />}</strong><small>{p.tagline}</small><span className="caps">{p.capabilities.map(c => <em key={c}>{c}</em>)}{p.tools?.map(t => <em key={t} className="tool">{t}</em>)}</span></span>
    </button>
    {onDelete && <button className="icon-button persona-delete" title={`Delete ${p.name}`} aria-label={`Delete ${p.name}`} onClick={() => onDelete(p.id)}><Trash2 size={13} /></button>}
  </div>;
}

const emptyDraft: CustomAgentDraft = { name: '', prompt: '', role: '' };

/** The create form. Three fields, because three is what it takes: who, how, and what to call it. */
function CreateAgent({ onCreate }: { onCreate: (p: Persona) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CustomAgentDraft>(emptyDraft);
  const [error, setError] = useState('');

  function submit() {
    const problem = validateDraft(draft);
    if (problem) { setError(problem); return; }
    try { const created = createCustomAgent(draft); setDraft(emptyDraft); setError(''); setOpen(false); onCreate(created); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the agent.'); }
  }

  if (!open) return <button className="button small create-agent" onClick={() => setOpen(true)}><Plus size={13} />Create custom agent</button>;
  return <section className="panel create-agent-form">
    <div className="panel-head"><h2>New agent</h2><button className="icon-button" aria-label="Cancel" onClick={() => { setOpen(false); setError(''); }}><X size={14} /></button></div>
    <label>Name<input value={draft.name} maxLength={MAX_NAME} autoFocus placeholder="Rust reviewer" onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></label>
    <label>Role<input value={draft.role} maxLength={MAX_ROLE} placeholder="Code review — optional, this is the label on the card" onChange={e => setDraft(d => ({ ...d, role: e.target.value }))} /></label>
    <label>System prompt<textarea value={draft.prompt} maxLength={MAX_PROMPT} rows={6} placeholder="You review Rust for correctness and lifetimes. Point at the line, name the problem, give the fix. No preamble." onChange={e => setDraft(d => ({ ...d, prompt: e.target.value }))} /></label>
    <p className="help">{draft.prompt.length.toLocaleString()} of {MAX_PROMPT.toLocaleString()} characters. The safety baseline and the workspace rules are always prepended to this, and win on any conflict. Saved in this browser only — there is no account to sync it to.</p>
    {error && <p className="msg-error">{error}</p>}
    <div className="row gap"><button className="button primary small" onClick={submit}><Check size={13} />Save agent</button><button className="button small" onClick={() => { setOpen(false); setError(''); }}>Cancel</button></div>
  </section>;
}

export interface RosterListProps {
  activeId: string;
  onPick: (id: string) => void;
  custom: Persona[];
  onCreate: (p: Persona) => void;
  onDelete: (id: string) => void;
}

export function RosterList(p: RosterListProps) {
  return <>
    <CreateAgent onCreate={p.onCreate} />
    <h3 className="group-label">General <small>direct chat and code — no planning steps</small></h3>
    <div className="persona-grid">{generalPersonas.map(x => <Card key={x.id} p={x} active={x.id === p.activeId} onPick={p.onPick} />)}</div>
    {p.custom.length > 0 && <>
      <h3 className="group-label">Your agents <small>saved in this browser</small></h3>
      <div className="persona-grid">{p.custom.map(x => <Card key={x.id} p={x} active={x.id === p.activeId} onPick={p.onPick} onDelete={p.onDelete} />)}</div>
    </>}
    <h3 className="group-label">Business specialists <small>opinionated on purpose</small></h3>
    <div className="persona-grid">{businessPersonas.map(x => <Card key={x.id} p={x} active={x.id === p.activeId} onPick={p.onPick} />)}</div>
    <details className="roster-advanced">
      <summary>Multi-agent workflows and their stage agents</summary>
      <p className="help">Optional. A workflow hands one goal to five agents in sequence instead of answering you directly, and costs five requests instead of one. Choose one from the mode selector on the dock when you want that; leave it on Direct chat otherwise.</p>
      <h3 className="group-label">Workflows</h3>
      <div className="workflow-list">{(Object.keys(workflows) as Workflow[]).map(w => <div key={w} className="workflow-row"><strong>{workflows[w].label}</strong><span>{workflows[w].description}</span></div>)}</div>
      <h3 className="group-label">Stage agents <small>used by the workflows, in this order</small></h3>
      <div className="persona-grid">{skills.map(x => <Card key={x.id} p={x} active={false} />)}</div>
    </details>
  </>;
}

export default function RosterDrawer({ open, close, ...rest }: RosterListProps & { open: boolean; close: () => void }) {
  useDismiss(open, close);
  if (!open) return null;
  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}><section className="drawer" role="dialog" aria-modal="true" aria-labelledby="roster-title">
    <div className="drawer-head"><h2 id="roster-title">Choose an agent</h2><button className="icon-button" aria-label="Close" onClick={close} autoFocus><X size={16} /></button></div>
    <p className="help">One agent answers you directly. The general agents are the plain ones and Assistant is the default; the specialists below take a stronger view, and you can write your own.</p>
    {/* Creating an agent selects it, so it closes the drawer for the same reason picking one does:
        the next thing wanted is the prompt box, not another look at the list. */}
    <RosterList {...rest} onPick={id => { rest.onPick(id); close(); }} onCreate={p => { rest.onCreate(p); close(); }} />
  </section></div>;
}
