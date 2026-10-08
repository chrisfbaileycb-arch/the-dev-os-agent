import { useState } from 'react';
import { Check, Database, FileText, Globe, LoaderCircle, Plug, Plus, RefreshCw, Trash2, Upload, X, Zap } from 'lucide-react';
import { GithubMark } from './GithubMark';
import { guessTransport, refreshTools, type McpConnection, type McpTransport } from '../lib/mcp';
import { type ConnectorSettings } from '../lib/connectors';
import { MCP_PRESETS, MCP_PRESET_GROUPS, presetConnected, presetForm, type McpPreset, type McpPresetGroup } from '../lib/mcpPresets';
import { useDismiss } from './useDismiss';
import type { Knowledge } from '../lib/types';

// The Connectors hub. One menu, four kinds of reach, each switchable on its own.
//
// Each connector is named for what it does — read a repository, read a URL, read your
// documents — and custom MCP is one of four, not the whole idea. Model keys are not
// connectors. They live in Settings. An MCP server is a tool the agent may call; a chat
// prompt is never sent to one.

export type ConnectorTab = 'github' | 'web' | 'files' | 'mcp';

export interface ConnectorsProps {
  open: boolean; close: () => void;
  tab: ConnectorTab; setTab: (t: ConnectorTab) => void;
  settings: ConnectorSettings; setSettings: (s: ConnectorSettings) => void;
  mcp: McpConnection[]; setMcp: (list: McpConnection[]) => void;
  knowledge: Knowledge[];
  addDocuments: (files: File[]) => void;
  removeDocument: (id: string) => void;
  notify: (message: string) => void;
}

const TABS: { id: ConnectorTab; label: string; icon: typeof GithubMark; blurb: string }[] = [
  { id: 'github', label: 'GitHub', icon: GithubMark, blurb: 'Repo reader and issue auditor' },
  { id: 'web', label: 'Web', icon: Globe, blurb: 'URL crawler, no CORS limits' },
  { id: 'files', label: 'Documents', icon: FileText, blurb: 'Drag-and-drop knowledge index' },
  { id: 'mcp', label: 'Custom MCP', icon: Plug, blurb: 'External agent servers' },
];

const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };

