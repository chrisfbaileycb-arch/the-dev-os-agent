import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CreditCard, KeyRound, LoaderCircle, RefreshCw, Search, Sparkles, Wallet } from 'lucide-react';
import { catalog, findModel, type CatalogModel, type InferenceMode } from '../lib/catalog';
import { providers, type Provider } from '../lib/providers';
import { badgeFor, canPayFor, emptyReason, hasAnyKey, type Reach } from '../lib/availability';
import { filterChoices, type ModelChoice } from '../lib/modelChoices';
import type { Discovered } from '../lib/discovered';
import type { PaidTier } from '../lib/deployment';
import type { FreeTier } from '../lib/store';

// The model dropdown on the prompt dock.
//
// Three kinds of group, in this order. The free group is the deployment's own answer, rendered
// verbatim: every entry runs with no key by construction. The plan group is what the operator
// listed for subscribers in the admin dashboard, unlocked by the plan access token. Then one
// group per provider: for a provider the visitor holds a key for, the group is what that key
// actually reaches — read live from the provider's own /models the moment the key is entered —
// and not a compiled seed list; a vendor with no key keeps its seeds as a preview of what a key
// would unlock. A live list can run to hundreds of ids, so the menu opens with a filter box.

export interface ModelPickerProps {
  model: string;
  inference: InferenceMode;
  free: FreeTier;
  paid: PaidTier;
  /** Labels by id from every source, so a discovered model reads as "DeepSeek V4 Flash" and not as its id. */
  labels: Record<string, string>;
  /** What can be paid for right now. Shared with Settings so the two cannot disagree. */
  reach: Reach;
  /** Providers holding a key, including one being typed. Unlocks that vendor and only that vendor. */
  keyed: Set<Provider>;
  /** What each connected key reaches, as read from its provider. */
  discovered: Discovered;
  /** Providers whose list is being read right now. */
  discovering: Set<Provider>;
  disabled?: boolean;
  onPick: (model: string, mode?: InferenceMode, provider?: Provider) => void;
  onNeedsKey: (model: CatalogModel) => void;
  onNeedsPlan: (model: ModelChoice) => void;
  onDiscover: (provider: Provider) => void;
}

export function modelLabel(model: string, labels: Record<string, string> = {}): string {
  return labels[model] ?? findModel(model)?.label ?? model ?? 'No model';
}

/** The one-word badge next to the model name: how this run gets paid for. */
export function payLabel(inference: InferenceMode): string {
  return inference === 'free' ? 'managed' : inference === 'credits' ? 'plan' : 'your key';
}

/** How many rows a filtered group shows before asking for a narrower filter. */
const VISIBLE_CAP = 60;
/** Vendors in the order their groups appear; gateways after the direct vendors. */
const ORDER: Provider[] = ['openrouter', 'anthropic', 'openai', 'google', 'groq', 'cohere', 'xkiro', 'aihubmix', 'huggingface'];

