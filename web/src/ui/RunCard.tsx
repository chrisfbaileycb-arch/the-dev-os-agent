import { useState } from 'react';
import { Check, Download, LoaderCircle } from 'lucide-react';
import type { Run } from '../lib/types';
import { exportRun } from '../lib/store';
import { workflows } from '../lib/roster';
function download(name: string, body: string, type = 'text/markdown') { const url = URL.createObjectURL(new Blob([body], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export default function RunCard({ run }: { run: Run }) {
  const [selected, setSelected] = useState<string | null>(null);
  const step = run.steps.find(s => s.id === selected) ?? [...run.steps].reverse().find(s => s.output || s.error);
  const done = run.steps.filter(s => s.status === 'completed').length;
  return <div className={`run-card ${run.status}`}>
    <div className="run-head"><strong>{workflows[run.workflow].label}</strong><span className={`status ${run.status}`}>{run.status}</span><small>{done}/{run.steps.length || 5} stages · {run.mode === 'demo' ? 'scripted preview' : run.model} · {run.calls} requests · {run.tokens.toLocaleString()} tokens</small><button className="text-button" onClick={() => download('heybuddy-run.md', exportRun(run))}><Download size={12} />Export</button></div>
    <div className="run-steps">{run.steps.map((s, i) => <button key={s.id} className={`run-step ${s.status} ${step?.id === s.id ? 'selected' : ''}`} onClick={() => setSelected(s.id)}><span className="step-no">{s.status === 'completed' ? <Check size={12} /> : s.status === 'running' ? <LoaderCircle size={12} className="spin" /> : i + 1}</span><span><strong>{s.agent}</strong><small>{s.title}</small></span></button>)}</div>
    <pre className="run-output" aria-live="polite">{step?.output ?? step?.error ?? 'Stages report here as they finish.'}</pre>
  </div>;
}
