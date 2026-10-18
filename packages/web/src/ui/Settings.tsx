import { useMemo, useState } from 'react';
import { Check, ClipboardCopy, Coins, CreditCard, ExternalLink, Eye, EyeOff, HardDrive, KeyRound, LoaderCircle, MonitorDown, Palette, Search, ShieldCheck, Sparkles, Trash2, Wrench } from 'lucide-react';
import { findModel } from '../lib/catalog';
import type { Discovered } from '../lib/discovered';
import type { PaidTier } from '../lib/deployment';
import { flagshipFor, providers, switchProvider, modelOutputCeiling, effectiveOutputLimit, type Keyring, type Provider, DEFAULT_OUTPUT_TOKENS, OUTPUT_LIMITS } from '../lib/providers';
import { isChatModel, rankChoices, preferredModel } from '../lib/modelChoices';
import { localEndpointError, normalizeLocalEndpoint, type PipeSettings } from '../lib/pipes';
import { FREE_KEY_OPTIONS } from '../lib/freeKeys';
import type { Balance, FreeTier, LedgerEntry, PlanReading } from '../lib/store';
import type { Connection } from '../lib/types';
import { isInstalled, promptInstall } from '../pwa';
import { testLocalEndpoint } from '../lib/localNetwork';
import type { HostStorage } from '../lib/deployment';
import ThemePicker from './ThemePicker';
import { loadWorkingMemory, saveWorkingMemory } from '../lib/workingMemory';
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
  /** Where the monthly free number lives. Absent means the page does not claim a browser ledger. */
  storage?: HostStorage;
  engineKey?: string;
  setEngineKey?: (value: string) => void;
}

// The visitor's BYOK card offers one universal slot, not a row per provider. The full
// multi-provider matrix (every key, every route) lives in the admin dashboard; what a visitor
// needs here is the one provider they intend to use. These are the US backend providers plus the
// OpenRouter experiment route. Hugging Face, Cerebras, Cohere, Venice and the rest are gone from
// this page — and Hugging Face is gone from the app entirely.
const US_BYOK_PROVIDERS: Provider[] = ['openai', 'anthropic', 'google', 'groq', 'xai'];
const BYOK_CHOICES: Provider[] = [...US_BYOK_PROVIDERS, 'openrouter'];
const KEY_HINTS: Partial<Record<Provider, string>> = {
  openai: 'sk-…',
  anthropic: 'sk-ant-…',
  google: 'Your Google AI Studio key',
  groq: 'Your Groq key',
  xai: 'Your xAI key',
  openrouter: 'sk-or-…',
};

