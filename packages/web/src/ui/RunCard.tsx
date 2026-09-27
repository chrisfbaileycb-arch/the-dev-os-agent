import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleAlert, Download, Play, Square } from 'lucide-react';
import type { Run } from '../lib/types';
import { exportRun } from '../lib/store';
import { workflows } from '../lib/roster';

// A Plan / Autonomous Run, shown as one calm result rather than a multi-agent control room.
//
// The engine underneath is a five-stage task graph with named agents, retries and per-stage
// models, and none of that is what the person asked about. So the card says three things only:
// that it is working (a pulse and a plain step name), what it needs from you (approve the phase it
// just finished, or stop), and what it produced (the final deliverable, as the reply). The
// intermediate phases are still here, folded under "Show working", for anyone who wants to check
// how it got there — closed by default, and never labelled with internal agent names.

function download(name: string, body: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface RunCardProps { run: Run; onApprove?: () => void; onStop?: () => void; }

export default function RunCard({ run, onApprove, onStop }: RunCardProps) {
  const [working, setWorking] = useState(false);
  const finished = run.steps.filter(s => s.status === 'completed');
  const current = run.steps.find(s => s.status === 'running' || s.status === 'assigned');
  const final = run.status === 'completed' ? finished[finished.length - 1] : undefined;
  const failure = run.steps.find(s => s.error)?.error;
  const label = workflows[run.workflow].label;
  // At a gate, show everything the phase just produced: that is what is being approved.
  const gateOutputs = run.status === 'awaiting_approval' && run.gate ? finished.filter(s => s.phase === run.gate!.phase - 1) : [];

  return <div className={`run calm ${run.status}`}>
    {run.status === 'running' && <p className="run-pulse" role="status"><span className="pulse-dot" />Building… <span className="run-step">{current?.title ?? 'Starting'}</span></p>}

    {run.status === 'awaiting_approval' && <div className="run-gate" role="group" aria-label="Approval needed">
      <p className="run-gate-head"><strong>Phase {run.gate?.phase ?? finished.length} of {run.gate?.phases ?? 4} done — approve to continue</strong><small>Nothing further is sent to the model until you approve.</small></p>
      {gateOutputs.map(s => <div key={s.id} className="run-phase"><small>{s.title}</small><pre className="msg-body">{s.output}</pre></div>)}
      <div className="row gap">
        <button className="button primary small" onClick={onApprove} disabled={!onApprove}><Play size={12} />Approve and continue</button>
        <button className="button small" onClick={onStop} disabled={!onStop}><Square size={12} />Stop here</button>
      </div>
    </div>}

    {final && <pre className="msg-body">{final.output}</pre>}
    {(run.status === 'failed' || run.status === 'interrupted') && <p className="msg-error"><CircleAlert size={12} />{run.status === 'interrupted' ? 'This run was interrupted when the page closed.' : failure ?? 'The run failed. Check your model and key in Settings.'}</p>}
    {run.status === 'cancelled' && <p className="help">Stopped{finished.length ? ` after ${finished.length} step${finished.length === 1 ? '' : 's'}` : ''}.</p>}

    {run.status !== 'running' && finished.length > 0 && <div className="run-foot">
      <button className="text-button" aria-expanded={working} onClick={() => setWorking(w => !w)}>{working ? <ChevronDown size={12} /> : <ChevronRight size={12} />}Show working</button>
      <button className="text-button" onClick={() => download('signal-forge-plan.md', exportRun(run))} title="Export this run as Markdown"><Download size={12} />Export</button>
      {run.status === 'completed' && <span className="run-done"><Check size={11} />{label}</span>}
    </div>}
    {working && <div className="run-working">{finished.filter(s => s !== final).map(s => <div key={s.id} className="run-phase"><small>{s.title}</small><pre className="msg-body">{s.output}</pre></div>)}</div>}
  </div>;
}