export default function ModelPicker(p: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer); document.addEventListener('keydown', onKey);
    search.current?.focus();
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { if (!open) setQuery(''); }, [open]);

  const nameFor = (id: string) => p.labels[id] ?? findModel(id)?.label ?? id;
  const freeModels = useMemo<ModelChoice[]>(() => p.free.models.map(id => ({ id, label: nameFor(id) })), [p.free.models, p.labels]); // eslint-disable-line react-hooks/exhaustive-deps
  const paidModels = useMemo<ModelChoice[]>(() => p.paid.models.map(id => ({ id, label: p.paid.labels[id] ?? nameFor(id) })), [p.paid.models, p.paid.labels, p.labels]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = (id: string) => p.model.toLowerCase() === id.toLowerCase();
  const badge = payLabel(p.inference);
  const payable = (m: CatalogModel) => canPayFor(m.provider, p.reach);
  const nothingOffered = !p.free.enabled && !hasAnyKey(p.reach) && p.inference !== 'credits' && !p.paid.enabled;

  // Keyed vendors first, in a fixed order, then the rest as previews of what a key would unlock.
  const vendors = useMemo(() => {
    const keyed = ORDER.filter(id => p.keyed.has(id));
    const unkeyed = ORDER.filter(id => !p.keyed.has(id) && catalog.some(m => m.provider === id));
    return [...keyed, ...unkeyed].map(provider => {
      const live = p.discovered[provider];
      const models: ModelChoice[] = p.keyed.has(provider) && live && live.models.length
        ? live.models
        : catalog.filter(m => m.provider === provider).map(m => ({ id: m.id, label: m.label, ...(m.tier === 'byok' ? { free: true } : {}) }));
      return { provider, models, live: Boolean(p.keyed.has(provider) && live && live.models.length), error: p.keyed.has(provider) ? live?.error : undefined };
    });
  }, [p.keyed, p.discovered]);

  const total = freeModels.length + paidModels.length + vendors.reduce((n, v) => n + v.models.length, 0);
  const shown = <T extends ModelChoice>(list: T[]) => filterChoices(list, query);

  function chooseVendor(provider: Provider, m: ModelChoice) {
    setOpen(false);
    const seed = findModel(m.id);
    if (canPayFor(provider, p.reach)) p.onPick(m.id, p.inference === 'credits' ? 'credits' : 'byok', provider);
    // A model nothing can pay for is still selectable: it names the key it needs rather than
    // failing quietly on send.
    else p.onNeedsKey(seed && seed.provider === provider ? seed : { id: m.id, provider, label: m.label, tier: 'pro', weight: 3, note: '' });
  }
  function choosePlan(m: ModelChoice) {
    setOpen(false);
    if (p.reach.credits) p.onPick(m.id, 'credits', p.paid.providers[m.id] as Provider | undefined);
    else p.onNeedsPlan(m);
  }

  const row = (m: ModelChoice, onClick: () => void, badgeText: string, included: boolean, sub: string) =>
    <button key={m.id} type="button" role="option" aria-selected={selected(m.id)} className={selected(m.id) ? 'model-option active' : 'model-option'} onClick={onClick} title={m.id}>
      <strong><span className="model-option-name">{m.label}</span><em className={included ? 'model-badge included' : 'model-badge'}>{badgeText}</em>{selected(m.id) && <Check size={12} />}</strong>
      <small>{sub}</small>
    </button>;

  return <div className="model-picker" ref={root}>
    <button type="button" className={open ? 'chip-button model-trigger open' : 'chip-button model-trigger'} disabled={p.disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)} title="Choose a model">
      {p.inference === 'free' ? <Sparkles size={13} strokeWidth={1.75} /> : p.inference === 'credits' ? <Wallet size={13} strokeWidth={1.75} /> : <KeyRound size={13} strokeWidth={1.75} />}
      <span className="model-name">{modelLabel(p.model, p.labels)}</span>
      <em className={`pay-badge ${p.inference}`}>{badge}</em>
      <ChevronDown size={12} />
    </button>
    {open && <div className="model-menu" role="listbox" aria-label="Model">
      {total > 8 && <label className="model-search"><Search size={12} /><input ref={search} type="search" value={query} placeholder={`Filter ${total.toLocaleString()} models…`} aria-label="Filter models" onChange={e => setQuery(e.target.value)} /></label>}

      <div className="model-group">
        <span className="model-group-label"><Sparkles size={11} strokeWidth={2} />Free · no key needed</span>
        {p.free.enabled
          ? <small className="model-group-note">{freeModels.length} model{freeModels.length === 1 ? '' : 's'} this deployment funds · {p.free.monthlyCredits.toLocaleString()} credits a month, then bring your own key.</small>
          : <small className="model-group-note">{emptyReason(p.reach)}</small>}
        {shown(freeModels).map(m => row(m, () => { setOpen(false); p.onPick(m.id, 'free', p.free.providers[m.id] as Provider | undefined); }, 'Included / Free', true, `${p.free.providers[m.id] ?? 'this deployment'} · runs with nothing entered`))}
      </div>

      {(p.paid.enabled || p.paid.configured) && paidModels.length > 0 && <div className="model-group">
        <span className="model-group-label"><CreditCard size={11} strokeWidth={2} />Paid plan {p.reach.credits ? '· plan active' : p.paid.enabled ? '· needs your plan token' : '· opening soon'}</span>
        <small className="model-group-note">{p.reach.credits ? 'Runs on this deployment’s keys and draws from your plan allowance.' : p.paid.enabled ? 'Subscribers run these on this deployment’s keys. Paste your plan access token in Settings.' : 'The operator has listed these for the paid plan; checkout is not open yet.'}</small>
        {shown(paidModels).map(m => row(m, () => choosePlan(m), 'Plan', p.reach.credits, p.reach.credits ? 'on your plan' : 'needs a plan'))}
      </div>}

      {vendors.map(({ provider, models, live, error }) => {
        const providerName = providers[provider].name;
        const unlocked = canPayFor(provider, p.reach);
        const busy = p.discovering.has(provider);
        const list = shown(models);
        if (query && !list.length) return null;
        return <div key={provider} className="model-group">
          <span className="model-group-label"><KeyRound size={11} strokeWidth={2} />{providerName} {unlocked ? (live ? `· ${models.length.toLocaleString()} on your key` : '· key active') : '· bring your key'}
            {unlocked && <button type="button" className="model-refresh" title={busy ? 'Reading the live list…' : 'Re-read the live model list'} aria-label={`Refresh ${providerName} models`} disabled={busy} onClick={e => { e.stopPropagation(); p.onDiscover(provider); }}>{busy ? <LoaderCircle size={11} className="spin" /> : <RefreshCw size={11} />}</button>}
          </span>
          {!unlocked && <small className="model-group-note">Add your {providerName} API key in Settings — the dropdown then lists every model that key reaches.</small>}
          {unlocked && !live && busy && <small className="model-group-note">Reading what your key reaches…</small>}
          {unlocked && !live && !busy && error && <small className="model-group-note">Could not read the live list ({error}). Showing a starter set; type any model ID in Settings.</small>}
          {list.slice(0, VISIBLE_CAP).map(m => {
            const seed = findModel(m.id);
            const included = seed && seed.provider === provider ? badgeFor(seed, p.reach) === 'included' : false;
            const badgeText = included ? 'Included / Free' : m.free ? 'Free on your key' : 'BYOK';
            return row(m, () => chooseVendor(provider, m), badgeText, included || Boolean(m.free), unlocked ? (p.inference === 'credits' ? 'on your plan' : 'on your key') : `${seed?.weight ?? 3} cr/1K on credits`);
          })}
          {list.length > VISIBLE_CAP && <small className="model-group-note">{(list.length - VISIBLE_CAP).toLocaleString()} more — type to narrow the list.</small>}
        </div>;
      })}
      {query && total > 0 && !shown(freeModels).length && !shown(paidModels).length && vendors.every(v => !shown(v.models).length) && <small className="model-group-note">Nothing matches “{query}”. You can still type any model ID in Settings.</small>}
      {nothingOffered && <small className="model-group-note">No managed route is available yet. Add a provider key in Settings to continue.</small>}
    </div>}
  </div>;
}
