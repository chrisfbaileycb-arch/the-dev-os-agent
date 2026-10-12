import { useEffect, useRef, useState } from 'react';
import { Download, Play, Square } from 'lucide-react';
import { agentDefinition, downloadExecutionBundle, exportAgentBundle, redactExportValue, type AgentExportFormat } from '../lib/exportAgentBundle';
import { redactSecrets } from '../lib/secrets';
import type { Persona } from '../lib/roster';
import type { McpConnection } from '../lib/mcp';
import type { MediaConfig } from '../lib/mediaTools';
import type { Run } from '../lib/types';
import type { ChatMessage } from '../lib/store';
import type { ProjectFile } from '../lib/project';
import type { ExecutionEvent, RuntimeArtifact, SandboxStatus } from '../lib/executionTypes';
export interface ExecutionProps {
  runs: Run[]; messages: ChatMessage[]; persona: Persona; connectors: McpConnection[]; secrets: string[];
  busy: boolean; onApprove: (run: Run) => void; onStop: () => void;
  events?: ExecutionEvent[]; artifacts?: RuntimeArtifact[]; media?: MediaConfig[];
  projectFiles?: ProjectFile[]; previewHtml?: string;
}
export const agentPackage = (p: Pick<ExecutionProps, 'persona' | 'connectors'>, includeMemory = false) => agentDefinition(p, includeMemory);
export function sandboxStatus(p: Pick<ExecutionProps, 'busy' | 'runs' | 'events'>): SandboxStatus {
  if (p.busy || p.events?.some(e => e.status === 'Running')) return 'Running';
  const latest = p.events?.at(-1);
  if (latest?.status === 'Error Trapped' || p.runs[0]?.status === 'failed' || p.runs[0]?.status === 'interrupted') return 'Error Trapped';
  if (latest?.status === 'Success' || p.runs[0]?.status === 'completed') return 'Success';
  return 'Idle';
}
export default function AgentSandboxConsole(p: ExecutionProps) {
  const [includeMemory, setIncludeMemory] = useState(true);
  const [format, setFormat] = useState<AgentExportFormat>('json');
  const [exporting, setExporting] = useState(false); const [error, setError] = useState('');
  const [follow, setFollow] = useState(true); const bottom = useRef<HTMLDivElement>(null);
  const events = p.events ?? []; const artifacts = p.artifacts ?? []; const status = sandboxStatus(p);
  const traces = p.messages.flatMap(m => (m.tools ?? []).map((t, index) => ({ ...t, id: `${m.id}:${index}`, at: m.at })));
  useEffect(() => { if (follow) bottom.current?.scrollIntoView({ block: 'nearest' }); }, [events, follow]);
  async function exportBundle(kind: 'agent' | 'runtime') {
    setExporting(true); setError('');
    try {
      if (kind === 'agent') await exportAgentBundle(p, format, includeMemory);
      else await downloadExecutionBundle({ ...p, events, artifacts, includeMemory });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the download.'); }
    finally { setExporting(false); }
  }
  const clean = (value: string) => redactSecrets(value, p.secrets).text;
  return <section className="execution-panel agent-sandbox-console" aria-label="Agent Sandbox / DevOps Console">
    <header className="panel-head"><div><h2>Agent Sandbox / DevOps Console</h2><p className="help">Isolated tool workers · live step outputs · browser-local artifacts</p></div><span className={`sandbox-status ${status === 'Error Trapped' ? 'error' : status === 'Running' ? 'running' : status === 'Success' ? 'success' : ''}`} role="status">{status}</span></header>
    <div className="sandbox-export-actions"><select aria-label="Agent export format" value={format} onChange={e => setFormat(e.target.value as AgentExportFormat)}><option value="json">JSON</option><option value="yaml">YAML</option></select><button className="button primary small" disabled={exporting} onClick={() => void exportBundle('agent')}><Download size={13} />Export Agent</button><button className="button small" disabled={exporting || (!events.length && !p.runs.length && !p.messages.length && !p.projectFiles?.length && !artifacts.length)} onClick={() => void exportBundle('runtime')}><Download size={13} />Download Execution Bundle</button></div>
    <label className="check"><input type="checkbox" checked={includeMemory} onChange={e => setIncludeMemory(e.target.checked)} />Include browser-injected memory in exports</label>
    {error && <p className="msg-error" role="alert">{error}</p>}
    <div className="caps"><em>Lead: {p.persona.name}</em><em>{p.connectors.filter(c => c.enabled).length} MCP connectors</em><em>{artifacts.length} saved artifacts</em></div>
    <h3>Workflow steps</h3>
    {!p.runs.length && <p className="help">Use Plan for a phased workflow. Chat and Build tool actions appear in the execution stream below.</p>}
    {p.runs.map(run => <article className="execution-run" key={run.id}><div className="panel-head"><strong>{clean(run.goal)}</strong><span className="pill">{run.status.replaceAll('_', ' ')}</span></div><p className="help">{run.origin === 'server' ? 'Server workflow' : 'Browser workflow'} · {run.calls} model calls · {run.tokens.toLocaleString()} tokens</p><ol className="execution-steps">{run.steps.map(step => <li key={step.id}><div className="panel-head"><strong>{clean(step.title)}</strong><span className="pill">{step.status}</span></div><p className="help">{step.agent} · {step.model ?? run.model}</p>{step.error && <p className="msg-error">{clean(step.error)}</p>}{step.output && <details open={step.status === 'running'}><summary>Agent-visible step output</summary><pre className="skill-body">{clean(step.output)}</pre></details>}</li>)}</ol>{run.status === 'awaiting_approval' && <button className="button primary small" onClick={() => p.onApprove(run)}><Play size={12} />Approve next phase</button>}{['running', 'awaiting_approval'].includes(run.status) && <button className="button small" onClick={p.onStop}><Square size={12} />Stop workflow</button>}</article>)}
    <div className="panel-head"><h3>Live execution stream</h3><label className="check"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />Follow latest</label></div>
    <div className="sandbox-log" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Streaming execution log">
      {!events.length && <p className="help">Waiting for an agent action. Each event records the skill or step, connector, arguments, stdout, and elapsed time.</p>}
      {events.map(event => <details className={`sandbox-event ${event.status === 'Error Trapped' ? 'failed' : ''}`} key={event.id} open={event.status === 'Running'}><summary><time>{new Date(event.at).toLocaleTimeString()}</time> {clean(event.title)} · {event.status}{event.durationMs !== undefined ? ` · ${(event.durationMs / 1000).toFixed(2)}s` : ''}</summary>{event.connector && <p className="help">Connector: {event.connector}</p>}{event.args && <><strong>Arguments payload</strong><pre className="skill-body">{JSON.stringify(redactExportValue(event.args, p.secrets), null, 2)}</pre></>}{event.stdout && <><strong>{event.kind === 'tool' ? 'stdout / response' : 'Agent output'}</strong><pre className="skill-body">{clean(event.stdout)}</pre></>}{event.artifactIds?.length ? <p className="help">Saved {event.artifactIds.length} artifact(s).</p> : null}</details>)}
      <div ref={bottom} />
    </div>
    {!!traces.length && !events.some(e => e.kind === 'tool') && <><h3>Earlier tool calls</h3>{traces.map(trace => <details key={trace.id} className="execution-run"><summary>{trace.tool} · {trace.ok ? 'Succeeded' : 'Failed'}</summary><pre className="skill-body">{JSON.stringify(redactExportValue(trace.args, p.secrets), null, 2)}</pre><p>{clean(trace.summary)}</p></details>)}</>}
    <h3>Runtime artifacts</h3>
    {!artifacts.length && <p className="help">Generated files, images, and video manifests are saved here during tool runs. The execution ZIP also includes generated code from every recorded step and the current preview.</p>}
    {artifacts.map(artifact => <details className="execution-run" key={artifact.id}><summary>{artifact.path} · {artifact.source}</summary>{artifact.encoding === 'base64' && ['image/png', 'image/jpeg', 'image/webp'].includes(artifact.mimeType) ? <img className="sandbox-artifact-image" src={`data:${artifact.mimeType};base64,${artifact.content}`} alt={`Generated artifact ${artifact.path}`} /> : artifact.encoding === 'utf8' ? <pre className="skill-body">{clean(artifact.content)}</pre> : <p className="help">Binary artifact included in the execution ZIP.</p>}</details>)}
  </section>;
}
