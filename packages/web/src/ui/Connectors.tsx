import { useEffect, useState } from 'react';
import { Check, ChevronDown, Database, FileText, Globe, LoaderCircle, Plug, Plus, RefreshCw, Trash2, Upload, X, Zap } from 'lucide-react';
import { GithubMark } from './GithubMark';
import { guessTransport, refreshTools, type McpConnection, type McpTransport, type McpAuthHeader } from '../lib/mcp';
import { type ConnectorSettings } from '../lib/connectors';
import { MCP_PRESETS, MCP_PRESET_GROUPS, presetConnected, presetForm, type McpPreset, type McpPresetGroup } from '../lib/mcpServers';
import { IMAGE_MODELS, loadMediaConfigs, saveMediaConfigs, type MediaConfig } from '../lib/mediaTools';
import { useDismiss } from './useDismiss';
import type { Persona } from '../lib/roster';
import type { Knowledge } from '../lib/types';

// The Connectors hub. One menu, four kinds of external reach, each switchable on its own.
//
// Each connector is named for what it does — read a repository, read a URL, read your
// documents — and custom MCP is one of four, not the whole idea. Model keys are not
// connectors. They live in Settings. An MCP server is a tool the agent may call; a chat
// prompt is never sent to one.
//
// Pathways (skills) are deliberately not a tab here. They live on the Agents & Skills page
// with the roster. This drawer is only about connections to the outside world.

export type ConnectorTab = 'github' | 'web' | 'files' | 'mcp';

export interface ConnectorsProps {
  persona?: Persona; secrets?: string[];
  media?: MediaConfig[]; setMedia?: (list: MediaConfig[]) => void;
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
  { id: 'mcp', label: 'MCP & Tools', icon: Plug, blurb: 'External agent servers' },
];

const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };

