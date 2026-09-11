import { useState } from 'react';
import { Check, Coins, ExternalLink, KeyRound, LoaderCircle, MonitorDown, Search, ShieldCheck, Sparkles, Trash2, Wallet } from 'lucide-react';
import { catalog, findModel, weightFor, type CatalogModel, type InferenceMode, type Tier } from '../lib/catalog';
import { emptyKeyring, inferenceFor, loadKeyring, providers, saveKeyring, switchProvider, type Keyring, type Provider } from '../lib/providers';
import type { Balance, FreeTier, LedgerEntry } from '../lib/store';
import type { Connection } from '../lib/types';
import { isInstalled, promptInstall } from '../pwa';
import { REFERRAL_ALLOWANCE, REFERRAL_BREADTH, REFERRAL_DISCLOSURE, referralEnabled, referralLink } from '../lib/referral';

export interface SettingsProps {
  connection: Connection; setConnection: (c: Connection) => void;
  models: string[]; checking: boolean; discover: () => void; save: () => void; forget: () => void;
  balance: Balance; freeBalance: Balance; free: FreeTier;
  ledger: LedgerEntry[]; busy: boolean; canInstall: boolean; serverReachable: boolean; requestClear: () => void;
}

/**
 * The providers that get their own key field, in the order they are offered.
 *
 * `custom` is left out: it is not an account you hold a key for, it is an endpoint you point at,
 * and it is configured with its base URL in the model hub above.
 */
const KEYED: Provider[] = ['openai', 'anthropic', 'google', 'xkiro', 'openrouter', 'groq', 'cohere'];
const KEY_HINTS: Partial<Record<Provider, string>> = {
  openai: 'sk-… from platform.openai.com',
  anthropic: 'sk-ant-… from console.anthropic.com',
  google: 'From Google AI Studio',
  xkiro: 'From your xKiro dashboard',
  openrouter: 'sk-or-… from openrouter.ai',
  groq: 'gsk_… from console.groq.com',
  cohere: 'From dashboard.cohere.com',
};

const tiers: { id: Tier; title: string; blurb: string }[] = [
  { id: 'free', title: 'Free and instant', blurb: 'No key, no account. This deployment funds these from its own provider keys, metered against a monthly free allowance.' },
  { id: 'pro', title: 'Pro and reasoning', blurb: 'Deliberate models for hard problems. Your own key bills your provider; platform credits draw three to fifteen credits per 1K tokens.' },
];

