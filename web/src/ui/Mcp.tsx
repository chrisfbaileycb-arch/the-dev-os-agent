import { useState } from 'react';
import { LoaderCircle, Plug, RefreshCw, Trash2, X } from 'lucide-react';
import { refreshTools, type McpConnection } from '../lib/mcp';
export interface McpProps { open: boolean; close: () => void; connections: McpConnection[]; setConnections: (list: McpConnection[]) => void; notify: (s: string) => void; }
const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
export default function McpPanel(p: McpProps) {
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [token, setToken] = useState(''); const [saveToken, setSaveToken] = useState(false); const [busyId, setBusyId] = useState<string | null>(null);
  if (!p.open) return null;
  async function check(conn: McpConnection): Promise<McpConnection> {
    try { const tools = await refreshTools(conn, AbortSignal.timeout(45_000)); return { ...conn, tools, checkedAt: new Date().toISOString(), error: undefined }; }
    catch (e) { return { ...conn, tools: [], checkedAt: new Date().toISOString(), error: e instanceof Error ? e.message : 'Could not reach the server.' }; }
  }
  async function add() {
    let parsed: URL; try { parsed = new URL(url.trim()); if (parsed.protocol !== 'https:') throw new Error(); } catch { p.notify('Enter the server\'s https URL, for example https://mcp.example.com/mcp'); return; }
    const conn: McpConnection = { id: crypto.randomUUID(), name: name.trim() || parsed.host, url: parsed.toString(), token: token.trim(), saveToken, enabled: true, tools: [] };
    setBusyId(conn.id); const checked = await check(conn); setBusyId(null);
    p.setConnections([checked, ...p.connections]); setName(''); setUrl(''); setToken(''); setSaveToken(false);
    p.notify(checked.error ? `Added ${checked.name}, but it did not answer: ${checked.error}` : `Connected ${checked.name}: ${checked.tools.length} tool${checked.tools.length === 1 ? '' : 's'} available to your agents.`);
  }
  async function refresh(conn: McpConnection) { setBusyId(conn.id); const checked = await check(conn); setBusyId(null); p.setConnections(p.connections.map(c => c.id === conn.id ? checked : c)); }
  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget) p.close(); }}><section className="drawer" role="dialog" aria-modal="true" aria-labelledby="mcp-title">
    <div className="drawer-head"><h2 id="mcp-title"><Plug size={15} strokeWidth={1.75} /> MCP servers</h2><button className="icon-button" aria-label="Close" onClick={p.close} autoFocus><X size={16} /></button></div>
    <p className="help">Connect a remote Model Context Protocol server over Streamable HTTP and its tools become available to the agent you are chatting with, alongside the sandbox browser. Local servers on your own machine are not reachable from a hosted app; use a hosted endpoint or a tunnel with a token.</p>
    <section className="panel">
      <h3>Add a server</h3>
      <div className="form-grid">
        <label>Name<input value={name} maxLength={40} placeholder="Shop orders" onChange={e => setName(e.target.value)} /></label>
        <label className="grow">Server URL<input type="url" value={url} placeholder="https://mcp.example.com/mcp" onChange={e => setUrl(e.target.value)} /></label>
        <label className="grow">Bearer token (optional)<input type="password" autoComplete="off" spellCheck={false} value={token} placeholder="Token the server expects" onChange={e => setToken(e.target.value)} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={saveToken} onChange={e => setSaveToken(e.target.checked)} />Remember the token in this browser</label>
      <div className="row gap"><button className="button primary small" disabled={!url.trim() || busyId !== null} onClick={() => void add()}>{busyId && !p.connections.some(c => c.id === busyId) ? <LoaderCircle size={13} className="spin" /> : <Plug size={13} />}Connect and list tools</button></div>
      <p className="help">The token is sent only to that server, through this app's proxy, and stays in memory unless remembered. Servers must be https on a public host.</p>
    </section>
    {p.connections.map(c => <section key={c.id} className="panel mcp-row">
      <div className="panel-head"><div><strong>{c.name}</strong><small className="mono"> {host(c.url)}</small></div><label className="switch"><input type="checkbox" checked={c.enabled} onChange={e => p.setConnections(p.connections.map(x => x.id === c.id ? { ...x, enabled: e.target.checked } : x))} />Enabled</label></div>
      {c.error ? <p className="msg-error">{c.error}</p> : <p className="help">{c.tools.length} tool{c.tools.length === 1 ? '' : 's'}{c.checkedAt ? ` · checked ${new Date(c.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p>}
      {c.tools.length > 0 && <div className="caps">{c.tools.map(t => <em key={t.name} title={t.description}>{t.name}</em>)}</div>}
      <div className="row gap"><button className="button small" disabled={busyId === c.id} onClick={() => void refresh(c)}>{busyId === c.id ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}Refresh</button><button className="button small danger" onClick={() => p.setConnections(p.connections.filter(x => x.id !== c.id))}><Trash2 size={13} />Remove</button></div>
    </section>)}
    {!p.connections.length && <p className="help">No servers yet. Anything you connect here shows up as tools the agent can call, with a trace under each reply.</p>}
  </section></div>;
}
