import { useMemo, useState } from 'react';
import { Check, Coins, CreditCard, ExternalLink, KeyRound, LoaderCircle, MonitorDown, Search, ShieldCheck, Sparkles, Trash2, Wrench } from 'lucide-react';
import { findModel } from '../lib/catalog';
import type { Discovered } from '../lib/discovered';
import type { PaidTier } from '../lib/deployment';
import { providers, switchProvider, type Keyring, type Provider } from '../lib/providers';
import type { Balance, FreeTier, LedgerEntry } from '../lib/store';
import type { Connection } from '../lib/types';
import { isInstalled, promptInstall } from '../pwa';
import { cheaperInferenceDashboard } from '../lib/cheaperInference';

export interface SettingsProps {
  connection: Connection; setConnection: (c: Connection) => void;
  keys: Keyring; setKeys: (next: Keyring) => void; keyed: Set<Provider>;
  /** What each connected key reaches, read live from its provider; the same lists the dock shows. */
  discovered: Discovered; discovering: Set<Provider>; discover: (provider: Provider) => void; save: () => void; forget: () => void;
  balance: Balance; freeBalance: Balance; free: FreeTier; paid: PaidTier;
  /** Whether this deployment has an admin dashboard switched on, so the link to it can say so. */
  adminConfigured: boolean; openAdmin: () => void;
  ledger: LedgerEntry[]; busy: boolean; canInstall: boolean; serverReachable: boolean; requestClear: () => void;
}

/** Customer-configurable BYOK providers. Managed and future self-hosted routes stay out of this list. */
const BYOK_PROVIDERS: Provider[] = ['openrouter', 'openai', 'anthropic', 'google', 'groq', 'cohere', 'aihubmix', 'huggingface', 'xkiro'];
const KEY_HINTS: Partial<Record<Provider, string>> = {
  openrouter: 'Your OpenRouter key',
  openai: 'Your OpenAI key',
  anthropic: 'Your Anthropic key',
  google: 'Your Google AI Studio key',
  groq: 'Your Groq key',
  cohere: 'Your Cohere key',
  aihubmix: 'Your AIHubMix key',
  huggingface: 'Your Hugging Face token',
  xkiro: 'Your xKiro key',
};

