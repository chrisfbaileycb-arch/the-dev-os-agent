import { useMemo, useState } from 'react';
import { Check, Coins, ExternalLink, KeyRound, LoaderCircle, MonitorDown, Search, ShieldCheck, Sparkles, Trash2, Wallet } from 'lucide-react';
import { catalog, findModel, weightFor, type CatalogModel, type InferenceMode } from '../lib/catalog';
import { emptyKeyring, inferenceFor, loadKeyring, providers, saveKeyring, switchProvider, type Keyring, type Provider } from '../lib/providers';
import type { Balance, FreeTier, LedgerEntry } from '../lib/store';
import type { GatewayCatalog } from '../lib/deployment';
import type { Connection } from '../lib/types';
import { isInstalled, promptInstall } from '../pwa';
import { REFERRAL_ALLOWANCE, REFERRAL_BREADTH, REFERRAL_DISCLOSURE, referralEnabled, referralLink } from '../lib/referral';

// Settings and model hub.
//
// This page used to be a wall of model cards: two tiers, eighteen cards, each with a name, a
// provider, a credit weight and a sentence of prose. Six of those cards were free models, and on
// this deployment every one of them read "not funded here" — so the largest, most prominent block
// on the page was a list of things that did not work, and finding the five that did meant reading
// all eighteen. A card grid is the right shape for a handful of curated choices and the wrong one
// for a list the server decides and can hold forty entries.
//
// So the free tier is a dropdown, built from what this deployment actually funds, and it sits on
// its own with nothing else in it. Bringing your own key is a separate block below, which is where
// arbitrary model ids and provider keys belong. The two are never mixed, because they answer two
// different questions: "what can I use right now for nothing" and "what do I want to pay for".