export default function Connectors(p: ConnectorsProps) {
  const [url, setUrl] = useState(''); const [name, setName] = useState(''); const [token, setToken] = useState(''); const [saveToken, setSaveToken] = useState(false);
  const [transport, setTransport] = useState<McpTransport | 'auto'>('auto');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preset, setPreset] = useState<McpPreset | null>(null);
  const [presetQuery, setPresetQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<McpPresetGroup | 'All'>('All');

  const urlError = (() => {
    const v = url.trim();
    if (!v) return '';
    // Looks like a provider/model slug (e.g. groq/llama-3.3-70b-versatile)
    if (/^[a-z0-9_-]+\/[a-z0-9._:-]+$/i.test(v) && !v.includes('://'))
      return 'That looks like a model name, not a server URL. Enter an https:// address, for example https://mcp.example.com/mcp.';
    try {
      const parsed = new URL(v);
      if (parsed.protocol !== 'https:') return 'MCP servers must use https://. Local servers need a public tunnel (e.g. ngrok).';
    } catch { return 'Enter a valid https:// URL, for example https://mcp.example.com/mcp.'; }
    return '';
  })();
  useDismiss(p.open, p.close);
  if (!p.open) return null;

  const patch = (partial: Partial<ConnectorSettings>) => p.setSettings({ ...p.settings, ...partial });

  async function check(conn: McpConnection): Promise<McpConnection> {
    try { const tools = await refreshTools(conn, AbortSignal.timeout(45_000)); return { ...conn, tools, checkedAt: new Date().toISOString(), error: undefined }; }
    catch (e) { return { ...conn, tools: [], checkedAt: new Date().toISOString(), error: e instanceof Error ? e.message : 'Could not reach the server.' }; }
  }
  async function addMcp() {
    let parsed: URL;
    try { parsed = new URL(url.trim()); if (parsed.protocol !== 'https:') throw new Error(); }
    catch { p.notify('Enter the server\'s https URL, for example https://mcp.example.com/mcp'); return; }
    const conn: McpConnection = { id: crypto.randomUUID(), name: name.trim() || parsed.host, url: parsed.toString(), transport: transport === 'auto' ? guessTransport(parsed.toString()) : transport, token: token.trim(), saveToken, enabled: true, tools: [] };
    setBusyId(conn.id); const checked = await check(conn); setBusyId(null);
    p.setMcp([checked, ...p.mcp]); setName(''); setUrl(''); setToken(''); setSaveToken(false); setTransport('auto');
    p.notify(checked.error ? `Added ${checked.name}, but it did not answer: ${checked.error}` : `Connected ${checked.name}: ${checked.tools.length} tool${checked.tools.length === 1 ? '' : 's'} available to your agents.`);
  }
  async function refresh(conn: McpConnection) { setBusyId(conn.id); const checked = await check(conn); setBusyId(null); p.setMcp(p.mcp.map(c => c.id === conn.id ? checked : c)); }

  async function quickConnect(presetToConnect: McpPreset, customToken?: string) {
    const f = presetForm(presetToConnect);
    const connToken = (customToken !== undefined ? customToken : (presetToConnect.url === url ? token : '')).trim();
    const conn: McpConnection = {
      id: crypto.randomUUID(),
      name: f.name,
      url: f.url,
      transport: f.transport,
      token: connToken,
      saveToken: Boolean(saveToken),
      enabled: true,
      tools: []
    };
    setBusyId(conn.id);
    const checked = await check(conn);
    setBusyId(null);
    p.setMcp([checked, ...p.mcp.filter(c => !presetConnected(presetToConnect, [c]))]);
    p.notify(checked.error ? `Added ${checked.name}, but it did not answer: ${checked.error}` : `Connected ${checked.name}: ${checked.tools.length} tool${checked.tools.length === 1 ? '' : 's'} available to your agents.`);
  }

  async function connectAllPresets() {
    setBusyId('all');
    let connectedCount = 0;
    let nextList = [...p.mcp];
    for (const pr of MCP_PRESETS) {
      if (presetConnected(pr, nextList)) continue;
      const f = presetForm(pr);
      const conn: McpConnection = {
        id: crypto.randomUUID(),
        name: f.name,
        url: f.url,
        transport: f.transport,
        token: '',
        saveToken: false,
        enabled: true,
        tools: []
      };
      const checked = await check(conn);
      nextList = [checked, ...nextList];
      connectedCount++;
    }
    setBusyId(null);
    p.setMcp(nextList);
    p.notify(`Connected ${connectedCount} MCP connector${connectedCount === 1 ? '' : 's'}. All active tools are ready.`);
  }

  const mcpTools = p.mcp.filter(c => c.enabled).reduce((n, c) => n + c.tools.length, 0);
  const counts: Record<ConnectorTab, number> = { github: p.settings.github.enabled ? 1 : 0, web: p.settings.web.enabled ? 1 : 0, files: p.settings.knowledge.enabled ? p.knowledge.length : 0, mcp: mcpTools };

  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget) p.close(); }}>
    <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="connectors-title">
      <div className="drawer-head">
        <h2 id="connectors-title"><Plug size={15} strokeWidth={1.75} /> Connectors</h2>
        <button className="icon-button" aria-label="Close" onClick={p.close} autoFocus><X size={16} /></button>
      </div>
      <p className="help">What your agents can reach beyond the model. Each connector adds named tools the agent may call, and every call shows up as a trace under the reply.</p>

      <div className="connector-tabs" role="tablist" aria-label="Connector">
        {TABS.map(t => <button key={t.id} role="tab" aria-selected={p.tab === t.id} className={p.tab === t.id ? 'connector-tab active' : 'connector-tab'} onClick={() => p.setTab(t.id)}>
          <t.icon size={15} strokeWidth={1.75} />
          <span><strong>{t.label}</strong><small>{t.blurb}</small></span>
          {counts[t.id] ? <em>{counts[t.id]}</em> : null}
        </button>)}
      </div>

      {p.tab === 'github' && <section className="panel">
        <div className="panel-head"><h3>GitHub</h3><label className="switch"><input type="checkbox" checked={p.settings.github.enabled} onChange={e => patch({ github: { ...p.settings.github, enabled: e.target.checked } })} />Enabled</label></div>
        <p className="help">Read-only for your agents: they get <code>github_repo</code> (description, README, or any text file), <code>github_files</code> (the file listing), and <code>github_issues</code> (recent issues, or one issue with its comments) — nothing they call can write to a repository. The one write in this app lives elsewhere: the "Push to GitHub" button on a generated app's Output panel, which commits with this same token and needs one scoped for write access to push.</p>
        <label>Personal access token (optional)<input type="password" autoComplete="off" spellCheck={false} value={p.settings.github.token} placeholder="ghp_… for private repos and a higher rate limit" onChange={e => patch({ github: { ...p.settings.github, token: e.target.value } })} /></label>
        <label className="check"><input type="checkbox" checked={p.settings.github.saveToken} onChange={e => patch({ github: { ...p.settings.github, saveToken: e.target.checked } })} />Remember this token in this browser</label>
        <p className="help">Without a token GitHub allows 60 calls an hour and public repositories only. A fine-grained token with read-only Contents and Issues access raises that to 5,000 and reaches your private repositories for reading; add write access to Contents on the same token if you also want to use "Push to GitHub". The token is sent to GitHub through this app's proxy and is never stored on the server.</p>
      </section>}

      {p.tab === 'web' && <section className="panel">
        <div className="panel-head"><h3>Web scraping and URL crawler</h3><label className="switch"><input type="checkbox" checked={p.settings.web.enabled} onChange={e => patch({ web: { enabled: e.target.checked } })} />Enabled</label></div>
        <p className="help">Gives your agents <code>fetch_url</code>: a server-side fetcher that pulls a text snapshot of any public URL — title, description, headings, readable text, and links. The browser cannot do this itself because of CORS, so the request is made here and handed back same-origin.</p>
        <p className="help">No JavaScript runs and no cookies are sent, so a page that renders entirely in the browser may come back thin. For those, the Browser Agent persona opens a real Chromium page instead, on the hosts this deployment allowlists.</p>
        <p className="help">Private, reserved, and unresolvable addresses are blocked, redirects are re-checked at every hop, and the response is capped at 1.5 MB.</p>
      </section>}

      {p.tab === 'files' && <section className="panel">
        <div className="panel-head"><h3>File and document knowledge hub</h3><label className="switch"><input type="checkbox" checked={p.settings.knowledge.enabled} onChange={e => patch({ knowledge: { enabled: e.target.checked } })} />Enabled</label></div>
        <p className="help">Documents stay in this browser. Matching passages are attached to a message automatically, and <code>search_documents</code> lets an agent go looking for one the message did not surface. The index is bounded lexical scoring, not embeddings — honest keyword retrieval, no vector database.</p>
        <div
          className={dragging ? 'dropzone dragging' : 'dropzone'}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); p.addDocuments([...e.dataTransfer.files]); }}
        >
          <Upload size={20} strokeWidth={1.5} />
          <p>Drop text, Markdown, CSV, JSON, or HTML files here</p>
          <label className="button small"><Plus size={13} />Choose files<input type="file" className="sr-only" accept=".txt,.md,.csv,.json,.html" multiple onChange={e => { p.addDocuments([...(e.target.files ?? [])]); e.target.value = ''; }} /></label>
        </div>
        {p.knowledge.length > 0
          ? <div className="doc-list">{p.knowledge.slice(0, 20).map(d => <div key={d.id} className="doc-row"><FileText size={13} /><span><strong>{d.title}</strong><small>{d.content.length.toLocaleString()} characters</small></span><button className="icon-button" aria-label={`Remove ${d.title}`} onClick={() => p.removeDocument(d.id)}><Trash2 size={13} /></button></div>)}{p.knowledge.length > 20 && <p className="help">{p.knowledge.length - 20} more in the Knowledge hub.</p>}</div>
          : <p className="help">Nothing indexed yet. A menu, a price list, a contract, or a brand voice note goes a long way.</p>}
      </section>}

      {p.tab === 'mcp' && <>
        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
            <div>
              <h3 style={{ fontSize: '13px', fontWeight: 650, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Zap size={14} style={{ color: 'var(--accent)' }} /> Remote MCP servers
              </h3>
              <p className="help">Bookmarks for real remote servers. Each one is contacted at its own URL with a token you supply. Nothing here runs inside this app.</p>
            </div>
            <button
              className="button primary small"
              disabled={busyId !== null || MCP_PRESETS.every(pr => presetConnected(pr, p.mcp))}
              onClick={() => void connectAllPresets()}
              title="Add every bookmark that is not already connected"
            >
              {busyId === 'all' ? <LoaderCircle size={13} className="spin" /> : <Plug size={13} />}
              Connect listed servers
            </button>
          </div>

          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="search"
              placeholder="Search MCP servers"
              value={presetQuery}
              onChange={e => setPresetQuery(e.target.value)}
              style={{ flex: 1, minWidth: '180px', padding: '5px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--line-strong)', background: 'var(--panel)', fontSize: '12px' }}
            />
            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
              {(['All', ...MCP_PRESET_GROUPS] as (McpPresetGroup | 'All')[]).map(g => (
                <button
                  key={g}
                  className={activeGroup === g ? 'output-tab active' : 'output-tab'}
                  style={{ fontSize: '11px', padding: '2px 8px' }}
                  onClick={() => setActiveGroup(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="preset-grid">
            {MCP_PRESETS.filter(pr => {
              if (activeGroup !== 'All' && pr.group !== activeGroup) return false;
              if (!presetQuery.trim()) return true;
              const q = presetQuery.toLowerCase();
              return pr.name.toLowerCase().includes(q) || pr.blurb.toLowerCase().includes(q) || pr.id.toLowerCase().includes(q);
            }).map(presetItem => {
              const connected = presetConnected(presetItem, p.mcp);
              const isSelected = url === presetItem.url;
              return <div
                key={presetItem.id}
                className={isSelected ? 'preset active' : 'preset'}
                style={{ cursor: 'pointer', position: 'relative' }}
                onClick={() => {
                  const f = presetForm(presetItem);
                  setName(f.name);
                  setUrl(f.url);
                  setTransport(f.transport);
                  setToken('');
                  setPreset(presetItem);
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                    <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{presetItem.name}</strong>
                  </div>
                  {connected ? (
                    <span style={{ fontSize: '11px', color: 'var(--ok)', display: 'inline-flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                      <Check size={12} /> Connected
                    </span>
                  ) : (
                    <button
                      className="button small"
                      style={{ padding: '2px 7px', fontSize: '11px', flexShrink: 0 }}
                      disabled={busyId !== null}
                      onClick={e => {
                        e.stopPropagation();
                        void quickConnect(presetItem);
                      }}
                      title={`Connect ${presetItem.name}`}
                    >
                      {busyId === presetItem.id ? <LoaderCircle size={11} className="spin" /> : <Plug size={11} />}
                      Connect
                    </button>
                  )}
                </div>
                <small style={{ marginTop: '2px' }}>{presetItem.blurb}</small>
              </div>;
            })}
          </div>
        </section>
        <section className="panel">
          <h3>Add or Configure a Model Context Protocol server</h3>
          <p className="help">Connect any remote or internal MCP server over Streamable HTTP (MCP 2025-06-18) or HTTP+SSE (2024-11-05). All active tools become available to the agent you are chatting with.</p>
          <div className="form-grid">
            <label>Name<input value={name} maxLength={40} placeholder="Custom MCP Service" onChange={e => setName(e.target.value)} /></label>
            <label className="grow">Server URL<input type="url" value={url} placeholder="https://mcp.example.com/mcp" onChange={e => setUrl(e.target.value)} className={urlError ? 'input-error' : ''} />{urlError && <span className="field-error">{urlError}</span>}</label>
            <label className="grow">Bearer token (optional)<input type="password" autoComplete="off" spellCheck={false} value={token} placeholder={preset && url === preset.url ? (preset.token ? `${preset.token} (optional or sandbox)` : 'Not needed for this server') : 'Token the server expects'} onChange={e => setToken(e.target.value)} /></label>
            <label>Transport<select value={transport} onChange={e => setTransport(e.target.value as McpTransport | 'auto')}>
              <option value="auto">Automatic{url.trim() ? ` (${guessTransport(url) === 'sse' ? 'HTTP+SSE' : 'Streamable HTTP'})` : ''}</option>
              <option value="http">Streamable HTTP</option>
              <option value="sse">HTTP+SSE (legacy /sse)</option>
            </select></label>
          </div>
          <label className="check"><input type="checkbox" checked={saveToken} onChange={e => setSaveToken(e.target.checked)} />Remember the token in this browser</label>
          <div className="row gap"><button className="button primary small" disabled={!url.trim() || !!urlError || busyId !== null} onClick={() => void addMcp()}>{busyId && !p.mcp.some(c => c.id === busyId) ? <LoaderCircle size={13} className="spin" /> : <Plug size={13} />}Connect and list tools</button></div>
          <p className="help">The token is sent securely to that server through this app's proxy and stays in memory unless remembered.</p>
        </section>
        {p.mcp.map(c => <section key={c.id} className="panel mcp-row">
          <div className="panel-head"><div><strong>{c.name}</strong><small className="mono"> {host(c.url)} · {c.transport === 'sse' ? 'HTTP+SSE' : 'Streamable HTTP'}</small></div><label className="switch"><input type="checkbox" checked={c.enabled} onChange={e => p.setMcp(p.mcp.map(x => x.id === c.id ? { ...x, enabled: e.target.checked } : x))} />Enabled</label></div>
          {c.error ? <p className="msg-error">{c.error}</p> : <p className="help">{c.tools.length} tool{c.tools.length === 1 ? '' : 's'}{c.checkedAt ? ` · checked ${new Date(c.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p>}
          {c.tools.length > 0 && <div className="caps">{c.tools.map(t => <em key={t.name} title={t.description}>{t.name}</em>)}</div>}
          <div className="row gap"><button className="button small" disabled={busyId === c.id} onClick={() => void refresh(c)}>{busyId === c.id ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}Refresh</button><button className="button small danger" onClick={() => p.setMcp(p.mcp.filter(x => x.id !== c.id))}><Trash2 size={13} />Remove</button></div>
        </section>)}
        {!p.mcp.length && <p className="help"><Database size={12} /> No servers connected yet. Pick one above, or paste any https MCP URL.</p>}
      </>}
    </section>
  </div>;
}
