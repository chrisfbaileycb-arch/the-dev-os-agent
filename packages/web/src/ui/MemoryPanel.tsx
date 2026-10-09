import { useState } from 'react';
import { Brain, Plus, Trash2 } from 'lucide-react';
import type { MemoryEntry, MemoryKind } from '../lib/types';

// What the workspace remembers between sessions, and the one place to see or change it.
//
// Memories are written three ways: a message that starts "remember that …" saves a preference,
// a finished Build saves a line about what was built, and a failed request saves what went wrong.
// Only the few that match a new message are sent with it. Everything shown here lives in this
// browser's IndexedDB and nowhere else.

const KIND_LABEL: Record<MemoryKind, string> = { preference: 'Preference', project: 'Project', failure: 'Failure' };

export interface MemoryPanelProps {
  memories: MemoryEntry[];
  busy: boolean;
  add: (text: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export default function MemoryPanel(p: MemoryPanelProps) {
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<MemoryKind | 'all'>('all');
  const shown = p.memories.filter(m => filter === 'all' || m.kind === filter).sort((a, b) => (b.usedAt ?? b.createdAt).localeCompare(a.usedAt ?? a.createdAt));

  async function submit() {
    if (!text.trim()) return;
    await p.add(text);
    setText('');
  }

  return <section className="panel memory-panel">
    <div className="panel-head"><h2><Brain size={15} strokeWidth={1.75} /> What this crew remembers</h2><span className="pill">{p.memories.length} saved</span></div>
    <p className="help">Short facts the workspace keeps between sessions. Each message carries only the few that match it, never the whole list. Keys and passwords are refused, not stored. Start a message with <code>remember that …</code> to add one from the chat.</p>
    <div className="row gap">
      <input className="grow" value={text} maxLength={600} disabled={p.busy} placeholder="I deploy to Render; use pnpm, not npm" onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void submit(); }} aria-label="New memory" />
      <button className="button primary small" disabled={p.busy || !text.trim()} onClick={() => void submit()}><Plus size={13} />Remember</button>
    </div>
    <div className="segmented" role="group" aria-label="Filter memories">
      {(['all', 'preference', 'project', 'failure'] as const).map(k => <button key={k} aria-pressed={filter === k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : KIND_LABEL[k]}</button>)}
    </div>
    {shown.length
      ? <div className="memory-list">{shown.map(m => <div key={m.id} className="memory-row">
          <em className={`memory-kind ${m.kind}`}>{KIND_LABEL[m.kind]}</em>
          <span>{m.text}<small>{m.hits ? `used ${m.hits} time${m.hits === 1 ? '' : 's'} · ` : ''}{new Date(m.createdAt).toLocaleDateString()}</small></span>
          <button className="icon-button" aria-label="Forget this memory" title="Forget" disabled={p.busy} onClick={() => void p.remove(m.id)}><Trash2 size={13} /></button>
        </div>)}</div>
      : <p className="help">{p.memories.length ? 'Nothing of this kind yet.' : 'Nothing remembered yet.'}</p>}
  </section>;
}
