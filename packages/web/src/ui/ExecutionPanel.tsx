import { useState } from 'react';
import { Download, Play, Square } from 'lucide-react';
import { composePrompt, type Persona } from '../lib/roster';
import { exportSkillStack, loadSkillState, loadYourSkills, protectedSystemPrompts } from '../lib/skillRegistry';
import { loadWorkingMemory } from '../lib/workingMemory';
import { redactSecrets } from '../lib/secrets';
import { saveBlob } from '../lib/download';
import type { McpConnection } from '../lib/mcp';
import type { Run } from '../lib/types';
import type { ChatMessage } from '../lib/store';
export interface ExecutionProps {
  runs: Run[]; messages: ChatMessage[]; persona: Persona; connectors: McpConnection[]; secrets: string[];
  busy: boolean; onApprove: (run: Run) => void; onStop: () => void;
}
export function agentPackage(p: Pick<ExecutionProps, 'persona' | 'connectors'>, includeMemory = false) {
  return {
    schemaVersion: '1.0', name: p.persona.name, persona: p.persona,
    systemInstructions: composePrompt(p.persona), systemDefaults: protectedSystemPrompts(),
    skills: exportSkillStack(loadSkillState(), loadYourSkills()).skills.filter(s => s.enabled),
    connectors: p.connectors.filter(c => c.enabled).map(c => ({ name: c.name, url: c.url, transport: c.transport, method: c.method, tools: c.tools })),
    ...(includeMemory ? { workingMemory: loadWorkingMemory() } : {}),
    execution: { runner: 'browser-web-worker', phaseApprovals: true, maxWorkflowCalls: 15, maxToolCallsPerChat: 2 },
  };
}
export default function ExecutionPanel(p: ExecutionProps) {
  const [includeMemory, setIncludeMemory] = useState(false);
  const traces = p.messages.flatMap(m => (m.tools ?? []).map((t, index) => ({ ...t, id: `${m.id}:${index}`, at: m.at })));
  function exportAgent() {
    const clean = redactSecrets(JSON.stringify(agentPackage(p, includeMemory), null, 2), p.secrets);
    saveBlob(new Blob([clean.text], { type: 'application/json' }), 'signal-forge-agent.json');
  }
  return <section className="execution-panel" aria-label="DevOps and execution">
    <div className="panel-head"><div><h2>DevOps / Execution</h2><p className="help">Agent workflows run in an isolated Web Worker. Tool calls use configured connectors and appear below.</p></div><button className="button primary small" onClick={exportAgent}><Download size={13} />Export Agent</button></div>
    <label className="check"><input type="checkbox" checked={includeMemory} onChange={e => setIncludeMemory(e.target.checked)} />Include local working memory in the export</label>
    <div className="caps"><em>Lead: {p.persona.name}</em><em>{p.busy ? 'Task active' : 'Idle'}</em><em>{p.connectors.filter(c => c.enabled).length} tool connectors</em></div>
    <h3>Workflow executions</h3>
    {!p.runs.length && <p className="help">No workflows in this session. Choose Plan to run a phased agent workflow.</p>}
    {p.runs.map(run => <article className="execution-run" key={run.id}>
      <div className="panel-head"><strong>{run.goal}</strong><span className="pill">{run.status.replaceAll('_', ' ')}</span></div>
      <p className="help">{run.origin === 'server' ? 'Server worker' : 'Browser worker'} · {run.calls} model calls · {run.tokens.toLocaleString()} tokens</p>
      <ol className="execution-steps">{run.steps.map(step => <li key={step.id}>
        <div className="panel-head"><strong>{step.title}</strong><span className="pill">{step.status}</span></div>
        <p className="help">{step.agent} · {step.model ?? run.model} · {step.attempts} retry attempts</p>
        {step.error && <p className="msg-error">{step.error}</p>}
        {step.output && <details open={step.status === 'running'}><summary>Step output</summary><pre className="skill-body">{step.output}</pre></details>}
      </li>)}</ol>
      {run.status === 'awaiting_approval' && <div className="row gap"><button className="button primary small" onClick={() => p.onApprove(run)}><Play size={12} />Approve next phase</button><button className="button small" onClick={p.onStop}><Square size={12} />Stop</button></div>}
      {run.status === 'running' && <button className="button small" onClick={p.onStop}><Square size={12} />Stop workflow</button>}
    </article>)}
    <h3>Tool calls</h3>
    {!traces.length && <p className="help">No tool calls have executed in this session.</p>}
    {traces.map(trace => <details key={trace.id} className="execution-run"><summary>{trace.tool} · {trace.ok ? 'Succeeded' : 'Failed'} · {new Date(trace.at).toLocaleTimeString()}</summary><pre className="skill-body">{redactSecrets(JSON.stringify(trace.args, null, 2), p.secrets).text}</pre><p className={trace.ok ? 'help' : 'msg-error'}>{redactSecrets(trace.summary, p.secrets).text}</p></details>)}
  </section>;
}
