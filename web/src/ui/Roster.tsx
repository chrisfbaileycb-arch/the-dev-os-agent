import { Check, X } from 'lucide-react';
import { businessPersonas, skills, workflows, type Persona } from '../lib/roster';
import type { Workflow } from '../lib/types';
import { iconFor } from './icons';
function Card({ p, active, onPick }: { p: Persona; active: boolean; onPick?: (id: string) => void }) {
  const Icon = iconFor(p.icon);
  return <button className={active ? 'persona-card active' : 'persona-card'} onClick={() => onPick?.(p.id)} disabled={!onPick} aria-pressed={active}>
    <span className="persona-icon"><Icon size={17} strokeWidth={1.75} /></span>
    <span className="persona-text"><strong>{p.name}{active && <Check size={13} />}</strong><small>{p.tagline}</small><span className="caps">{p.capabilities.map(c => <em key={c}>{c}</em>)}{p.tools?.map(t => <em key={t} className="tool">{t}</em>)}</span></span>
  </button>;
}
export function RosterList({ activeId, onPick }: { activeId: string; onPick: (id: string) => void }) {
  return <>
    <h3 className="group-label">Business agents</h3>
    <div className="persona-grid">{businessPersonas.map(p => <Card key={p.id} p={p} active={p.id === activeId} onPick={onPick} />)}</div>
    <h3 className="group-label">Work skills <small>used by the workflows, in this order</small></h3>
    <div className="persona-grid">{skills.map(p => <Card key={p.id} p={p} active={false} />)}</div>
    <h3 className="group-label">Workflows</h3>
    <div className="workflow-list">{(Object.keys(workflows) as Workflow[]).map(w => <div key={w} className="workflow-row"><strong>{workflows[w].label}</strong><span>{workflows[w].description}</span></div>)}</div>
  </>;
}
export default function RosterDrawer({ open, close, activeId, onPick }: { open: boolean; close: () => void; activeId: string; onPick: (id: string) => void }) {
  if (!open) return null;
  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}><section className="drawer" role="dialog" aria-modal="true" aria-labelledby="roster-title">
    <div className="drawer-head"><h2 id="roster-title">Choose an agent</h2><button className="icon-button" aria-label="Close" onClick={close} autoFocus><X size={16} /></button></div>
    <p className="help">The business agents lead a chat. Workflows hand the goal to the work skills, in the lead agent's focus.</p>
    <RosterList activeId={activeId} onPick={id => { onPick(id); close(); }} />
  </section></div>;
}
