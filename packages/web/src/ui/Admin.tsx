import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, ExternalLink, KeyRound, LoaderCircle, LogOut, RefreshCw, Search, ShieldCheck, Sparkles, CreditCard, Trash2, TriangleAlert } from 'lucide-react';
import { filterChoices, isChatModel, type ModelChoice } from '../lib/modelChoices';

// The operator's dashboard, at /admin.
//
// Everything here talks to /api/admin/* and nothing here is bundled with a secret: the token is
// typed once and becomes a path-scoped cookie; provider keys go up and come back only as a
// last-four hint. The page has three jobs — keys, tiers, knobs — and one honesty check at the
// bottom: what /api/providers is publishing to visitors right now, so a change can be seen to
// have taken effect without opening a second tab.

type Source = 'dashboard' | 'environment' | 'none';
interface ProviderRow { provider: string; name: string; env: string; console: string | null; source: Source; hint: string; unreadable: boolean; }
interface Tunable { name: string; kind: 'number' | 'boolean' | 'secret'; label: string; source: Source; value: string; unreadable: boolean; }
interface TierEntry { id: string; provider: string; label?: string; }
interface Tiers { mode: 'auto' | 'manual'; free: TierEntry[]; paid: TierEntry[]; warnings: string[]; }
interface Published { free: { enabled: boolean; models: string[]; providers: Record<string, string>; labels: Record<string, string>; monthlyCredits: number; perHour: number }; paid: { enabled: boolean; configured: boolean; models: string[] }; }
interface Config { persistent: boolean; providers: ProviderRow[]; tunables: Tunable[]; tunableSpecs: Record<string, { kind: string; label: string; min?: number; max?: number }>; tiers: Tiers; unreadable: string[]; published: Published; gateway: { discovered: boolean; count: number; free: number; error: string | null }; }
interface Status { configured: boolean; authenticated: boolean; persistent: boolean; }

export interface AdminProps { notify: (message: string) => void; onSignedIn: (yes: boolean) => void; }

const errorText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong.';
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error?.message === 'string' ? body.error.message : `Request failed (HTTP ${response.status}).`);
  return body as T;
}
const sourceLabel: Record<Source, string> = { dashboard: 'Set here', environment: 'From environment', none: 'Not set' };