export default function Connectors(p: ConnectorsProps) {
  const [url, setUrl] = useState(''); const [name, setName] = useState(''); const [token, setToken] = useState(''); const saveToken = false;
  const [transport, setTransport] = useState<McpTransport | 'auto'>('auto');
  const [authHeader, setAuthHeader] = useState<McpAuthHeader>('Authorization');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [localMedia, setLocalMedia] = useState(loadMediaConfigs);
  const media = p.media ?? localMedia;
  const writeMedia = (next: MediaConfig[]) => { try { saveMediaConfigs(next); setLocalMedia(next); p.setMedia?.(next); } catch (error) { p.notify(error instanceof Error ? error.message : 'Could not save media configuration.'); } };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preset, setPreset] = useState<McpPreset | null>(null);
  const [presetQuery, setPresetQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<McpPresetGroup | 'All'>('All');

  // The tool directory is the reason the drawer is open, so it always starts empty and unfiltered.
  // Clearing on mount also defeats a browser that autofills the search field on its own, which
  // otherwise hides every card behind a query the visitor never typed.
  useEffect(() => { setPresetQuery(''); setActiveGroup('All'); }, []);

  const urlError = (() => {
    const v = url.trim();
    if (!v) return '';
    // Looks like a provider/model slug (e.g. groq/llama-3.3-70b-versatile)
    if (/^[a-z0-9_-]+\/[a-z0-9._:-]+$/i.test(v) && !v.includes('://'))
      return 'That looks like a model name, not a server URL. Enter an https:// address, for example https://mcp.example.com/mcp.';
    try {
      const parsed = new URL(v);
      if (parsed.protocol !== (transport === 'websocket' ? 'wss:' : 'https:')) return transport === 'websocket' ? 'WebSocket connectors require wss://.' : 'Remote connectors require https://. Local file servers connect through an HTTPS MCP bridge.';
      if ([...parsed.searchParams.keys()].some(key => /token|api.?key|secret|password|authorization/i.test(key))) return 'Enter credentials in the token field, not URL query parameters.';
      if (parsed.username || parsed.password) return 'Enter credentials in the token field, not the URL.';
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
    try { parsed = new URL(url.trim()); if (urlError) throw new Error(); }
    catch { p.notify('Enter the server\'s https URL, for example https://mcp.example.com/mcp'); return; }
    const conn: McpConnection = { id: editingId ?? p.mcp.find(c => c.url === parsed.toString() && c.transport === (transport === 'auto' ? guessTransport(parsed.toString()) : transport))?.id ?? crypto.randomUUID(), name: name.trim() || parsed.host, url: parsed.toString(), transport: transport === 'auto' ? guessTransport(parsed.toString()) : transport, method, authHeader: transport === 'rest' || transport === 'websocket' ? 'Authorization' : authHeader, token: token.trim(), saveToken, enabled: true, tools: [] };
    setBusyId(conn.id); const checked = await check(conn); setBusyId(null);
    p.setMcp([checked, ...p.mcp.filter(c => c.id !== checked.id)]); setEditingId(null); setName(''); setUrl(''); setToken(''); setTransport('auto');
    p.notify(checked.error ? `Added ${checked.name}, but it did not answer: ${checked.error}` : `Connected ${checked.name}: ${checked.tools.length} tool${checked.tools.length === 1 ? '' : 's'} available to your agents.`);
  }
  async function refresh(conn: McpConnection) { setBusyId(conn.id); const checked = await check(conn); setBusyId(null); p.setMcp(p.mcp.map(c => c.id === conn.id ? checked : c)); }

  function configure(server: McpPreset) {
    setPreset(server); setEditingId(null); setToken('');
    const form = presetForm(server); setName(form.name); setUrl(form.url); setTransport(form.transport); setAuthHeader(form.authHeader);
    document.getElementById('mcp-config-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const mcpTools = p.mcp.filter(c => c.enabled).reduce((n, c) => n + c.tools.length, 0);
  const counts: Record<ConnectorTab, number> = { github: p.settings.github.enabled ? 1 : 0, web: p.settings.web.enabled ? 1 : 0, files: p.settings.knowledge.enabled ? p.knowledge.length : 0, mcp: mcpTools };


  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget) p.close(); }}>
    <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="connectors-title">
      <div className="drawer-head">
        <h2 id="connectors-title"><Plug size={15} strokeWidth={1.75} /> Connectors</h2>
        <button className="icon-button" aria-label="Close" onClick={p.close} autoFocus><X size={16} /></button>
      </div>
      <button className="button primary small" onClick={() => { p.setTab('mcp'); setTimeout(() => document.getElementById('mcp-config-form')?.scrollIntoView({ behavior: 'smooth' }), 0); }}><Plus size={13} />Add Connector</button>
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
          <h3><Zap size={14} /> Remote MCP servers & tool directory · {MCP_PRESETS.length} integrations</h3>
          <p className="help">Configure only the tools you need. Remote servers require their own authorization; local tools require your authenticated HTTPS bridge. Model inference keys belong in Settings.</p>
          <input aria-label="Search tool directory" type="search" autoComplete="off" placeholder="Search tools" value={presetQuery} onChange={e => setPresetQuery(e.target.value)} />
          <div className="tool-category-tabs" role="group" aria-label="Tool categories">{(['All', ...MCP_PRESET_GROUPS] as (McpPresetGroup | 'All')[]).map(group => <button key={group} className={activeGroup === group ? 'output-tab active' : 'output-tab'} aria-pressed={activeGroup === group} onClick={() => setActiveGroup(group)}>{group}</button>)}</div>
          <div className="preset-grid">{MCP_PRESETS.filter(server => (activeGroup === 'All' || server.group === activeGroup) && `${server.name} ${server.blurb}`.toLowerCase().includes(presetQuery.trim().toLowerCase())).map(server => {
            const configured = presetConnected(server, p.mcp);
            return <article key={server.id} className={preset?.id === server.id ? 'preset active' : 'preset'}>
              <div className="panel-head"><strong>{server.name}</strong>{configured && <span className="pill"><Check size={12} />Configured</span>}</div>
              <p className="help">{server.blurb}</p><small className="pill">{server.kind === 'bridge' ? 'Local / HTTPS bridge' : 'Remote MCP'}</small>
              <div className="row gap"><button className="button small" onClick={() => configure(server)}>Configure</button><a className="text-button" href={server.docs} target="_blank" rel="noopener noreferrer">Setup guide</a></div>
            </article>;
          })}</div>
        </section>
        <section className="panel media-tools">
          <h3>Optional creative / media tools</h3>
          <p className="help">Off by default, enabled with your own key, and independent of coding models. Keys stay in page memory; reload requires re-entry.</p>
          <div className="media-tool-list">
            {media.map(config => <details className="media-tool" id={`media-${config.provider}`} key={config.provider}>
              <summary>
                <span className="media-tool-name">{config.provider === 'heygen' ? 'HeyGen / Video Avatar Generator' : 'Nano Banana / Image Generation'}</span>
                <span className={config.enabled && config.key ? 'pill ok' : 'pill'}>{config.enabled && config.key ? 'Configured' : config.key ? 'Key set · off' : 'Off'}</span>
                <ChevronDown size={13} className="media-tool-caret" />
              </summary>
              <div className="media-tool-body">
                <label className="check"><input type="checkbox" checked={config.enabled} onChange={e => writeMedia(media.map(c => c.provider === config.provider ? { ...c, enabled: e.target.checked } : c))} />Enable optional tool</label>
                <label>Personal API key<input type="password" autoComplete="off" value={config.key} onChange={e => writeMedia(media.map(c => c.provider === config.provider ? { ...c, key: e.target.value } : c))} placeholder={config.provider === 'heygen' ? 'HeyGen API key' : 'Google Gemini image API key'} /></label>
                {config.provider === 'heygen'
                  ? <div className="form-grid"><label>Default Avatar ID<input value={config.avatarId} onChange={e => writeMedia(media.map(c => c.provider === config.provider ? { ...c, avatarId: e.target.value } : c))} /></label><label>Default Voice ID<input value={config.voiceId} onChange={e => writeMedia(media.map(c => c.provider === config.provider ? { ...c, voiceId: e.target.value } : c))} /></label></div>
                  : <label>Image tool model<select value={config.model} onChange={e => writeMedia(media.map(c => c.provider === config.provider ? { ...c, model: e.target.value } : c))}>{IMAGE_MODELS.map(model => <option key={model} value={model}>{model}</option>)}</select></label>}
              </div>
            </details>)}
          </div>
        </section>
        {p.mcp.map(connection => <section key={connection.id} className="panel mcp-row"><div className="panel-head"><div><strong>{connection.name}</strong><small className="mono"> {host(connection.url)} · {connection.transport}</small></div><label className="switch"><input type="checkbox" checked={connection.enabled} onChange={e => p.setMcp(p.mcp.map(c => c.id === connection.id ? { ...c, enabled: e.target.checked } : c))} />Enabled</label></div>{connection.error ? <p className="msg-error">{connection.error}</p> : <p className="help">{connection.tools.length} available tools · {connection.token ? 'Session credential active' : 'No session credential'}</p>}
          {connection.tools.length > 0 && <details><summary>Attached tool schemas</summary>{connection.tools.map(tool => <details key={tool.name}><summary>{tool.name}</summary><p>{tool.description}</p><pre className="skill-body">{JSON.stringify(tool.inputSchema ?? {}, null, 2)}</pre></details>)}</details>}
          <div className="row gap"><button className="button small" disabled={busyId !== null} onClick={() => void refresh(connection)}><RefreshCw size={13} />Refresh</button><button className="button small" onClick={() => { setEditingId(connection.id); setName(connection.name); setUrl(connection.url); setToken(connection.token); setTransport(connection.transport); setAuthHeader(connection.authHeader ?? 'Authorization'); setMethod(connection.method ?? 'GET'); setPreset(null); document.getElementById('mcp-config-form')?.scrollIntoView({ behavior: 'smooth' }); }}>Configure / update key</button><button className="button small danger" disabled={busyId === connection.id} onClick={() => p.setMcp(p.mcp.filter(c => c.id !== connection.id))}><Trash2 size={13} />Remove</button></div>
        </section>)}
        <section className="panel" id="mcp-config-form"><h3><Plus size={13} /> Add or Configure a Model Context Protocol server</h3>
          {preset?.setup && <p className="help">{preset.setup}</p>}
          <p className="help">Connection configuration persists in this browser. OAuth servers need an authorized access token or an authenticated bridge; follow their setup guide. The hosted app cannot spawn a local stdio server.</p>
          <div className="form-grid"><label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="Tool server name" /></label><label>Server endpoint<input value={url} onChange={e => setUrl(e.target.value)} placeholder={transport === 'websocket' ? 'wss://tools.example.com' : 'https://tools.example.com/mcp'} /></label><label>Transport<select value={transport} onChange={e => setTransport(e.target.value as McpTransport | 'auto')}><option value="auto">Auto-detect MCP</option><option value="http">MCP Streamable HTTP</option><option value="sse">MCP HTTP+SSE</option><option value="rest">Custom REST endpoint</option><option value="websocket">Custom WebSocket endpoint</option></select></label>{!['rest', 'websocket'].includes(transport) && <label>Credential header<select value={authHeader} onChange={e => setAuthHeader(e.target.value as McpAuthHeader)}><option value="Authorization">Authorization: Bearer</option><option value="x-api-key">x-api-key</option></select></label>}<label>{preset?.token ?? 'Credential (optional)'}<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>{transport === 'rest' && <label>HTTP method<select value={method} onChange={e => setMethod(e.target.value as 'GET' | 'POST')}><option value="GET">GET</option><option value="POST">POST (review before sending)</option></select></label>}</div>
          {urlError && <p className="msg-error" role="alert">{urlError}</p>}
          <div className="row gap"><button className="button primary small" disabled={!url.trim() || !!urlError || busyId !== null} onClick={() => void addMcp()}>{busyId ? <LoaderCircle size={13} className="spin" /> : <Plug size={13} />}{editingId ? 'Update and list tools' : 'Connect and list tools'}</button>{editingId && <button className="button small" onClick={() => { setEditingId(null); setName(''); setUrl(''); setToken(''); setPreset(null); }}>Cancel edit</button>}</div><p className="help">Credentials stay in page memory until reload. Tool calls run through isolated workers and appear in the Sandbox console.</p>
        </section>
      </>}


    </section>
  </div>;
}
