import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleAlert, Download, LoaderCircle } from 'lucide-react';
import type { Run, StepView } from '../lib/types';
import { exportRun } from '../lib/store';
import { workflows } from '../lib/roster';

// A multi-agent run, shown as a pipeline rather than a wall.
//
// The old layout gave every stage an equal-width panel and a tall output pane, so a five-stage
// workflow ate the screen before producing a word. Here the stages are one compact horizontal
// strip of badges above the output: the strip reports progress at a glance, and exactly one
// stage's text is shown underneath — the newest by default, or whichever badge you click.
//
// The strip scrolls sideways rather than wrapping, so the shape of a run stays the same at
// every width, and the whole block collapses to a single line once the run finishes.

function download(name: string, body: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SHORT: Record<string, string> = { Dispatcher: 'Plan', Researcher: 'Research', Architect: 'Design', Reviewer: 'Review', Scribe: 'Write' };
const shortName = (agent: string) => SHORT[agent] ?? agent.split(' ')[0];

function StageIcon({ status, index }: { status: string; index: number }) {
  if (status === 'completed') return <Check size={11} strokeWidth={2.5} />;
  if (status === 'running') return <LoaderCircle size={11} className="spin" />;
  if (status === 'failed') return <CircleAlert size={11} />;
  return <span className="stage-index">{index + 1}</span>;
}

export default function RunCard({ run }: { run: Run }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const active = run.steps.find(s => s.status === 'running');
  // Follow the run while it is live; once the person clicks a badge, respect that choice.
  const shown: StepView | undefined = run.steps.find(s => s.id === selected)
    ?? active
    ?? [...run.steps].reverse().find(s => s.output || s.error);
  const done = run.steps.filter(s => s.status === 'completed').length;
  const total = run.steps.length || 5;
  const running = run.status === 'running';

  // A finished run folds itself away so the conversation below it stays readable.
  useEffect(() => { if (!running && !selected) setCollapsed(true); }, [running, selected]);

  return <div className={`run ${run.status}`}>
    <div className="run-strip">
      <button className="run-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Show stage output' : 'Hide stage output'}>
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <strong>{workflows[run.workflow].label}</strong>
      </button>
      <div className="stages" role="tablist" aria-label="Workflow stages">
        {run.steps.map((s, i) => <button
          key={s.id} role="tab" aria-selected={shown?.id === s.id}
          className={`stage ${s.status}${shown?.id === s.id ? ' selected' : ''}`}
          title={`${s.agent}: ${s.title} — ${s.status}`}
          onClick={() => { setSelected(s.id); setCollapsed(false); }}
        ><StageIcon status={s.status} index={i} />{shortName(s.agent)}</button>)}
        {!run.steps.length && <span className="stage pending"><LoaderCircle size={11} className="spin" />Starting</span>}
      </div>
      <span className={`status ${run.status}`}>{running ? `${done}/${total}` : run.status}</span>
      <button className="text-button" onClick={() => download('heybuddy-run.md', exportRun(run))} title="Export this run as Markdown"><Download size={12} /><span className="chip-label">Export</span></button>
    </div>
    {!collapsed && <>
      {shown && <div className="run-stage-head"><strong>{shown.agent}</strong><small>{shown.title}</small></div>}
      <pre className="run-output" aria-live="polite">{shown?.output ?? shown?.error ?? 'Stages report here as they finish.'}</pre>
    </>}
    <small className="run-meta">{run.mode === 'demo' ? 'scripted preview' : run.model} · {run.calls} request{run.calls === 1 ? '' : 's'} · {run.tokens.toLocaleString()} tokens{run.origin === 'server' ? ' · background worker' : ''}</small>
  </div>;
}