export default function Settings(p: SettingsProps) {
  const c = p.connection;
  const provider: Provider = BYOK_PROVIDERS.includes(c.provider as Provider) ? c.provider as Provider : 'openrouter';
  const inference = c.inference === 'free' ? 'free' : c.inference === 'credits' ? 'credits' : 'byok';
  const hasToken = Boolean(c.serverAccessToken?.trim());
  const [manualModel, setManualModel] = useState(false);
  const set = (patch: Partial<Connection>) => p.setConnection({ ...c, ...patch, mode: 'remote' });

  function setKey(id: Provider, value: string) {
    p.setKeys({ ...p.keys, [id]: value });
    if (id === provider) set({ token: value });
  }
  function pickProvider(id: Provider) {
    const next = switchProvider(c, id);
    p.setConnection({ ...next, mode: 'remote', inference: 'byok' });
  }
  function pickModel(id: string) {
    if (id) set({ model: id, inference: 'byok' });
  }
  function pickInference(next: 'free' | 'byok' | 'credits') {
    if (next === 'free' && p.free.models.length && !p.free.models.includes(c.model)) {
      set({ inference: 'free', model: p.free.models[0] });
    } else if (next === 'credits' && p.paid.models.length && !p.paid.models.includes(c.model)) {
      set({ inference: 'credits', model: p.paid.models[0] });
    } else set({ inference: next });
  }

  const live = p.discovered[provider];
  const choices = useMemo(() => live?.models ?? [], [live]);
  const checking = p.discovering.has(provider);
  const selectedInChoices = choices.some(choice => choice.id === c.model);
  const recent = p.ledger.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const meter = inference === 'free' ? p.freeBalance : p.balance;
  const managed = inference === 'free';
  const plan = inference === 'credits';
  const planOffered = p.paid.enabled || hasToken;

  return <div className="page">
    <div className="page-head">
      <div>
        <h1>Settings</h1>
        <p>Choose how Orator reasons. Orator keeps the workflow, verification, and delivery experience consistent while handling the underlying intelligence safely.</p>
      </div>
    </div>

    <div className="two-col wide">
      <div className="stack">
        <section className="panel">
          <h2>How inference is paid for</h2>
          <div className={planOffered ? 'mode-picker three' : 'mode-picker two'}>
            <button className={managed ? 'mode selected' : 'mode'} disabled={p.busy || !p.free.enabled} aria-pressed={managed} onClick={() => pickInference('free')}>
              <Sparkles size={16} strokeWidth={1.75} /><strong>Free Tier</strong>
              <small>{p.free.enabled ? 'Built-in managed access is available.' : 'This deployment is not currently offering managed access.'}</small>
            </button>
            {planOffered && <button className={plan ? 'mode selected' : 'mode'} disabled={p.busy} aria-pressed={plan} onClick={() => pickInference('credits')}>
              <CreditCard size={16} strokeWidth={1.75} /><strong>Paid plan</strong>
              <small>{hasToken ? 'Your plan token is entered.' : 'Subscribers run the plan models on this deployment\u2019s keys.'}</small>
            </button>}
            <button className={!managed && !plan ? 'mode selected' : 'mode'} disabled={p.busy} aria-pressed={!managed && !plan} onClick={() => pickInference('byok')}>
              <KeyRound size={16} strokeWidth={1.75} /><strong>Bring Your Own Key</strong>
              <small>Use an approved provider account while Orator remains the experience.</small>
            </button>
          </div>

          {managed ? <div className="managed-confirm" role="status">
            <Sparkles size={20} strokeWidth={1.75} />
            <div><strong>You are using the built-in managed tier.</strong><p>All queries are handled automatically. Orator chooses an eligible route, applies its privacy and capability rules, validates the result, and continues safely if a route is unavailable.</p></div>
          </div> : plan ? <>
            <p className="help">A paid plan runs the models the operator listed for it on this deployment's own keys, metered against your plan allowance. The access token comes with your subscription; paste it here and the plan models unlock in the dropdown.</p>
            <div className="form-grid">
              <label className="grow">Plan access token<input type="password" autoComplete="off" spellCheck={false} disabled={p.busy} value={c.serverAccessToken ?? ''} placeholder="The token from your plan welcome message" onChange={e => set({ serverAccessToken: e.target.value })} /></label>
              <label className="grow">Plan model<select aria-label="Plan model" value={p.paid.models.includes(c.model) ? c.model : ''} disabled={p.busy || !p.paid.models.length} onChange={e => { if (e.target.value) set({ model: e.target.value, inference: 'credits' }); }}>
                {!p.paid.models.length && <option value="">No plan models are published yet</option>}
                {p.paid.models.length > 0 && !p.paid.models.includes(c.model) && <option value="">Choose a plan model</option>}
                {p.paid.models.map(id => <option key={id} value={id}>{p.paid.labels[id] ?? id}</option>)}
              </select></label>
            </div>
            <label className="check"><input type="checkbox" disabled={p.busy} checked={Boolean(c.saveKey)} onChange={e => set({ saveKey: e.target.checked })} />Remember this token in this browser</label>
          </> : <>
            <p className="help">Orator sends requests through its protected gateway. Select the provider you already use, enter its key, and choose a model from the provider's live catalog. Your key is used only for that provider and is never bundled into the app.</p>
            <div className="form-grid">
              <label>Provider<select value={provider} disabled={p.busy} onChange={e => pickProvider(e.target.value as Provider)}>{BYOK_PROVIDERS.map(id => <option key={id} value={id}>{providers[id].name}</option>)}</select></label>
              <label>API key<input type="password" autoComplete="off" spellCheck={false} disabled={p.busy} value={c.token || p.keys[provider] || ''} placeholder={KEY_HINTS[provider]} onChange={e => setKey(provider, e.target.value)} /></label>
              <label className="grow">Preferred model<span className="row">
                <select aria-label="Preferred model" value={selectedInChoices ? c.model : ''} disabled={p.busy || checking || choices.length === 0} onChange={e => pickModel(e.target.value)}>
                  {choices.length === 0 && <option value="">{checking ? 'Loading available models…' : c.token || p.keys[provider] ? 'Discover models from this provider' : 'Enter a key to list its models'}</option>}
                  {choices.length > 0 && !selectedInChoices && <option value="">{c.model ? `${c.model} (typed)` : `Choose one of ${choices.length.toLocaleString()} models`}</option>}
                  {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}{choice.free ? ' · free' : ''}</option>)}
                </select>
                <button className="button primary small" disabled={p.busy || checking || !(c.token || p.keys[provider])} onClick={() => p.discover(provider)}>{checking ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}{live ? 'Refresh' : 'Discover'}</button>
              </span></label>
            </div>
            {live && !live.error && <p className="help">{choices.length.toLocaleString()} models reachable on your {providers[provider].name} key, read {new Date(live.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. The same list is in the dropdown on the prompt bar.</p>}
            {live?.error && <p className="help">Could not read the live list: {live.error}. You can still type a model ID below.</p>}
            <button type="button" className="text-button" onClick={() => setManualModel(value => !value)}>{manualModel ? 'Hide manual model ID' : 'Can’t find your model? Enter its ID'}</button>
            {manualModel && <label>Model ID<input value={c.model} maxLength={200} placeholder="Provider model ID" onChange={e => pickModel(e.target.value)} /></label>}
            <label className="check"><input type="checkbox" disabled={p.busy} checked={Boolean(c.saveKey)} onChange={e => set({ saveKey: e.target.checked })} />Remember this key in this browser</label>
            <p className="help">Keys stay in this browser only when you choose Remember. They are not sent to third-party scripts, placed in the app bundle, or returned by the server.</p>
          </>}
          <div className="row gap"><button className="button primary small" disabled={p.busy} onClick={p.save}><Check size={13} />Save connection</button><button className="button small" disabled={p.busy} onClick={p.forget}><Trash2 size={13} />Forget saved keys</button></div>
        </section>

        <section className="panel">
          <h2><ShieldCheck size={15} strokeWidth={1.75} /> Orator routing</h2>
          <p className="help">Orator is provider-neutral. It selects routes by task capability, context, privacy, availability, entitlement, latency, and cost policy—not by a model's price label. Free, open-weight, economical, local, and premium models are evaluated on capability and acceptance criteria.</p>
          <p className="help">The initial managed route is Cheaper Inference. OpenRouter, direct providers, and Hugging Face remain supported fallbacks when your policy and configuration allow them. Self-hosted OmniRoute is an optional future adapter and is not required for this app.</p>
          <a className="button small" href={cheaperInferenceDashboard} target="_blank" rel="noreferrer"><ExternalLink size={13} />Managed inference dashboard</a>
        </section>
      </div>

      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h2>{managed ? 'Managed allowance' : 'Credits'}</h2><span className="pill">{managed ? <Sparkles size={12} /> : <Coins size={12} />}{meter.remaining.toLocaleString()} of {meter.pool.toLocaleString()} left</span></div>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={meter.pool} aria-valuenow={meter.used} aria-label="Credits used this month"><span style={{ width: `${meter.pool ? Math.min(100, (meter.used / meter.pool) * 100) : 0}%` }} /></div>
          <p className="help">{meter.used.toLocaleString()} credits used in {meter.month}. {managed ? 'Managed usage is measured server-side from actual streamed usage.' : 'Requests on your own key do not draw Orator credits.'}</p>
          {recent.length > 0 && <div className="ledger-wrap"><table className="ledger"><thead><tr><th>When</th><th>Model</th><th>Mode</th><th className="num">Tokens</th><th className="num">Credits</th></tr></thead><tbody>{recent.map(entry => <tr key={entry.id}><td>{new Date(entry.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td className="mono">{entry.model}</td><td>{entry.mode}</td><td className="num">{entry.tokens.toLocaleString()}</td><td className="num">{entry.credits.toLocaleString()}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="panel">
          <h2><ShieldCheck size={15} strokeWidth={1.75} /> Privacy and execution</h2>
          <p className="help"><strong>In your browser:</strong> the Orator interface, agent identity, workspace notes, and workflow coordination.<br /><strong>On this server:</strong> policy enforcement, protected streaming transport, provider health, usage accounting, and workspace synchronization.<br /><strong>With an approved inference service:</strong> only the minimum authorized project context needed for the current task.</p>
        </section>

        <section className="panel">
          <h2><MonitorDown size={15} strokeWidth={1.75} /> Install on this device</h2>
          <p className="help">Install Orator on Chrome, Windows, Mac, Linux, or a Chromebook. The same customer experience works across devices; hosted reasoning needs a connection.</p>
          {isInstalled() ? <p className="help">Installed. You are using the app window now.</p> : p.canInstall ? <button className="button small" onClick={() => void promptInstall()}><MonitorDown size={13} />Install app</button> : <p className="help">Your browser has not offered to install yet. Use the browser's Install option when it appears.</p>}
        </section>

        <section className="panel">
          <h2><Wrench size={15} strokeWidth={1.75} /> Running this deployment?</h2>
          <p className="help">The admin dashboard is where the operator enters provider keys on the server, decides which models are free and which are on the paid plan, and sets the free-tier limits — no redeploy needed. {p.adminConfigured ? 'It is switched on for this deployment.' : 'It opens once ADMIN_TOKEN is set in the hosting environment.'}</p>
          <button className="button small" onClick={p.openAdmin}><ShieldCheck size={13} />Open the admin dashboard</button>
        </section>

        <section className="panel danger">
          <h2>Clear workspace</h2>
          <p className="help">Deletes sessions, runs, usage records, notes, connectors, custom agents, and saved connection details from this browser and the server copy.</p>
          <button className="button danger small" disabled={p.busy} onClick={p.requestClear}><Trash2 size={13} />Clear everything</button>
        </section>
      </div>
    </div>
  </div>;
}