export default function Settings(p: SettingsProps) {
  const c = p.connection;
  const provider: Provider = c.provider ?? 'custom';
  const current = findModel(c.model);
  const inference: InferenceMode = c.inference ?? 'byok';
  const set = (patch: Partial<Connection>) => p.setConnection({ ...c, ...patch });
  const [keys, setKeys] = useState<Keyring>(loadKeyring);

  /**
   * A key belongs to a provider, not to the session, so all of them are editable at once and
   * whichever one the chosen model needs is the one that gets sent. The active provider's field
   * is the connection's own token, so typing there takes effect on the next message rather than
   * waiting for a save.
   */
  function setKey(id: Provider, value: string) {
    setKeys(k => ({ ...k, [id]: value }));
    if (id === provider) set({ token: value });
  }
  /**
   * Save. The remember checkbox governs every key, not just the active one — a single honest
   * switch beats a per-field ambiguity about which of them localStorage ends up holding. Unticked
   * means nothing is written and anything previously stored is cleared; the keys stay usable in
   * this tab until it closes.
   */
  function saveAll() {
    saveKeyring(c.saveKey ? keys : emptyKeyring());
    p.save();
  }
  function forgetAll() { setKeys(emptyKeyring()); p.forget(); }
  const funded = (m: CatalogModel) => Boolean(m.zeroConfig && p.free.enabled && p.free.models.includes(m.id));

  function pick(m: CatalogModel) {
    const base = m.provider === provider ? c : switchProvider(c, m.provider);
    p.setConnection({ ...base, mode: 'remote', model: m.id, inference: inferenceFor(m.id, base.inference, p.free.models) });
  }
  function pickProvider(id: Provider) { if (id === provider) { set({ mode: 'remote' }); return; } p.setConnection({ ...switchProvider(c, id), mode: 'remote' }); }
  function pickInference(next: InferenceMode) {
    // Leaving the free tier on a free-only model would send a request the server will not fund.
    if (next !== 'free' && current?.zeroConfig) { p.setConnection({ ...c, inference: next, model: c.model }); return; }
    set({ inference: next });
  }
  const recent = p.ledger.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const meter = inference === 'free' ? p.freeBalance : p.balance;

  return <div className="page">
    <div className="page-head"><div><h1>Settings and model hub</h1><p>Pick a model, decide how it is paid for, and keep your keys where you want them. Nothing here needs an account.</p></div></div>
    <div className="two-col wide">
      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h2>Model hub</h2><label className="switch"><input type="checkbox" checked={c.mode === 'demo'} disabled={p.busy} onChange={e => set({ mode: e.target.checked ? 'demo' : 'remote' })} />Scripted preview (no AI, no network)</label></div>
          {tiers.map(t => <div key={t.id} className="tier">
            <h3>{t.title}<small>{t.blurb}</small></h3>
            <div className="model-grid">{catalog.filter(m => m.tier === t.id).map(m => <button key={m.id} className={c.mode === 'remote' && current?.id === m.id ? 'model-card active' : 'model-card'} disabled={p.busy} onClick={() => pick(m)} aria-pressed={current?.id === m.id}>
              <strong>{m.label}{current?.id === m.id && c.mode === 'remote' && <Check size={12} />}</strong>
              <small>{providers[m.provider].name} · {m.zeroConfig ? (funded(m) ? 'free here' : 'not funded here') : `${m.weight} cr/1K`}</small>
              <span>{m.note}</span>
            </button>)}</div>
          </div>)}
          <div className="tier"><h3>Any model, any endpoint<small>Type a model ID your provider serves, or point at an OpenAI-compatible endpoint approved by this deployment.</small></h3>
            <div className="form-grid">
              <label>Provider<select value={provider} disabled={p.busy || c.mode === 'demo'} onChange={e => pickProvider(e.target.value as Provider)}>{(Object.keys(providers) as Provider[]).map(id => <option key={id} value={id}>{providers[id].name}</option>)}</select></label>
              {provider === 'custom' && <label>API base URL<input type="url" disabled={p.busy || c.mode === 'demo'} value={c.endpoint} placeholder="https://your-inference.example/v1" onChange={e => set({ endpoint: e.target.value })} /></label>}
              <label className="grow">Model ID<span className="row"><input list="model-catalog" disabled={p.busy || c.mode === 'demo'} value={c.model} placeholder="Model served by your provider" onChange={e => set({ model: e.target.value, inference: inferenceFor(e.target.value, c.inference, p.free.models) })} /><datalist id="model-catalog">{p.models.map(m => <option key={m} value={m} />)}</datalist><button className="button small" disabled={p.busy || p.checking || c.mode === 'demo' || (provider === 'custom' && !c.endpoint)} onClick={p.discover}>{p.checking ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}Discover</button></span></label>
              <label>Output limit<select disabled={p.busy} value={c.maxTokens} onChange={e => set({ maxTokens: Number(e.target.value) })}>{[512, 1024, 2048, 4096].map(n => <option key={n} value={n}>{n.toLocaleString()} tokens</option>)}</select></label>
            </div>
            {c.mode === 'remote' && c.model && !current && <p className="help">Unlisted model: charged at {weightFor(c.model)} credits per 1K tokens on platform credits, judged from its name. Free-tier funding covers listed models only.</p>}
            {provider === 'custom' && <p className="help">HTTPS only, and the origin must be listed in CUSTOM_API_ORIGINS on the server. A home PC running Ollama or LM Studio is reached through an administrator bridge, never through localhost on a hosted server.</p>}
          </div>
        </section>

        <section className="panel">
          <h2>How inference is paid for</h2>
          <div className="mode-picker three">
            <button className={inference === 'free' ? 'mode selected' : 'mode'} disabled={p.busy || !p.free.enabled} aria-pressed={inference === 'free'} onClick={() => pickInference('free')}>
              <Sparkles size={16} strokeWidth={1.75} /><strong>Free tier</strong>
              <small>{p.free.enabled ? `No key at all. ${p.free.monthlyCredits.toLocaleString()} credits a month, ${p.free.perHour} requests an hour.` : 'Not available: this deployment has no server provider keys.'}</small>
            </button>
            <button className={inference === 'byok' ? 'mode selected' : 'mode'} disabled={p.busy} aria-pressed={inference === 'byok'} onClick={() => pickInference('byok')}>
              <KeyRound size={16} strokeWidth={1.75} /><strong>Bring your own key</strong>
              <small>Your provider bills you directly. No credits are ever drawn.</small>
            </button>
            <button className={inference === 'credits' ? 'mode selected' : 'mode'} disabled={p.busy} aria-pressed={inference === 'credits'} onClick={() => pickInference('credits')}>
              <Wallet size={16} strokeWidth={1.75} /><strong>Platform credits</strong>
              <small>This deployment's full model pool, unlocked by an administrator token.</small>
            </button>
          </div>
          {inference === 'free' ? <p className="help">Nothing to enter. Requests route through this deployment's own Groq and OpenRouter keys, restricted to the free models above, and every request is metered on the server against the allowance shown to the right. When the allowance runs out, add your own key here and the same models keep working — free accounts at either provider are enough.</p>
            : inference === 'byok' ? <>
              <p className="help">One key per provider. The model you pick decides which one is used, so a key you already hold works straight away — you do not need an account at all of them.</p>
              <div className="key-grid">
                {KEYED.map(id => <label key={id} className={id === provider ? 'key-field active' : 'key-field'}>
                  <span>{providers[id].name}{id === provider && <em>in use</em>}</span>
                  <input type="password" autoComplete="off" spellCheck={false} disabled={p.busy} value={id === provider ? c.token : keys[id]} placeholder={KEY_HINTS[id] ?? 'Your provider key'} onChange={e => setKey(id, e.target.value)} />
                </label>)}
              </div>
              <label className="check"><input type="checkbox" disabled={p.busy} checked={Boolean(c.saveKey)} onChange={e => set({ saveKey: e.target.checked })} />Remember these keys in this browser</label>
              <p className="help">Every request runs through this deployment's proxy so the key never has to leave your tab for a third-party script to see — it is attached to the outbound call and never written to the server's disk or logs. Remembered keys live in this browser's localStorage, unencrypted and readable by any script on this origin, so use a restricted key on a device you trust. Leave the box unticked and they last only until you close the tab.</p>
              {referralEnabled() && <p className="help referral-note">
                <ExternalLink size={12} strokeWidth={1.75} />
                <span>
                  Don't want several subscriptions? <a {...referralLink()}>Get {REFERRAL_BREADTH} with {REFERRAL_ALLOWANCE} via xKiro</a>
                  {' — '}{REFERRAL_DISCLOSURE} Those are xKiro's figures for their own service, worth checking on their site. A Groq or OpenRouter key works here just as well.
                </span>
              </p>}
            </> : <>
              <label>Deployment access token<input type="password" autoComplete="off" spellCheck={false} disabled={p.busy} value={c.serverAccessToken ?? ''} placeholder="Given to you by the administrator" onChange={e => set({ serverAccessToken: e.target.value })} /></label>
              <p className="help">Platform credits route through the deployment's own provider keys and need this token. It stays in memory for the session. Each request draws credits from the monthly allowance shown to the right; your own key is not used.</p>
            </>}
          <div className="row gap"><button className="button primary small" disabled={p.busy} onClick={saveAll}><Check size={13} />Save connection</button><button className="button small" disabled={p.busy} onClick={forgetAll}><Trash2 size={13} />Forget saved keys</button></div>
        </section>
      </div>

      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h2>{inference === 'free' ? 'Free allowance' : 'Credits'}</h2><span className="pill">{inference === 'free' ? <Sparkles size={12} /> : <Coins size={12} />}{meter.remaining.toLocaleString()} of {meter.pool.toLocaleString()} left</span></div>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={meter.pool} aria-valuenow={meter.used} aria-label="Credits used this month"><span style={{ width: `${meter.pool ? Math.min(100, (meter.used / meter.pool) * 100) : 0}%` }} /></div>
          <p className="help">{meter.used.toLocaleString()} credits used in {meter.month}. {inference === 'free'
            ? 'Free-tier usage is measured on the server from the tokens that actually streamed, at 0.5 credits per 1K, so this number is the deployment\'s own record rather than an estimate made here.'
            : `Balance ${p.serverReachable ? 'is stored on the server' : 'is computed in this browser; the server was not reachable'}. Weights: fast models 0.5, standard 3, reasoning 15 credits per 1K tokens.`} Requests on your own key are logged at zero.</p>
          {recent.length > 0 && <div className="ledger-wrap"><table className="ledger"><thead><tr><th>When</th><th>Model</th><th>Mode</th><th className="num">Tokens</th><th className="num">Credits</th></tr></thead><tbody>{recent.map(e => <tr key={e.id}><td>{new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td className="mono">{e.model}</td><td>{e.mode}</td><td className="num">{e.tokens.toLocaleString()}</td><td className="num">{e.credits.toLocaleString()}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="panel">
          <h2><ShieldCheck size={15} strokeWidth={1.75} /> Where things run</h2>
          <p className="help"><strong>In your tab:</strong> the interface, the agent team, keyword retrieval, and your notes.<br /><strong>On this server:</strong> the streaming proxy, the free-tier meter, the URL crawler, the GitHub and MCP connectors, the sandbox browser, and a copy of your sessions and ledger keyed by an anonymous workspace id.<br /><strong>On your provider:</strong> model inference. Provider usage may cost money on your own key.<br /><strong>Not included:</strong> shell access, code changes, logins on other sites, vector embeddings, model hosting.</p>
        </section>

        <section className="panel">
          <h2><MonitorDown size={15} strokeWidth={1.75} /> Install on this device</h2>
          <p className="help">On a Chromebook, or in Chrome on Windows, Mac, or Linux, Hey Buddy can live on your shelf or dock and open in its own window. Installed, it opens offline and the scripted preview keeps working; hosted runs need a connection.</p>
          {isInstalled() ? <p className="help">Installed. You are using the app window now.</p> : p.canInstall ? <button className="button small" onClick={() => void promptInstall()}><MonitorDown size={13} />Install app</button> : <p className="help">Your browser has not offered to install yet. In Chrome, use the install icon at the right end of the address bar, or choose Install from the browser menu.</p>}
        </section>

        <section className="panel danger">
          <h2>Clear workspace</h2>
          <p className="help">Deletes sessions, runs, the ledger, notes, connectors, and saved connection details from this browser and from the server copy.</p>
          <button className="button danger small" disabled={p.busy} onClick={p.requestClear}><Trash2 size={13} />Clear everything</button>
        </section>
      </div>
    </div>
  </div>;
}