export interface SettingsProps {
  connection: Connection; setConnection: (c: Connection) => void;
  models: string[]; checking: boolean; discover: () => void; save: () => void; forget: () => void;
  balance: Balance; freeBalance: Balance; free: FreeTier; gateway: string | null; gatewayCatalog: GatewayCatalog;
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

/** The vendor an id belongs to, for grouping a long list into readable sections. */
function family(id: string): string {
  const prefix = id.includes('/') ? id.slice(0, id.indexOf('/')) : 'other';
  return prefix.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

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

  /** The free list, grouped by vendor and labelled by the gateway. Nothing here is hardcoded. */
  const freeGroups = useMemo(() => {
    const labels = new Map(p.gatewayCatalog.models.map(m => [m.id, m.label]));
    const groups = new Map<string, { id: string; label: string }[]>();
    for (const id of p.free.models) {
      const key = family(id);
      const label = labels.get(id) ?? findModel(id)?.label ?? id;
      groups.set(key, [...(groups.get(key) ?? []), { id, label }]);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [p.free.models, p.gatewayCatalog.models]);

  /**
   * Model ids worth suggesting for a key-funded run: the compiled key-only catalog, plus whatever
   * the gateway serves beyond its free tier. Suggestions, not a catalogue — the field below still
   * accepts anything typed, because the visitor's provider decides what it serves, not this build.
   */
  const paidGateway = useMemo(() => p.gatewayCatalog.models.filter(m => !m.free), [p.gatewayCatalog.models]);

  const onFreeTier = inference === 'free';
  const freeSelection = onFreeTier && p.free.models.includes(c.model) ? c.model : '';

  /** Pick a free model. This block only ever funds through the free tier, so it says so outright. */
  function pickFree(id: string) {
    if (!id) return;
    const served = p.free.providers[id];
    const next = (served && Object.hasOwn(providers, served) ? served : 'xkiro') as Provider;
    p.setConnection({ ...switchProvider(c, next), mode: 'remote', model: id, inference: 'free' });
  }
  /** Pick a suggested key-funded model. The visitor's chosen payment mode is left alone. */
  function pickKeyed(id: string, forProvider: Provider) {
    if (!id) return;
    const base = forProvider === provider ? c : switchProvider(c, forProvider);
    p.setConnection({ ...base, mode: 'remote', model: id, inference: inferenceFor(id, base.inference === 'free' ? undefined : base.inference, p.free.models) });
  }
  function pickProvider(id: Provider) { if (id === provider) { set({ mode: 'remote' }); return; } p.setConnection({ ...switchProvider(c, id), mode: 'remote' }); }
  function pickInference(next: InferenceMode) {
    // Switching onto the free tier with a model it does not cover would send a request the server
    // refuses, so the first funded model comes along with the switch.
    if (next === 'free' && !p.free.models.includes(c.model)) { p.setConnection({ ...c, inference: 'free', model: p.free.models[0] ?? c.model }); return; }
    set({ inference: next });
  }
  const recent = p.ledger.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const meter = onFreeTier ? p.freeBalance : p.balance;

  return <div className="page">
    <div className="page-head"><div><h1>Settings and model hub</h1><p>Pick a model, decide how it is paid for, and keep your keys where you want them. Nothing here needs an account.</p></div></div>
    <div className="two-col wide">
      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h2>Free models</h2><label className="switch"><input type="checkbox" checked={c.mode === 'demo'} disabled={p.busy} onChange={e => set({ mode: e.target.checked ? 'demo' : 'remote' })} />Scripted preview (no AI, no network)</label></div>
          {p.free.enabled ? <>
            <div className="form-grid">
              <label className="grow">Model
                <select value={freeSelection} disabled={p.busy || c.mode === 'demo'} onChange={e => pickFree(e.target.value)}>
                  <option value="">Choose a free model…</option>
                  {freeGroups.map(([vendor, models]) => <optgroup key={vendor} label={vendor}>
                    {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </optgroup>)}
                </select>
              </label>
            </div>
            <p className="help">
              {p.free.models.length} model{p.free.models.length === 1 ? '' : 's'} this deployment funds from its own provider keys, at {p.free.monthlyCredits.toLocaleString()} credits a month and {p.free.perHour} requests an hour. Nothing to enter and no account: pick one and send.
              {p.gatewayCatalog.discovered && ` Read live from ${p.gatewayCatalog.url ?? 'the gateway'} — ${p.gatewayCatalog.free} of ${p.gatewayCatalog.count} models there are free — so this list is what the gateway serves today, not what was compiled into this build.`}
            </p>
            {onFreeTier && !freeSelection && <p className="help">Nothing selected yet. The dock uses <strong className="mono">{c.model || 'no model'}</strong>, which this deployment does not fund — choose one above.</p>}
          </> : <>
            <p className="help">No free models are available on this deployment right now. Bring your own key below and everything still works — Groq, OpenRouter and xKiro all have free accounts.</p>
            {p.gatewayCatalog.error && <p className="help">Discovery reported: <strong className="mono">{p.gatewayCatalog.error}</strong>. That is a server-side cause, not something to fix in this browser.</p>}
          </>}
        </section>

        <section className="panel">
          <h2>Bring your own model</h2>
          <p className="help">Type any model id your provider serves, pick one of the suggestions, or point at an OpenAI-compatible endpoint this deployment approves. Anything chosen here is paid for by your own key or by platform credits, never by the free tier.</p>
          <div className="form-grid">
            <label>Provider<select value={provider} disabled={p.busy || c.mode === 'demo'} onChange={e => pickProvider(e.target.value as Provider)}>{(Object.keys(providers) as Provider[]).map(id => <option key={id} value={id}>{providers[id].name}</option>)}</select></label>
            {provider === 'custom' && <label>API base URL<input type="url" disabled={p.busy || c.mode === 'demo'} value={c.endpoint} placeholder="https://your-inference.example/v1" onChange={e => set({ endpoint: e.target.value })} /></label>}
            <label className="grow">Model ID<span className="row"><input list="model-catalog" disabled={p.busy || c.mode === 'demo'} value={c.model} placeholder="Model served by your provider" onChange={e => set({ model: e.target.value, inference: inferenceFor(e.target.value, c.inference, p.free.models) })} /><datalist id="model-catalog">{p.models.map(m => <option key={m} value={m} />)}</datalist><button className="button small" disabled={p.busy || p.checking || c.mode === 'demo' || (provider === 'custom' && !c.endpoint)} onClick={p.discover}>{p.checking ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}Discover</button></span></label>
            <label className="grow">Suggestions
              <select value="" disabled={p.busy || c.mode === 'demo'} onChange={e => { const [id, forProvider] = e.target.value.split('\u0000'); pickKeyed(id, forProvider as Provider); }}>
                <option value="">Pick a known model…</option>
                <optgroup label="On your own key">
                  {catalog.map((m: CatalogModel) => <option key={m.id} value={`${m.id}\u0000${m.provider}`}>{m.label} · {providers[m.provider].name} · {m.weight} cr/1K</option>)}
                </optgroup>
                {paidGateway.length > 0 && <optgroup label={`xKiro gateway · ${paidGateway.length} paid models`}>
                  {paidGateway.map(m => <option key={m.id} value={`${m.id}\u0000xkiro`}>{m.label} · {m.tier}</option>)}
                </optgroup>}
              </select>
            </label>
            <label>Output limit<select disabled={p.busy} value={c.maxTokens} onChange={e => set({ maxTokens: Number(e.target.value) })}>{[512, 1024, 2048, 4096].map(n => <option key={n} value={n}>{n.toLocaleString()} tokens</option>)}</select></label>
          </div>
          {c.mode === 'remote' && c.model && !current && !p.free.models.includes(c.model) && <p className="help">Unlisted model: charged at {weightFor(c.model)} credits per 1K tokens on platform credits, judged from its name. Free-tier funding covers the models in the list above only.</p>}
          {provider === 'xkiro' && p.gateway && <p className="help">This deployment reaches xKiro at <strong className="mono">{p.gateway}</strong>. That is the resolved value of XKIRO_BASE_URL — if it is not the address you expect, the variable is the thing to correct, and a wrong-but-valid host shows up only as a failed connection.</p>}
          {provider === 'custom' && <p className="help">HTTPS only, and the origin must be listed in CUSTOM_API_ORIGINS on the server. A home PC running Ollama or LM Studio is reached through an administrator bridge, never through localhost on a hosted server.</p>}
        </section>

        <section className="panel">
          <h2>How inference is paid for</h2>
          <div className="mode-picker three">
            <button className={inference === 'free' ? 'mode selected' : 'mode'} disabled={p.busy || !p.free.enabled} aria-pressed={inference === 'free'} onClick={() => pickInference('free')}>
              <Sparkles size={16} strokeWidth={1.75} /><strong>Free tier</strong>
              <small>{p.free.enabled ? `No key at all. ${p.free.monthlyCredits.toLocaleString()} credits a month, ${p.free.perHour} requests an hour.` : 'Not available: this deployment funds no free models right now.'}</small>
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
          {inference === 'free' ? <p className="help">Nothing to enter. Requests route through this deployment's own provider keys, restricted to the free models listed above, and every request is metered on the server against the allowance shown to the right. This is a deliberate choice and it stays chosen: picking a model here will not move you off the free tier, and picking one in the section above will not move you onto it. When the allowance runs out, add your own key here and the same models keep working — free accounts at any of these providers are enough.</p>
            : inference === 'byok' ? <>
              <p className="help">One key per provider. The model you pick decides which one is used, so a key you already hold works straight away — you do not need an account at all of them. Choosing a model the deployment happens to fund no longer switches you back to the free tier; if that is what you want, say so with the Free tier button.</p>
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
                  Developer, or prefer your own direct API key?{' '}
                  <a {...referralLink()}>Get {REFERRAL_ALLOWANCE} on xKiro with our partner link</a>
                  {' — '}{REFERRAL_DISCLOSURE} Those are xKiro's figures for their own service ({REFERRAL_BREADTH}), worth checking on their site. Any Groq, OpenRouter, OpenAI, Anthropic or Google key works here just as well.
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
          <div className="panel-head"><h2>{onFreeTier ? 'Free allowance' : 'Credits'}</h2><span className="pill">{onFreeTier ? <Sparkles size={12} /> : <Coins size={12} />}{meter.remaining.toLocaleString()} of {meter.pool.toLocaleString()} left</span></div>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={meter.pool} aria-valuenow={meter.used} aria-label="Credits used this month"><span style={{ width: `${meter.pool ? Math.min(100, (meter.used / meter.pool) * 100) : 0}%` }} /></div>
          <p className="help">{meter.used.toLocaleString()} credits used in {meter.month}. {onFreeTier
            ? 'Free-tier usage is measured on the server from the tokens that actually streamed, at 0.5 credits per 1K, so this number is the deployment\'s own record rather than an estimate made here.'
            : `Balance ${p.serverReachable ? 'is stored on the server' : 'is computed in this browser; the server was not reachable'}. Weights: fast models 0.5, standard 3, reasoning 15 credits per 1K tokens.`} Requests on your own key are logged at zero.</p>
          {recent.length > 0 && <div className="ledger-wrap"><table className="ledger"><thead><tr><th>When</th><th>Model</th><th>Mode</th><th className="num">Tokens</th><th className="num">Credits</th></tr></thead><tbody>{recent.map(e => <tr key={e.id}><td>{new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td className="mono">{e.model}</td><td>{e.mode}</td><td className="num">{e.tokens.toLocaleString()}</td><td className="num">{e.credits.toLocaleString()}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="panel">
          <h2><ShieldCheck size={15} strokeWidth={1.75} /> Where things run</h2>
          <p className="help"><strong>In your tab:</strong> the interface, the agent team, keyword retrieval, and your notes.<br /><strong>On this server:</strong> the streaming proxy, the free-tier meter, gateway model discovery, the URL crawler, the GitHub and MCP connectors, the sandbox browser, and a copy of your sessions and ledger keyed by an anonymous workspace id.<br /><strong>On your provider:</strong> model inference. Provider usage may cost money on your own key.<br /><strong>Not included:</strong> shell access, code changes, logins on other sites, vector embeddings, model hosting.</p>
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
