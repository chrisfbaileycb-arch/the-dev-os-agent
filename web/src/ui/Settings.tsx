import { Check, Coins, KeyRound, LoaderCircle, MonitorDown, Search, ShieldCheck, Trash2, Wallet } from 'lucide-react';
import { catalog, findModel, weightFor, type CatalogModel, type Tier } from '../lib/catalog';
import { providers, switchProvider, type Provider } from '../lib/providers';
import type { Balance, LedgerEntry } from '../lib/store';
import type { Connection } from '../lib/types';
import { isInstalled, promptInstall } from '../pwa';
export interface SettingsProps { connection: Connection; setConnection: (c: Connection) => void; models: string[]; checking: boolean; discover: () => void; save: () => void; forget: () => void; balance: Balance; ledger: LedgerEntry[]; busy: boolean; canInstall: boolean; serverReachable: boolean; requestClear: () => void; }
const tiers: { id: Tier; title: string; blurb: string }[] = [
  { id: 'free', title: 'Free and instant', blurb: 'Fast models on the providers\' free allowances. Half a credit per 1K tokens on platform credits; nothing with your own key.' },
  { id: 'pro', title: 'Pro and reasoning', blurb: 'Deliberate models for hard problems. Three to fifteen credits per 1K tokens on platform credits; nothing with your own key.' },
];
export default function Settings(p: SettingsProps) {
  const c = p.connection; const provider: Provider = c.provider ?? 'custom'; const current = findModel(c.model);
  const set = (patch: Partial<Connection>) => p.setConnection({ ...c, ...patch });
  function pick(m: CatalogModel) { const base = m.provider === provider ? c : switchProvider(c, m.provider); p.setConnection({ ...base, mode: 'remote', model: m.id }); }
  function pickProvider(id: Provider) { if (id === provider) { set({ mode: 'remote' }); return; } p.setConnection({ ...switchProvider(c, id), mode: 'remote' }); }
  const recent = p.ledger.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  return <div className="page">
    <div className="page-head"><div><h1>Settings and model hub</h1><p>Pick a model, decide how it is paid for, and keep your keys where you want them. Nothing here needs an account.</p></div></div>
    <div className="two-col wide">
      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h2>Model hub</h2><label className="switch"><input type="checkbox" checked={c.mode === 'demo'} disabled={p.busy} onChange={e => set({ mode: e.target.checked ? 'demo' : 'remote' })} />Scripted preview (no AI, no network)</label></div>
          {tiers.map(t => <div key={t.id} className="tier"><h3>{t.title}<small>{t.blurb}</small></h3><div className="model-grid">{catalog.filter(m => m.tier === t.id).map(m => <button key={m.id} className={c.mode === 'remote' && current?.id === m.id ? 'model-card active' : 'model-card'} disabled={p.busy} onClick={() => pick(m)} aria-pressed={current?.id === m.id}><strong>{m.label}{current?.id === m.id && c.mode === 'remote' && <Check size={12} />}</strong><small>{providers[m.provider].name} · {m.weight} cr/1K</small><span>{m.note}</span></button>)}</div></div>)}
          <div className="tier"><h3>Any model, any endpoint<small>Type a model ID your provider serves, or point at an OpenAI-compatible endpoint approved by this deployment.</small></h3>
            <div className="form-grid">
              <label>Provider<select value={provider} disabled={p.busy || c.mode === 'demo'} onChange={e => pickProvider(e.target.value as Provider)}>{(Object.keys(providers) as Provider[]).map(id => <option key={id} value={id}>{providers[id].name}</option>)}</select></label>
              {provider === 'custom' && <label>API base URL<input type="url" disabled={p.busy || c.mode === 'demo'} value={c.endpoint} placeholder="https://your-inference.example/v1" onChange={e => set({ endpoint: e.target.value })} /></label>}
              <label className="grow">Model ID<span className="row"><input list="model-catalog" disabled={p.busy || c.mode === 'demo'} value={c.model} placeholder="Model served by your provider" onChange={e => set({ model: e.target.value })} /><datalist id="model-catalog">{p.models.map(m => <option key={m} value={m} />)}</datalist><button className="button small" disabled={p.busy || p.checking || c.mode === 'demo' || (provider === 'custom' && !c.endpoint)} onClick={p.discover}>{p.checking ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}Discover</button></span></label>
              <label>Output limit<select disabled={p.busy} value={c.maxTokens} onChange={e => set({ maxTokens: Number(e.target.value) })}>{[512, 1024, 2048, 4096].map(n => <option key={n} value={n}>{n.toLocaleString()} tokens</option>)}</select></label>
            </div>
            {c.mode === 'remote' && c.model && !current && <p className="help">Unlisted model: charged at {weightFor(c.model)} credits per 1K tokens on platform credits, judged from its name.</p>}
            {provider === 'custom' && <p className="help">HTTPS only, and the origin must be listed in CUSTOM_API_ORIGINS on the server. A home PC running Ollama or LM Studio is reached through an administrator bridge, never through localhost on a hosted server.</p>}
          </div>
        </section>
        <section className="panel">
          <h2>How inference is paid for</h2>
          <div className="mode-picker">
            <button className={c.inference !== 'credits' ? 'mode selected' : 'mode'} disabled={p.busy} aria-pressed={c.inference !== 'credits'} onClick={() => set({ inference: 'byok' })}><KeyRound size={16} strokeWidth={1.75} /><strong>Bring your own key</strong><small>Your provider bills you directly. No credits are ever drawn.</small></button>
            <button className={c.inference === 'credits' ? 'mode selected' : 'mode'} disabled={p.busy} aria-pressed={c.inference === 'credits'} onClick={() => set({ inference: 'credits' })}><Wallet size={16} strokeWidth={1.75} /><strong>Platform credits</strong><small>This deployment's model pool, metered by model weight from a monthly allowance.</small></button>
          </div>
          {c.inference !== 'credits' ? <>
            <label>{providers[provider].name} API key<input type="password" autoComplete="off" spellCheck={false} disabled={p.busy} value={c.token} placeholder="Your provider key" onChange={e => set({ token: e.target.value })} /></label>
            <label className="check"><input type="checkbox" disabled={p.busy} checked={Boolean(c.saveKey)} onChange={e => set({ saveKey: e.target.checked })} />Remember this key in this browser</label>
            <p className="help">Saved keys live in localStorage, unencrypted, readable by any script on this origin. Use a restricted key on a device you trust. Keys are never exported and never stored on the server.</p>
          </> : <>
            <label>Deployment access token<input type="password" autoComplete="off" spellCheck={false} disabled={p.busy} value={c.serverAccessToken ?? ''} placeholder="Given to you by the administrator" onChange={e => set({ serverAccessToken: e.target.value })} /></label>
            <p className="help">Platform credits route through the deployment's own provider keys and need this token. It stays in memory for the session. Each request draws credits from the monthly allowance shown below; your own key is not used.</p>
          </>}
          <div className="row gap"><button className="button primary small" disabled={p.busy} onClick={p.save}><Check size={13} />Save connection</button><button className="button small" disabled={p.busy} onClick={p.forget}><Trash2 size={13} />Forget saved keys</button></div>
        </section>
      </div>
      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h2>Credits</h2><span className="pill"><Coins size={12} />{p.balance.remaining.toLocaleString()} of {p.balance.pool.toLocaleString()} left</span></div>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={p.balance.pool} aria-valuenow={p.balance.used} aria-label="Credits used this month"><span style={{ width: `${p.balance.pool ? Math.min(100, (p.balance.used / p.balance.pool) * 100) : 0}%` }} /></div>
          <p className="help">{p.balance.used.toLocaleString()} credits used in {p.balance.month}. Balance {p.serverReachable ? 'is stored on the server' : 'is computed in this browser; the server was not reachable'}. Weights: fast models 0.5, standard 3, reasoning 15 credits per 1K tokens. BYOK requests are logged at zero.</p>
          {recent.length > 0 && <div className="ledger-wrap"><table className="ledger"><thead><tr><th>When</th><th>Model</th><th>Mode</th><th className="num">Tokens</th><th className="num">Credits</th></tr></thead><tbody>{recent.map(e => <tr key={e.id}><td>{new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td className="mono">{e.model}</td><td>{e.mode}</td><td className="num">{e.tokens.toLocaleString()}</td><td className="num">{e.credits.toLocaleString()}</td></tr>)}</tbody></table></div>}
        </section>
        <section className="panel">
          <h2><ShieldCheck size={15} strokeWidth={1.75} /> Where things run</h2>
          <p className="help"><strong>In your tab:</strong> the interface, the agent team, keyword retrieval, and your notes.<br /><strong>On this server:</strong> the streaming proxy, the sandbox browser, and a copy of your sessions and ledger keyed by an anonymous workspace id.<br /><strong>On your provider:</strong> model inference. Provider usage may cost money.<br /><strong>Not included:</strong> shell access, code changes, logins on other sites, vector embeddings, model hosting.</p>
        </section>
        <section className="panel">
          <h2><MonitorDown size={15} strokeWidth={1.75} /> Install on this device</h2>
          <p className="help">On a Chromebook, or in Chrome on Windows, Mac, or Linux, Hey Buddy can live on your shelf or dock and open in its own window. Installed, it opens offline and the scripted preview keeps working; hosted runs need a connection.</p>
          {isInstalled() ? <p className="help">Installed. You are using the app window now.</p> : p.canInstall ? <button className="button small" onClick={() => void promptInstall()}><MonitorDown size={13} />Install app</button> : <p className="help">Your browser has not offered to install yet. In Chrome, use the install icon at the right end of the address bar, or choose Install from the browser menu.</p>}
        </section>
        <section className="panel danger">
          <h2>Clear workspace</h2>
          <p className="help">Deletes sessions, runs, the ledger, notes, and saved connection details from this browser and from the server copy.</p>
          <button className="button danger small" disabled={p.busy} onClick={p.requestClear}><Trash2 size={13} />Clear everything</button>
        </section>
      </div>
    </div>
  </div>;
}