export default function Admin(p: AdminProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [tunableDrafts, setTunableDrafts] = useState<Record<string, string>>({});
  const [catalogs, setCatalogs] = useState<Record<string, ModelChoice[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [tiers, setTiers] = useState<Tiers | null>(null);
  const [dirty, setDirty] = useState(false);

  async function refresh() {
    const s = await api<Status>('/api/admin/status');
    setStatus(s); p.onSignedIn(s.authenticated);
    if (s.authenticated) { const c = await api<Config>('/api/admin/config'); setConfig(c); setTiers(c.tiers); setDirty(false); }
  }
  useEffect(() => { void refresh().catch(e => p.notify(errorText(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run<T>(work: () => Promise<T>, done?: (result: T) => void) {
    setBusy(true);
    try { const result = await work(); done?.(result); } catch (e) { p.notify(errorText(e)); } finally { setBusy(false); }
  }
  const applyConfig = (c: Config) => { setConfig(c); setTiers(t => t && dirty ? { ...t, warnings: c.tiers.warnings } : c.tiers); };

  function signIn() { void run(() => api('/api/admin/login', { method: 'POST', body: JSON.stringify({ token }) }), () => { setToken(''); void refresh().catch(e => p.notify(errorText(e))); }); }
  function signOut() { void run(() => api('/api/admin/logout', { method: 'POST', body: '{}' }), () => { setConfig(null); setStatus(s => s ? { ...s, authenticated: false } : s); p.onSignedIn(false); }); }
  function saveKey(provider: string) { void run(() => api<Config>('/api/admin/keys', { method: 'PUT', body: JSON.stringify({ provider, key: drafts[provider] ?? '' }) }), c => { applyConfig(c); setDrafts(d => ({ ...d, [provider]: '' })); p.notify(`${c.providers.find(x => x.provider === provider)?.name ?? provider} key saved on the server. It funds the next request without a restart.`); }); }
  function removeKey(provider: string) { void run(() => api<Config>('/api/admin/keys', { method: 'PUT', body: JSON.stringify({ provider, key: '' }) }), c => { applyConfig(c); p.notify('Key removed. Any environment value for it applies again.'); }); }
  function saveTunable(name: string) { void run(() => api<Config>('/api/admin/tunables', { method: 'PUT', body: JSON.stringify({ name, value: tunableDrafts[name] ?? '' }) }), c => { applyConfig(c); setTunableDrafts(d => { const { [name]: _drop, ...rest } = d; void _drop; return rest; }); }); }
  function saveTiers() { if (!tiers) return; void run(() => api<Config>('/api/admin/tiers', { method: 'PUT', body: JSON.stringify({ mode: tiers.mode, free: tiers.free, paid: tiers.paid }) }), c => { setConfig(c); setTiers(c.tiers); setDirty(false); p.notify(`Tiers saved: ${c.published.free.models.length} free, ${c.published.paid.models.length} on the paid plan, live for visitors now.`); }); }
  function discover(provider: string) {
    setLoading(l => new Set(l).add(provider));
    api<{ models: ModelChoice[] }>('/api/admin/discover', { method: 'POST', body: JSON.stringify({ provider }) })
      .then(r => setCatalogs(c => ({ ...c, [provider]: r.models.filter(m => isChatModel(m.id)).map(m => ({ id: m.id, label: m.label ?? m.id, ...(m.free ? { free: true } : {}) })) })))
      .catch(e => p.notify(errorText(e)))
      .finally(() => setLoading(l => { const n = new Set(l); n.delete(provider); return n; }));
  }

  const tierOf = (id: string): 'free' | 'paid' | 'off' => tiers?.free.some(m => m.id === id) ? 'free' : tiers?.paid.some(m => m.id === id) ? 'paid' : 'off';
  function setTier(entry: TierEntry, tier: 'free' | 'paid' | 'off') {
    setTiers(t => {
      if (!t) return t;
      const free = t.free.filter(m => m.id !== entry.id); const paid = t.paid.filter(m => m.id !== entry.id);
      if (tier === 'free') free.push(entry); if (tier === 'paid') paid.push(entry);
      return { ...t, free, paid };
    });
    setDirty(true);
  }
  const keyedProviders = useMemo(() => (config?.providers ?? []).filter(r => r.source !== 'none' && !['cheaper-inference'].includes(r.provider)), [config]);

  if (!status) return <div className="page"><p className="help"><LoaderCircle size={14} className="spin" /> Checking the dashboard…</p></div>;

  if (!status.configured) return <div className="page">
    <div className="page-head"><div><h1><ShieldCheck size={18} strokeWidth={1.75} /> Admin dashboard</h1><p>Provider keys, model tiers and free-tier limits, managed on the server without a redeploy.</p></div></div>
    <section className="panel">
      <h2>Switched off on this deployment</h2>
      <p className="help">Set <code>ADMIN_TOKEN</code> in the hosting environment to a long random string (at least 12 characters, <code>openssl rand -hex 24</code> is a good one), restart the service, and sign in here with it. Nothing else is needed: keys entered afterwards are stored encrypted in the workspace database and take effect immediately.</p>
      {!status.persistent && <p className="msg-error"><CircleAlert size={12} />This server has no settings storage, so dashboard values could not be kept between restarts.</p>}
    </section>
  </div>;

  if (!status.authenticated || !config || !tiers) return <div className="page">
    <div className="page-head"><div><h1><ShieldCheck size={18} strokeWidth={1.75} /> Admin dashboard</h1><p>Sign in with the deployment's admin token.</p></div></div>
    <section className="panel" style={{ maxWidth: 460 }}>
      <label>Admin token<input type="password" autoComplete="off" spellCheck={false} value={token} disabled={busy} onChange={e => setToken(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && token) signIn(); }} /></label>
      <div className="row gap"><button className="button primary small" disabled={busy || !token} onClick={signIn}>{busy ? <LoaderCircle size={13} className="spin" /> : <KeyRound size={13} />}Sign in</button></div>
      <p className="help">The token is checked on the server and becomes a twelve-hour cookie scoped to the admin routes. It is never stored in this browser.</p>
    </section>
  </div>;

  const published = config.published;
  const frontier = new Set(tiers.warnings);

  return <div className="page admin">
    <div className="page-head">
      <div><h1><ShieldCheck size={18} strokeWidth={1.75} /> Admin dashboard</h1><p>Keys on the server, models sorted into free and paid, limits on the free tier. Every change applies to the next request; nothing here needs a redeploy.</p></div>
      <div className="row gap"><button className="button small" disabled={busy} onClick={() => void refresh().catch(e => p.notify(errorText(e)))}><RefreshCw size={13} />Reload</button><button className="button small" disabled={busy} onClick={signOut}><LogOut size={13} />Sign out</button></div>
    </div>
    {!config.persistent && <div className="notice"><CircleAlert size={13} /><span>This server has no settings storage: values you enter apply until the next restart only. Set DATABASE_URL or a persistent DATA_FILE to keep them.</span></div>}
    {config.unreadable.length > 0 && <div className="notice"><TriangleAlert size={13} /><span>Stored values for {config.unreadable.join(', ')} were sealed under a secret this server no longer has (ADMIN_TOKEN or SESSION_SECRET changed). Enter them again to reseal.</span></div>}

    <section className="panel">
      <div className="panel-head"><h2><KeyRound size={15} strokeWidth={1.75} /> Provider keys</h2><span className="pill">{config.providers.filter(r => r.source !== 'none').length} of {config.providers.length} connected</span></div>
      <p className="help">A key entered here is encrypted before it is stored and is never returned to any browser, this one included. It wins over the same variable in the hosting environment; remove it and the environment value applies again. Keys stack: every connected provider can fund models in the tiers below.</p>
      <div className="ledger-wrap"><table className="ledger admin-keys"><thead><tr><th>Provider</th><th>Status</th><th>Key</th><th></th></tr></thead><tbody>
        {config.providers.map(r => <tr key={r.provider}>
          <td><strong>{r.name}</strong><br /><small className="mono">{r.env}</small>{r.console && <> · <a href={r.console} target="_blank" rel="noreferrer" className="text-button">get a key <ExternalLink size={10} /></a></>}</td>
          <td>{r.unreadable ? <span className="pill warn">Re-enter</span> : <span className={r.source === 'none' ? 'pill' : 'pill ok'}>{r.source === 'none' ? <CircleAlert size={11} /> : <Check size={11} />}{sourceLabel[r.source]}{r.hint ? ` ${r.hint}` : ''}</span>}</td>
          <td><input type="password" autoComplete="off" spellCheck={false} placeholder={r.source === 'none' ? 'Paste a key' : 'Paste a new key to replace'} value={drafts[r.provider] ?? ''} disabled={busy} onChange={e => setDrafts(d => ({ ...d, [r.provider]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && drafts[r.provider]) saveKey(r.provider); }} /></td>
          <td className="row gap"><button className="button primary small" disabled={busy || !(drafts[r.provider] ?? '').trim()} onClick={() => saveKey(r.provider)}><Check size={12} />Save</button>{r.source === 'dashboard' && <button className="button small" title="Remove the stored key" aria-label={`Remove ${r.name} key`} disabled={busy} onClick={() => removeKey(r.provider)}><Trash2 size={12} /></button>}</td>
        </tr>)}
      </tbody></table></div>
    </section>

    <section className="panel">
      <div className="panel-head"><h2><Sparkles size={15} strokeWidth={1.75} /> Model tiers</h2><span className="row gap">{dirty && <span className="pill warn">Unsaved changes</span>}<button className="button primary small" disabled={busy || !dirty} onClick={saveTiers}><Check size={12} />Save tiers</button></span></div>
      <p className="help"><strong>Free</strong> models run for any visitor with no key, on this deployment's keys, metered against the free allowance. <strong>Paid plan</strong> models run for subscribers who hold the plan access token, on this deployment's keys, against the plan allowance. Everything else stays bring-your-own-key. Load a provider's live list and sort it.</p>
      <div className="mode-picker two">
        <button className={tiers.mode === 'auto' ? 'mode selected' : 'mode'} aria-pressed={tiers.mode === 'auto'} onClick={() => { setTiers({ ...tiers, mode: 'auto' }); setDirty(true); }}><strong>Automatic + your picks</strong><small>The built-in free pool (gateway free models, Groq and OpenRouter free ids) plus whatever you mark free here.</small></button>
        <button className={tiers.mode === 'manual' ? 'mode selected' : 'mode'} aria-pressed={tiers.mode === 'manual'} onClick={() => { setTiers({ ...tiers, mode: 'manual' }); setDirty(true); }}><strong>Only your picks</strong><small>The free tier is exactly the models you mark free. Nothing is added automatically.</small></button>
      </div>
      <div className="tier-summary">
        <div><h3><Sparkles size={12} /> Free ({tiers.free.length})</h3><div className="chips">{tiers.free.map(m => <span key={m.id} className={frontier.has(m.id) ? 'chip warn' : 'chip'} title={frontier.has(m.id) ? 'A frontier or reasoning model: expensive per token on your key.' : m.id}>{frontier.has(m.id) && <TriangleAlert size={10} />}{m.label ?? m.id}<small>{m.provider}</small><button aria-label={`Remove ${m.id} from free`} onClick={() => setTier(m, 'off')}>×</button></span>)}{!tiers.free.length && <small className="help">No manual free picks yet.</small>}</div></div>
        <div><h3><CreditCard size={12} /> Paid plan ({tiers.paid.length})</h3><div className="chips">{tiers.paid.map(m => <span key={m.id} className="chip" title={m.id}>{m.label ?? m.id}<small>{m.provider}</small><button aria-label={`Remove ${m.id} from paid`} onClick={() => setTier(m, 'off')}>×</button></span>)}{!tiers.paid.length && <small className="help">No paid-plan models yet.</small>}</div></div>
      </div>
      {frontier.size > 0 && <p className="help"><TriangleAlert size={12} /> {frontier.size} free pick{frontier.size === 1 ? ' is' : 's are'} frontier-class. They will run for strangers on your card at the flat free rate; the burst and monthly caps below are what bound that.</p>}
      {!keyedProviders.length && <p className="help">Connect a provider key above, then load its models here.</p>}
      {keyedProviders.map(r => {
        const all = catalogs[r.provider];
        const list = all ? filterChoices(all, queries[r.provider] ?? '') : [];
        const isLoading = loading.has(r.provider);
        return <div key={r.provider} className="tier">
          <div className="panel-head"><h3>{r.name}<small>{all ? `${all.length.toLocaleString()} models on this key` : 'Live list not loaded'}</small></h3><span className="row gap">{all && <label className="row gap admin-filter"><Search size={12} /><input type="search" placeholder="Filter" value={queries[r.provider] ?? ''} onChange={e => setQueries(q => ({ ...q, [r.provider]: e.target.value }))} /></label>}<button className="button small" disabled={isLoading} onClick={() => discover(r.provider)}>{isLoading ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />}{all ? 'Reload' : 'Load models'}</button></span></div>
          {all && <div className="ledger-wrap"><table className="ledger tier-table"><tbody>
            {list.slice(0, 80).map(m => { const t = tierOf(m.id); const entry: TierEntry = { id: m.id, provider: r.provider, ...(m.label !== m.id ? { label: m.label } : {}) }; return <tr key={m.id}>
              <td><strong>{m.label}</strong>{m.label !== m.id && <><br /><small className="mono">{m.id}</small></>}{m.free && <em className="model-badge included"> free at provider</em>}</td>
              <td className="tier-choice"><button className={t === 'off' ? 'seg selected' : 'seg'} onClick={() => setTier(entry, 'off')}>BYOK</button><button className={t === 'free' ? 'seg selected' : 'seg'} onClick={() => setTier(entry, 'free')}>Free</button><button className={t === 'paid' ? 'seg selected' : 'seg'} onClick={() => setTier(entry, 'paid')}>Paid</button></td>
            </tr>; })}
            {list.length > 80 && <tr><td colSpan={2}><small className="help">{(list.length - 80).toLocaleString()} more — type to narrow.</small></td></tr>}
          </tbody></table></div>}
        </div>;
      })}
    </section>

    <section className="panel">
      <h2>Free-tier limits and plan settings</h2>
      <p className="help">Numbers apply on the next request. A blank value removes the dashboard setting and the environment (or the built-in default) applies again.</p>
      <div className="form-grid">
        {config.tunables.map(t => <label key={t.name}>{t.label}<span className="row gap">
          {t.kind === 'boolean'
            ? <select value={tunableDrafts[t.name] ?? t.value ?? ''} disabled={busy} onChange={e => setTunableDrafts(d => ({ ...d, [t.name]: e.target.value }))}><option value="">default (false)</option><option value="true">true</option><option value="false">false</option></select>
            : <input type={t.kind === 'secret' ? 'password' : 'number'} autoComplete="off" value={tunableDrafts[t.name] ?? (t.kind === 'secret' ? '' : t.value)} placeholder={t.kind === 'secret' ? (t.value ? `set ${t.value}` : 'not set') : 'default'} min={config.tunableSpecs[t.name]?.min} max={config.tunableSpecs[t.name]?.max} disabled={busy} onChange={e => setTunableDrafts(d => ({ ...d, [t.name]: e.target.value }))} />}
          <button className="button small" disabled={busy || !(t.name in tunableDrafts)} onClick={() => saveTunable(t.name)}><Check size={12} /></button>
        </span><small className="help">{t.unreadable ? 'Re-enter: sealed under an old secret.' : `${sourceLabel[t.source]} · ${t.name}`}</small></label>)}
      </div>
    </section>

    <section className="panel">
      <h2>What visitors see right now</h2>
      <div className="two-col">
        <div>
          <h3><Sparkles size={12} /> Free tier {published.free.enabled ? <span className="pill ok"><Check size={11} />open</span> : <span className="pill warn"><CircleAlert size={11} />closed</span>}</h3>
          <p className="help">{published.free.models.length} model{published.free.models.length === 1 ? '' : 's'} · {published.free.monthlyCredits.toLocaleString()} credits a month · {published.free.perHour} requests an hour per network</p>
          <ul className="published-list">{published.free.models.map(id => <li key={id}><span>{published.free.labels[id] ?? id}</span><small>{published.free.providers[id]}</small></li>)}</ul>
        </div>
        <div>
          <h3><CreditCard size={12} /> Paid plan {published.paid.enabled ? <span className="pill ok"><Check size={11} />open</span> : published.paid.configured ? <span className="pill warn"><CircleAlert size={11} />needs a plan access token</span> : <span className="pill">not configured</span>}</h3>
          <p className="help">{published.paid.models.length} model{published.paid.models.length === 1 ? '' : 's'} published. A subscriber pastes the plan access token in Settings to unlock them. Paid models whose provider has no key are held back.</p>
          <ul className="published-list">{published.paid.models.map(id => <li key={id}><span>{tiers.paid.find(m => m.id === id)?.label ?? id}</span><small>{tiers.paid.find(m => m.id === id)?.provider}</small></li>)}</ul>
          <p className="help">Gateway catalogue: {config.gateway.discovered ? `${config.gateway.count} models, ${config.gateway.free} free` : `unavailable (${config.gateway.error ?? 'not fetched yet'})`}.</p>
        </div>
      </div>
    </section>
  </div>;
}
