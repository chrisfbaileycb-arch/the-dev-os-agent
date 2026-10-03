import { useMemo, useState } from 'react';
import { Check, Coins, CreditCard, ExternalLink, HardDrive, KeyRound, LoaderCircle, MonitorDown, Palette, Search, ShieldCheck, Sparkles, Trash2, Wrench } from 'lucide-react';
import { findModel } from '../lib/catalog';
import type { Discovered } from '../lib/discovered';
import type { PaidTier } from '../lib/deployment';
import { flagshipFor, providers, switchProvider, modelOutputCeiling, effectiveOutputLimit, type Keyring, type Provider, DEFAULT_OUTPUT_TOKENS, OUTPUT_LIMITS } from '../lib/providers';
import { rankChoices, type ModelChoice } from '../lib/modelChoices';
import { localEndpointError, normalizeLocalEndpoint, type PipeSettings } from '../lib/pipes';
import { FREE_KEY_OPTIONS } from '../lib/freeKeys';
import type { Balance, FreeTier, LedgerEntry, PlanReading } from '../lib/store';
import type { Connection } from '../lib/types';
import { isInstalled, promptInstall } from '../pwa';
import ThemePicker from './ThemePicker';
import type { ThemeChoice } from '../lib/theme';

export interface SettingsProps {
  connection: Connection; setConnection: (c: Connection) => void;
  keys: Keyring; setKeys: (next: Keyring) => void; keyed: Set<Provider>;
  /** What each connected key reaches, read live from its provider; the same lists the dock shows. */
  discovered: Discovered; discovering: Set<Provider>; discover: (provider: Provider) => void; save: () => void; forget: () => void;
  subscription?: PlanReading | null; planChecking?: boolean; planError?: string;
  balance: Balance; freeBalance: Balance; free: FreeTier; paid: PaidTier;
  /** Whether this deployment has an admin dashboard switched on, so the link to it can say so. */
  adminConfigured: boolean; openAdmin: () => void;
  ledger: LedgerEntry[]; busy: boolean; canInstall: boolean; serverReachable: boolean; requestClear: () => void;
  /** The visitor's colour palette, and the one place it changes (see lib/theme.ts). */
  theme: ThemeChoice; setTheme: (choice: ThemeChoice) => void;
  /** The local-model switch and address (lib/pipes.ts), which the Local model box below edits. */
  pipes: PipeSettings; setPipes: (next: PipeSettings) => void;
}