export default function Settings(p: SettingsProps) {
  const [workingMemory, setWorkingMemory] = useState(loadWorkingMemory);
  const [memoryNote, setMemoryNote] = useState('');
  const [keyShown, setKeyShown] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyNote, setKeyNote] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [pickedProvider, setPickedProvider] = useState<Provider | null>(null);
  const c = p.connection;
  const provider: Provider = BYOK_CHOICES.includes(c.provider as Provider) ? c.provider as Provider : US_BYOK_PROVIDERS[0];
  // The single-slot card follows the connection's provider unless the visitor has explicitly
  // picked one in the dropdown; the pick then wins so the key field does not jump on re-render.
  const chosen = pickedProvider ?? (BYOK_CHOICES.includes(provider) ? provider : US_BYOK_PROVIDERS[0]);
  const slotKey = (id: Provider) => (id === c.provider ? c.token || p.keys[id] : p.keys[id]) || '';
  const inference = c.inference === 'free' ? 'free' : c.inference === 'credits' ? 'credits' : 'byok';
  const hasToken = Boolean(c.serverAccessToken?.trim());
  const set = (patch: Partial<Connection>) => p.setConnection({ ...c, ...patch, mode: 'remote' });

  function setKey(id: Provider, value: string) {
    p.setKeys({ ...p.keys, [id]: value });
    if (id === c.provider || !c.model) p.setConnection({ ...c, provider: id, endpoint: providers[id].endpoint, token: value, inference: 'byok', ...(c.provider !== id ? { model: flagshipFor(id) } : {}) });
  }
  // A provider switch keeps only non-secret preferences across page sessions.
  function pickProvider(id: Provider) {
    const next = switchProvider(c, id);
    p.setConnection({ ...next, token: p.keys[id] ?? '', serverAccessToken: c.serverAccessToken, mode: 'remote', inference: 'byok', saveKey: false, model: preferredModel(p.discovered[id]?.models ?? [], providers[id].flagship) ?? next.model ?? flagshipFor(id) });
  }
  function pickModel(id: string) {
    if (id) set({ model: id, inference: 'byok' });
  }
  // The dropdown chooses which provider the single key slot belongs to. Switching provider
  // clears the draft so a key typed for one provider is never shown — or saved — under another.
  function chooseSlotProvider(id: Provider) {
    setPickedProvider(id);
    setKeyDraft(''); setKeyNote(''); setKeyShown(false);
  }
  function saveSlotKey() {
    const value = keyDraft.trim();
    if (!value) return;
    pickProvider(chosen);
    setKey(chosen, value);
    // OpenRouter reports a key it cannot parse as "Missing Authentication header", which reads
    // like a bug in the app. Every real OpenRouter key starts sk-or-, so say so at save time.
    setKeyDraft(''); setKeyNote(chosen === 'openrouter' && !value.startsWith('sk-or-')
      ? 'Saved, but OpenRouter keys start with sk-or-. This one does not, so OpenRouter will probably reject it. Check that you copied it from openrouter.ai/keys and not another provider.'
      : 'Key saved for this page session. It clears on reload or tab close.');
  }
  function clearSlotKey() {
    setKey(chosen, '');
    setKeyDraft(''); setKeyNote('Key cleared for this page session.');
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
  const choices = useMemo(() => rankChoices(live && !live.error && live.models?.length ? live.models.filter(m => isChatModel(m.id)) : []), [live]);
  const checking = p.discovering.has(provider);
  const selectedInChoices = choices.some(choice => choice.id === c.model);
  const recent = p.ledger.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const meter = inference === 'free' ? p.freeBalance : p.balance;
  const managed = inference === 'free';
  const plan = inference === 'credits';
  const planOffered = p.paid.configured || p.paid.enabled || hasToken;
  const browserLedger = p.storage?.ledger === 'browser';
  const [localNote, setLocalNote] = useState('');
  const [probing, setProbing] = useState(false);
  const iosHomeScreen = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !isInstalled();
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
          <div className="mode-picker two">
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
          </> : <>
            <p className="help">Select an enabled backend and enter your personal key. Requests go through this app's proxy to that backend. Select an available model here or from the prompt bar. Your key is used only for the selected backend and is never bundled into the app.</p>
            <details className="free-keys">
              <summary>No key yet? Get a free one in a few minutes</summary>
              <p className="help">Each of these is free from a US company. Your own free key comes with its own limits, so it keeps working when the shared free tier is busy.</p>
              <ul className="free-key-list">
                {FREE_KEY_OPTIONS.filter(o => BYOK_CHOICES.includes(o.provider)).map(o => <li key={o.provider}>
                  <h3>{o.name}</h3>
                  <ol>{o.steps.map(step => <li key={step}>{step}</li>)}</ol>
                  {o.note && <p className="help">{o.note}</p>}
                  <span className="row gap">
                    <a className="button small" href={o.getKeyUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" />Get a {providers[o.provider].name} key<span className="sr-only"> (opens in a new tab)</span></a>
                    <button className="button primary small" disabled={p.busy} onClick={() => chooseSlotProvider(o.provider)}>Use {providers[o.provider].name}</button>
                  </span>
                </li>)}
              </ul>
            </details>
            <h3>Provider key</h3>
            <p className="help">One card, one key. Choose the provider you intend to use — that single key is all you need to get going, and it stays in this page session. Managing keys for every provider on the server happens in the admin dashboard.</p>
            {(() => {
              const token = slotKey(chosen);
              const live = p.discovered[chosen];
              const status = token.trim() ? (live?.error ? 'Key entered · discovery failed' : p.discovering.has(chosen) ? 'Discovering…' : `${live?.models.length ?? 0} models · Active`) : 'Unset';
              return <div className="byok-card">
                <label>Provider<select aria-label="Provider" disabled={p.busy} value={chosen} onChange={e => chooseSlotProvider(e.target.value as Provider)}>
                  {BYOK_CHOICES.map(id => <option key={id} value={id}>{providers[id].name}</option>)}
                </select></label>
                <label>{providers[chosen].name} API key<span className="slot-key">
                  <input type={keyShown ? 'text' : 'password'} autoComplete="off" spellCheck={false} disabled={p.busy} aria-label={`${providers[chosen].name} API key`} value={keyDraft} placeholder={KEY_HINTS[chosen] ?? 'Paste your provider key'} onChange={e => setKeyDraft(e.target.value)} />
                  <button type="button" className="icon-button" aria-label={keyShown ? 'Hide key' : 'Show key'} title={keyShown ? 'Hide key' : 'Show key'} onClick={() => setKeyShown(v => !v)}>{keyShown ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  <button type="button" className="icon-button" aria-label="Copy key" title="Copy key" disabled={!keyDraft} onClick={() => { void navigator.clipboard?.writeText(keyDraft).then(() => { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 1400); }).catch(() => setCopiedKey(false)); }}>{copiedKey ? <Check size={14} /> : <ClipboardCopy size={14} />}</button>
                </span></label>
                <div className="row gap">
                  <button className="button primary small" disabled={p.busy || !keyDraft.trim()} onClick={saveSlotKey}><Check size={13} />Save key</button>
                  <button className="button small" disabled={p.busy || !token.trim()} onClick={() => { pickProvider(chosen); p.discover(chosen); }}><Search size={13} />Use &amp; discover models</button>
                  <button className="button small" disabled={p.busy || !token.trim()} onClick={clearSlotKey}><Trash2 size={13} />Clear</button>
                </div>
                <p className="help" role="status"><span className={token.trim() ? 'pill ok' : 'pill'}>{status}</span>{keyNote && <> {keyNote}</>}</p>
                {live?.error && <p className="msg-error" role="alert">{live.error}</p>}
              </div>;
            })()}
          </>}
            <p className="help">Security notice: personal keys and plan tokens stay in page memory and clear on reload or tab close. Hosted requests pass through this server to the selected provider. Never paste keys into chat or skills. Clearing a key here does not revoke it or stop a request already running; set spending limits at the provider.</p>
          <label>Longest reply<select aria-describedby="reply-length-help" value={effectiveOutputLimit(c, outputCap)} disabled={p.busy} onChange={e => set({ maxTokens: Number(e.target.value), customOutputLimit: true })}>
            {outputOptions.map(n => <option key={n} value={n}>{n.toLocaleString()} tokens{n === DEFAULT_OUTPUT_TOKENS ? ' (recommended)' : ''}</option>)}
          </select></label>
          <p className="help" id="reply-length-help">Managed replies use the backend limit by default. Choose a shorter reply here if you prefer. Remaining allowance and model limits can reduce the reply window. Personal keys are billed by the provider for actual usage.</p>
          {(managed || plan) && c.customOutputLimit && <button className="button small" disabled={p.busy} onClick={() => set({ maxTokens: outputCap, customOutputLimit: false })}>Use backend reply limit</button>}
          <div className="row gap"><button className="button primary small" disabled={p.busy} onClick={p.save}><Check size={13} />Save connection</button><button className="button small" disabled={p.busy} onClick={p.forget}><Trash2 size={13} />Clear personal keys</button></div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2><HardDrive size={15} strokeWidth={1.75} /> Local model</h2><span className={p.pipes.ollamaEnabled ? 'pill ok' : 'pill'}>{p.pipes.ollamaEnabled ? `Active · ${p.discovered.ollama?.models.length ?? 0} models` : 'Unset'}</span></div>
          <p className="help">Run a model on this computer with LM Studio or Ollama and use it here, on every tier, with no plan-credit charge. Your browser sends inference requests directly to your local server. Sessions may still sync to this app’s server. Start the local server first, then switch this on.</p>
          <label className="check"><input type="checkbox" checked={p.pipes.ollamaEnabled} onChange={e => { p.setPipes({ ...p.pipes, ollamaEnabled: e.target.checked }); if (e.target.checked) p.discover('ollama'); }} />Connect a model running on this computer</label>
          {p.pipes.ollamaEnabled && <>
            <label>Local server API key (optional)<input type="password" autoComplete="off" spellCheck={false} value={p.keys.ollama || ''} placeholder="Only if your local server requires a token" onChange={e => { p.setKeys({ ...p.keys, ollama: e.target.value }); if (c.provider === 'ollama') set({ token: e.target.value }); }} /></label>
            <p className="help">This token is sent only to the local server address below. It stays in page memory and clears on reload or tab close.</p>
            <label>Address<input value={p.pipes.ollamaUrl} spellCheck={false} aria-invalid={Boolean(localEndpointError(p.pipes.ollamaUrl))} placeholder="http://localhost:1234/v1 (LM Studio) or http://localhost:11434/v1 (Ollama)" onChange={e => p.setPipes({ ...p.pipes, ollamaUrl: e.target.value })} onBlur={e => { if (!localEndpointError(e.target.value)) p.setPipes({ ...p.pipes, ollamaUrl: normalizeLocalEndpoint(e.target.value) }); }} /></label>
            {localEndpointError(p.pipes.ollamaUrl) && <p className="msg-error" role="alert">{localEndpointError(p.pipes.ollamaUrl)}</p>}
            <div className="row gap">
              <button className="button small" disabled={Boolean(localEndpointError(p.pipes.ollamaUrl)) || p.discovering.has('ollama')} onClick={() => p.discover('ollama')}>{p.discovering.has('ollama') ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}Check for models</button>
              <button className="button small" disabled={probing || Boolean(localEndpointError(p.pipes.ollamaUrl))} onClick={() => { setProbing(true); void testLocalEndpoint(p.pipes.ollamaUrl, location.origin).then(result => setLocalNote(result.message)).finally(() => setProbing(false)); }}>Test</button>
            </div>
            {localNote && <p className="help" role="status">{localNote}</p>}
            {p.discovered.ollama?.models.length ? <p className="help">{p.discovered.ollama.models.length.toLocaleString()} local model{p.discovered.ollama.models.length === 1 ? '' : 's'} found. Pick one from the Model &amp; Source selector in the chat window.</p> : p.discovered.ollama?.error ? <p className="help" role="alert">Could not reach it: {p.discovered.ollama.error}. Is the local server running?</p> : <p className="help">Nothing found yet. Load a model in LM Studio (with its server running) or run <code>ollama pull</code>, then check again. A native app is not required.</p>}
          </>}
        </section>

        <section className="panel">
          <h2><KeyRound size={15} strokeWidth={1.75} /> Execution engine</h2>
          <p className="help">Google's hosted execution sandbox uses its own session key. Sandbox network access and live connectors are disabled until per-action approvals are available. Runs can still incur provider charges; a token cap is not a dollar spending limit.</p>
          <label>Engine key<input type="password" autoComplete="off" spellCheck={false} value={p.engineKey ?? ''} placeholder="A Gemini API key, used only for this slot" onChange={e => p.setEngineKey?.(e.target.value)} /></label>
        </section>

        <section className="panel">
          <h2>Local working memory &amp; knowledge core</h2>
          <p className="help">These prompts persist only in this browser. They are sent to the selected model when you run a task, and are never included in workspace cloud synchronization. Protected system defaults are edited in Admin.</p>
          <label>Task-specific instructions<textarea rows={5} value={workingMemory.task} onChange={e => setWorkingMemory(v => ({ ...v, task: e.target.value }))} placeholder="Project conventions and instructions for this task" /></label>
          <label>Knowledge core<textarea rows={5} value={workingMemory.knowledge} onChange={e => setWorkingMemory(v => ({ ...v, knowledge: e.target.value }))} placeholder="Project facts to carry into each task" /></label>
          <div className="row gap"><button className="button primary small" onClick={() => { try { saveWorkingMemory(workingMemory, [...Object.values(p.keys), c.token, c.serverAccessToken ?? '', p.engineKey ?? '']); setMemoryNote('Saved in this browser. Applies to your next task.'); } catch (e) { setMemoryNote(e instanceof Error ? e.message : 'Could not save memory.'); } }}>Save local memory</button><button className="button small" onClick={() => { const empty = { task: '', knowledge: '' }; saveWorkingMemory(empty); setWorkingMemory(empty); setMemoryNote('Local working memory cleared.'); }}>Clear local memory</button></div>
          {memoryNote && <p className="help" role="status">{memoryNote}</p>}
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
          <p className="help">{managed || plan && p.subscription ? `${meter.used.toLocaleString()} credits used in ${meter.month}. ${browserLedger && managed ? 'Managed usage is counted in this browser. This host does not remember the monthly quota.' : 'Managed usage is measured by the server.'}` : 'Personal keys and local models do not draw plan credits.'}</p>
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
          <p className="help">Install Signal Forge on Chrome, Windows, Mac, Linux, or a Chromebook. The browser's own prompt is the install. Hosted models need a connection. A local model works only if Ollama is up.</p>
          {iosHomeScreen && <p className="help">On iPhone or iPad, use Share, then Add to Home Screen. There is no App Store listing.</p>}
          {isInstalled() ? <p className="help">Installed. You are using the app window now.</p> : p.canInstall ? <button className="button small" onClick={() => void promptInstall()}><MonitorDown size={13} />Install app</button> : <p className="help">Your browser has not offered to install yet. Use the browser's Install option when it appears.</p>}
        </section>

        <section className="panel">
          <h2><Wrench size={15} strokeWidth={1.75} /> Running this deployment?</h2>
          <p className="help">The admin dashboard is where the operator enters provider keys on the server, decides which models are free and which are on the paid plan, and sets the free-tier limits — no redeploy needed. {p.adminConfigured ? 'You are signed in to it on this browser.' : 'Owner setup requires the setup code from Render Environment.'}</p>
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