/** Customer-configurable BYOK providers. Managed and future self-hosted routes stay out of this list. */
const BYOK_PROVIDERS: Provider[] = ['openrouter', 'openai', 'anthropic', 'google', 'github', 'cerebras', 'xai', 'groq', 'cohere', 'venice', 'aihubmix', 'huggingface', 'xkiro', 'vercel'];
const KEY_HINTS: Partial<Record<Provider, string>> = {
  openrouter: 'Your OpenRouter key',
  vercel: 'Your Vercel AI Gateway key',
  openai: 'Your OpenAI key',
  anthropic: 'Your Anthropic key',
  google: 'Your Google AI Studio key',
  groq: 'Your Groq key',
  cohere: 'Your Cohere key',
  xai: 'Your xAI key (xai-…)',
  venice: 'Your Venice key',
  aihubmix: 'Your AIHubMix key',
  huggingface: 'Your Hugging Face token',
  xkiro: 'Your xKiro key',
  github: 'A GitHub token with Models: read',
  cerebras: 'Your Cerebras key',
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
    if (id === provider) set({ provider: id, endpoint: providers[id].endpoint, token: value, inference: 'byok', ...(c.provider !== id ? { model: flagshipFor(id) } : {}) });
  }
  /**
   * Switching provider keeps the Remember choice. It used to load the new provider's own flag —
   * false for one never saved — and because Save writes the whole keyring under that one flag,
   * switching to a new provider (say, xAI) and pressing Save wiped every key saved before it.
   */
  function pickProvider(id: Provider) {
    const next = switchProvider(c, id);
    p.setConnection({ ...next, serverAccessToken: c.serverAccessToken, mode: 'remote', inference: 'byok', saveKey: Boolean(c.saveKey || next.saveKey), model: next.model || flagshipFor(id) });
  }
  function pickModel(id: string) {
    if (id) set({ model: id, inference: 'byok' });
  }
  function pickInference(next: 'free' | 'byok' | 'credits') {
    if (next === 'free' && p.free.models.length && !p.free.models.includes(c.model)) {
      set({ inference: 'free', model: p.free.models[0], provider: p.free.providers[p.free.models[0]] as Provider, token: '' });
    } else if (next === 'credits' && p.paid.models.length && !p.paid.models.includes(c.model)) {
      set({ inference: 'credits', model: p.paid.models[0], provider: p.paid.providers[p.paid.models[0]] as Provider, token: '', maxTokens: p.subscription?.plan.maxOutputTokens ?? 16384 });
    } else set({ inference: next, ...(next === 'credits' ? { token: '', maxTokens: p.subscription?.plan.maxOutputTokens ?? 16384, provider: p.paid.providers[c.model] as Provider ?? c.provider } : {}) });
  }

  const live = p.discovered[provider];
  // The dropdown always has something to choose from. It used to stay empty and disabled until
  // live discovery answered, so a slow or failed catalog read looked like a broken setting. The
  // built-in list shows at once; the live list replaces it when it arrives.
  const choices = useMemo(() => rankChoices(live?.models?.length ? live.models : providers[provider].models.map((id): ModelChoice => ({ id, label: id }))), [live, provider]);
  const fromSeeds = !live?.models?.length;
  const checking = p.discovering.has(provider);
  const selectedInChoices = choices.some(choice => choice.id === c.model);
  const recent = p.ledger.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const meter = inference === 'free' ? p.freeBalance : p.balance;
  const managed = inference === 'free';
  const plan = inference === 'credits';
  const planOffered = p.paid.configured || p.paid.enabled || hasToken;
  const outputCap = Math.min(modelOutputCeiling(c.model), managed ? p.free.maxOutputTokens ?? 16384 : plan ? p.subscription?.plan.maxOutputTokens ?? 16384 : 65536);
  const outputOptions = [...new Set([...OUTPUT_LIMITS.filter(n => n <= outputCap), outputCap])].sort((a, b) => a - b);

  return <div className="page">
    <div className="page-head">
      <div>
        <h1>Settings</h1>
        <p>Manage your personal provider keys, subscription access, and local model here. Chat shows the connected models; deployment keys are managed in the protected admin dashboard.</p>
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
              <small>{p.subscription ? `${p.subscription.plan.name} · ${p.subscription.plan.price}/month` : 'Connect your subscription token to use the managed US models.'}</small>
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
              <label className="grow">Plan model<select aria-label="Plan model" value={p.paid.models.includes(c.model) ? c.model : ''} disabled={p.busy || !p.paid.models.length} onChange={e => { if (e.target.value) set({ model: e.target.value, inference: 'credits', provider: p.paid.providers[e.target.value] as Provider, token: '' }); }}>
                {!p.paid.models.length && <option value="">No plan models are published yet</option>}
                {p.paid.models.length > 0 && !p.paid.models.includes(c.model) && <option value="">Choose a plan model</option>}
                {p.paid.models.map(id => <option key={id} value={id}>{p.paid.labels[id] ?? id}</option>)}
              </select></label>
            </div>
            <p className="help" role="status">{p.planChecking ? 'Verifying your plan…' : p.subscription ? `${p.subscription.plan.name} verified · ${p.subscription.pool.toLocaleString()} credits per month · up to ${p.subscription.plan.maxOutputTokens.toLocaleString()} output tokens per reply.` : p.planError || 'Enter your individual plan token to verify its tier and allowance.'}</p>
            <label className="check"><input type="checkbox" disabled={p.busy} checked={Boolean(c.saveKey)} onChange={e => set({ saveKey: e.target.checked })} />Remember this token in this browser</label>
          </> : <>
            <p className="help">Orator sends requests through its protected gateway. Select the provider you already use and enter its key — that is all. It starts on the provider's flagship model and reads the live catalog by itself; change the model here or from the dropdown on the prompt bar whenever you like. Your key is used only for that provider and is never bundled into the app.</p>
            <details className="free-keys">
              <summary>No key yet? Get a free one in a few minutes</summary>
              <p className="help">Each of these is free from a US company. Your own free key comes with its own limits, so it keeps working when the shared free tier is busy.</p>
              <ul className="free-key-list">
                {FREE_KEY_OPTIONS.map(o => <li key={o.provider}>
                  <h3>{o.name}</h3>
                  <ol>{o.steps.map(step => <li key={step}>{step}</li>)}</ol>
                  {o.note && <p className="help">{o.note}</p>}
                  <span className="row gap">
                    <a className="button small" href={o.getKeyUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" />Get a {providers[o.provider].name} key<span className="sr-only"> (opens in a new tab)</span></a>
                    <button className="button primary small" disabled={p.busy} onClick={() => pickProvider(o.provider)}>Use {providers[o.provider].name}</button>
                  </span>
                </li>)}
              </ul>
            </details>
            <div className="form-grid">
              <label>Provider<select value={provider} disabled={p.busy} onChange={e => pickProvider(e.target.value as Provider)}>{BYOK_PROVIDERS.map(id => <option key={id} value={id}>{providers[id].name}</option>)}</select></label>
              <label>API key<input type="password" autoComplete="off" spellCheck={false} disabled={p.busy} value={c.provider === provider ? c.token || p.keys[provider] || '' : p.keys[provider] || ''} placeholder={KEY_HINTS[provider]} onChange={e => setKey(provider, e.target.value)} /></label>
              <label className="grow">Model <small className="muted">(optional — starts on {providers[provider].flagship ?? 'the strongest model found'})</small><span className="row">
                <select aria-label="Preferred model" value={selectedInChoices ? c.model : ''} disabled={p.busy || choices.length === 0} onChange={e => pickModel(e.target.value)}>
                  {choices.length === 0 && <option value="">{checking ? 'Loading available models…' : c.token || p.keys[provider] ? 'Discover models from this provider' : 'Enter a key to list its models'}</option>}
                  {choices.length > 0 && !selectedInChoices && <option value="">{c.model ? `${c.model} (typed)` : `Choose one of ${choices.length.toLocaleString()} models`}</option>}
                  {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}{choice.free ? ' · free' : ''}</option>)}
                </select>
                <button className="button primary small" disabled={p.busy || checking || !(c.token || p.keys[provider])} onClick={() => p.discover(provider)}>{checking ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}{live ? 'Refresh' : 'Discover'}</button>
              </span></label>
            </div>
            {live && !live.error && <p className="help">{choices.length.toLocaleString()} models reachable on your {providers[provider].name} key, read {new Date(live.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. The same list is in the dropdown on the prompt bar.</p>}
            {fromSeeds && <p className="help">{checking ? 'Reading the live list from your provider. You can pick from the built-in list now.' : 'Showing the built-in list. Discover reads every model your key reaches.'}</p>}
            {live?.error && <p className="help" role="alert">Could not read the live list: {live.error}. The built-in list still works, and you can type a model ID below.</p>}
            <button type="button" className="text-button" onClick={() => setManualModel(value => !value)}>{manualModel ? 'Hide manual model ID' : 'Can’t find your model? Enter its ID'}</button>
            {manualModel && <label>Model ID<input value={c.model} maxLength={200} placeholder="Provider model ID" onChange={e => pickModel(e.target.value)} /></label>}
            <label className="check"><input type="checkbox" disabled={p.busy} checked={Boolean(c.saveKey)} onChange={e => set({ saveKey: e.target.checked })} />Remember personal keys in this browser</label>
            <p className="help">Keys stay in this browser only when you choose Remember. They are not sent to third-party scripts, placed in the app bundle, or returned by the server.</p>
          </>}
          <label>Longest reply<select aria-describedby="reply-length-help" value={effectiveOutputLimit(c, outputCap)} disabled={p.busy} onChange={e => set({ maxTokens: Number(e.target.value), customOutputLimit: true })}>
            {outputOptions.map(n => <option key={n} value={n}>{n.toLocaleString()} tokens{n === DEFAULT_OUTPUT_TOKENS ? ' (recommended)' : ''}</option>)}
          </select></label>
          <p className="help" id="reply-length-help">Managed replies use the backend limit by default. Choose a shorter reply here if you prefer. Remaining allowance and model limits can reduce the reply window. Personal keys are billed by the provider for actual usage.</p>
          {(managed || plan) && c.customOutputLimit && <button className="button small" disabled={p.busy} onClick={() => set({ maxTokens: outputCap, customOutputLimit: false })}>Use backend reply limit</button>}
          <div className="row gap"><button className="button primary small" disabled={p.busy} onClick={p.save}><Check size={13} />Save connection</button><button className="button small" disabled={p.busy} onClick={p.forget}><Trash2 size={13} />Forget saved keys</button></div>
        </section>

        <section className="panel">
          <h2><HardDrive size={15} strokeWidth={1.75} /> Local model</h2>
          <p className="help">Run a model on this computer with LM Studio or Ollama and use it here, on every tier, with no plan-credit charge. Your browser sends inference requests directly to your local server. Sessions may still sync to this app’s server. Start the local server first, then switch this on.</p>
          <label className="check"><input type="checkbox" checked={p.pipes.ollamaEnabled} onChange={e => { p.setPipes({ ...p.pipes, ollamaEnabled: e.target.checked }); if (e.target.checked) p.discover('ollama'); }} />Connect a model running on this computer</label>
          {p.pipes.ollamaEnabled && <>
            <label>Local server API key (optional)<input type="password" autoComplete="off" spellCheck={false} value={p.keys.ollama || ''} placeholder="Only if your local server requires a token" onChange={e => { p.setKeys({ ...p.keys, ollama: e.target.value }); if (c.provider === 'ollama') set({ token: e.target.value }); }} /></label>
            <label className="check"><input type="checkbox" checked={Boolean(c.saveKey)} disabled={p.busy} onChange={e => set({ saveKey: e.target.checked })} />Remember personal keys in this browser</label>
            <p className="help">This token is sent only to the local server address below. Use Save connection with Remember enabled to keep it in this browser.</p>
            <label>Address<input value={p.pipes.ollamaUrl} spellCheck={false} aria-invalid={Boolean(localEndpointError(p.pipes.ollamaUrl))} placeholder="http://localhost:1234/v1 (LM Studio) or http://localhost:11434/v1 (Ollama)" onChange={e => p.setPipes({ ...p.pipes, ollamaUrl: e.target.value })} onBlur={e => { if (!localEndpointError(e.target.value)) p.setPipes({ ...p.pipes, ollamaUrl: normalizeLocalEndpoint(e.target.value) }); }} /></label>
            {localEndpointError(p.pipes.ollamaUrl) && <p className="msg-error" role="alert">{localEndpointError(p.pipes.ollamaUrl)}</p>}
            <div className="row gap"><button className="button small" disabled={Boolean(localEndpointError(p.pipes.ollamaUrl)) || p.discovering.has('ollama')} onClick={() => p.discover('ollama')}>{p.discovering.has('ollama') ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}Check for models</button></div>
            {p.discovered.ollama?.models.length ? <p className="help">{p.discovered.ollama.models.length.toLocaleString()} local model{p.discovered.ollama.models.length === 1 ? '' : 's'} found. Pick one from the Other providers menu in the chat window.</p> : p.discovered.ollama?.error ? <p className="help" role="alert">Could not reach it: {p.discovered.ollama.error}. Is the local server running?</p> : <p className="help">Nothing found yet. Load a model in LM Studio (with its server running) or run <code>ollama pull</code>, then check again.</p>}
          </>}
        </section>

        <section className="panel">
          <h2><ShieldCheck size={15} strokeWidth={1.75} /> Orator routing</h2>
          <p className="help">Orator is provider-neutral. It selects routes by task capability, context, privacy, availability, entitlement, latency, and cost policy—not by a model's price label. Free, open-weight, economical, local, and premium models are evaluated on capability and acceptance criteria.</p>
          <p className="help">Managed models come from the US provider keys and model list set in the admin dashboard. Other providers run on your personal keys; local models run on your computer.</p>
        </section>
      </div>

      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h2>{managed ? 'Free allowance' : plan ? `${p.subscription?.plan.name ?? 'Plan'} allowance` : 'Usage'}</h2><span className="pill">{managed ? <Sparkles size={12} /> : <Coins size={12} />}{managed || plan && p.subscription ? `${meter.remaining.toLocaleString()} of ${meter.pool.toLocaleString()} credits left` : 'No plan credits charged'}</span></div>
          {(managed || plan && p.subscription) && <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={meter.pool} aria-valuenow={meter.used} aria-label="Credits used this month"><span style={{ width: `${meter.pool ? Math.min(100, (meter.used / meter.pool) * 100) : 0}%` }} /></div>}
          <p className="help">{managed || plan && p.subscription ? `${meter.used.toLocaleString()} credits used in ${meter.month}. Managed usage is measured by the server.` : 'Personal keys and local models do not draw plan credits.'}</p>
          {recent.length > 0 && <div className="ledger-wrap"><table className="ledger"><thead><tr><th>When</th><th>Model</th><th>Mode</th><th className="num">Tokens</th><th className="num">Credits</th></tr></thead><tbody>{recent.map(entry => <tr key={entry.id}><td>{new Date(entry.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td className="mono">{entry.model}</td><td>{entry.mode}</td><td className="num">{entry.tokens.toLocaleString()}</td><td className="num">{entry.credits.toLocaleString()}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="panel">
          <h2><Palette size={15} strokeWidth={1.75} /> Appearance</h2>
          <p className="help">Pick the surface you want to work on. The choice is remembered in this browser and applies immediately — no reload, and no dependency on what the operating system is doing.</p>
          <ThemePicker value={p.theme} onChange={p.setTheme} />
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
          <p className="help">The admin dashboard is where the operator enters provider keys on the server, decides which models are free and which are on the paid plan, and sets the free-tier limits — no redeploy needed. {p.adminConfigured ? 'You are signed in to it on this browser.' : 'It is open: the first visit asks you to choose a password, so no hosting environment edit is needed.'}</p>
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
