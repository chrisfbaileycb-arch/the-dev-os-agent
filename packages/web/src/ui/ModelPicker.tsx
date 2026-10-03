import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CreditCard, Globe, KeyRound, LoaderCircle, RefreshCw, Search, Sparkles, Wallet } from 'lucide-react';
import { LANE_LABEL, laneOf, providersInLane, type Lane } from '../lib/modelLanes';
import { catalog, findModel, type CatalogModel, type InferenceMode } from '../lib/catalog';
import { providers, type Provider } from '../lib/providers';
import { badgeFor, canPayFor, emptyReason, type Reach } from '../lib/availability';
import { capabilityTier, filterChoices, isVerifiedOperational, modelChoices, rankChoices, TIER_LABELS, type ModelChoice } from '../lib/modelChoices';
import { pipeEnabled, type PipeSettings } from '../lib/pipes';
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
//
// Every group is sorted by capability tier (lib/modelChoices.ts): flagships first, then fast
// lightweight models, then previews and legacy releases, and each row says which tier it is in.
// A provider whose pipe is switched off in Connectors → Model providers does not appear at all.
//
// The dock renders this component twice, once per lane (lib/modelLanes.ts). The `us` lane holds the
// deployment's free and plan groups plus the US labs; the `own` lane holds every other provider and
// is paid for only by a key typed into the menu itself, which App keeps in this browser alone.

export interface ModelPickerProps {
  /** Which of the two dropdowns this is. */
  lane: Lane;
  /** The active connection's provider, so the dropdown that owns the current model can show it. */
  provider?: Provider;
  /** Where a key is entered. The dropdown lists only models that can run; it never asks for a key itself. */
  onOpenSettings: () => void;
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
  /** Which provider groups are switched on (Connectors → Model providers). */
  pipes: PipeSettings;
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
const ORDER: Provider[] = ['ollama', 'openrouter', 'vercel', 'anthropic', 'openai', 'google', 'github', 'cerebras', 'xai', 'groq', 'cohere', 'venice', 'xkiro', 'aihubmix', 'huggingface'];
const tierOf = (m: ModelChoice) => TIER_LABELS[capabilityTier(m.id, m.label)];

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
  useEffect(() => { if (!open) { setQuery(''); setPickedTab(null); } }, [open]);

  // The deployment funds only US labs, so its free and plan groups belong to the US dropdown and
  // the own-key dropdown never lists them.
  const managed = p.lane === 'us';
  // Only the dropdown that owns the current model shows it; with no model chosen yet, both show their lane name.
  const holdsCurrent = laneOf(p.provider, p.inference) === p.lane && Boolean(p.model);
  /**
   * Whether a vendor's models can run from this dropdown. In the US lane a plan token also opens
   * them, because the server funds those. In the own-key lane only a key does: the server will not
   * spend the deployment's keys on a provider outside the US lane, plan token or not.
   */
  const reachable = (provider: Provider) => managed ? canPayFor(provider, p.reach) : p.keyed.has(provider);
  const nameFor = (id: string) => p.labels[id] ?? findModel(id)?.label ?? id;
  const freeModels = useMemo<ModelChoice[]>(() => rankChoices(managed ? p.free.models.map(id => ({ id, label: nameFor(id) })) : []), [managed, p.free.models, p.labels]); // eslint-disable-line react-hooks/exhaustive-deps
  const paidModels = useMemo<ModelChoice[]>(() => rankChoices(managed ? p.paid.models.map(id => ({ id, label: p.paid.labels[id] ?? nameFor(id) })) : []), [managed, p.paid.models, p.paid.labels, p.labels]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = (id: string) => p.model.toLowerCase() === id.toLowerCase();
  const badge = payLabel(p.inference);

  const [pickedTab, setPickedTab] = useState<'ready' | 'extended' | null>(null);

  // Keyed vendors first, in a fixed order, then the rest as previews of what a key would unlock.
  const vendors = useMemo(() => {
    const shownPipe = (id: Provider) => pipeEnabled(id, p.pipes);
    const order = providersInLane(ORDER, p.lane);
    const keyed = order.filter(id => p.keyed.has(id) && shownPipe(id));
    const unkeyed = order.filter(id => !p.keyed.has(id) && shownPipe(id) && !providers[id].keyless && (catalog.some(m => m.provider === id) || providers[id].models.length > 0));
    return [...keyed, ...unkeyed].map(provider => {
      const live = p.discovered[provider];
      const seeds: ModelChoice[] = catalog.some(m => m.provider === provider)
        ? catalog.filter(m => m.provider === provider).map(m => ({ id: m.id, label: m.label, ...(m.tier === 'byok' ? { free: true } : {}) }))
        : providers[provider].models.map(id => ({ id, label: findModel(id)?.label ?? id }));
      const rawList = p.keyed.has(provider) && live && live.models.length ? live.models : seeds;
      const choices = modelChoices(rawList, [], provider);
      const models: ModelChoice[] = rankChoices(choices);
      const readyModels = models.filter(m => m.section === 'ready' || m.verified);
      const extendedModels = models.filter(m => m.section === 'extended' || !m.verified);
      return {
        provider,
        models,
        readyModels,
        extendedModels,
        live: Boolean(p.keyed.has(provider) && live && live.models.length),
        error: p.keyed.has(provider) ? live?.error : undefined
      };
    });
  }, [p.keyed, p.discovered, p.pipes, p.lane]);

  // A vendor with no key behind it cannot answer, so it is not offered as a choice: it gets a line
  // to paste its key into instead, rather than a list of models that fail on send. Every provider in
  // the lane with a real endpoint gets one, including gateways that ship with no model seeds.
  const usable = vendors.filter(v => reachable(v.provider));
  const locked = vendors.filter(v => !reachable(v.provider));
  const total = freeModels.length + paidModels.length + usable.reduce((n, v) => n + v.models.length, 0);
  const readyTotal = freeModels.length + paidModels.length + usable.reduce((n, v) => n + v.readyModels.length, 0);
  const extendedTotal = usable.reduce((n, v) => n + v.extendedModels.length, 0);
  const shown = <T extends ModelChoice>(list: T[]) => filterChoices(list, query);
  // Until the visitor picks a tab, the own-key lane opens on the one that has models in it. Most of
  // its providers (OpenRouter, Cerebras, Venice, ...) have nothing on the verified list, so a freshly
  // saved key would otherwise leave the menu on an empty "Ready to run" tab.
  const sectionTab = pickedTab ?? (!managed && readyTotal === 0 && extendedTotal > 0 ? 'extended' : 'ready');
  const setSectionTab = setPickedTab;

  function chooseVendor(provider: Provider, m: ModelChoice) {
    setOpen(false);
    const seed = findModel(m.id);
    if (reachable(provider)) p.onPick(m.id, managed && p.inference === 'credits' ? 'credits' : 'byok', provider);
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
      <small>{tierOf(m)} · {sub}</small>
    </button>;

  function renderVendorGroup(provider: Provider, list: ModelChoice[], live: boolean, error?: string, sectionType: 'ready' | 'extended' = 'ready') {
    const providerName = providers[provider].name;
    const unlocked = reachable(provider);
    const busy = p.discovering.has(provider);
    return <div key={`${provider}-${sectionType}`} className="model-group">
      <span className="model-group-label"><KeyRound size={11} strokeWidth={2} />{providerName} {providers[provider].keyless ? (live ? `· ${list.length.toLocaleString()} installed` : '· local') : unlocked ? (live ? `· ${list.length.toLocaleString()} on your key` : '· key active') : '· bring your key'}
        {unlocked && <button type="button" className="model-refresh" title={busy ? 'Reading the live list…' : 'Re-read the live model list'} aria-label={`Refresh ${providerName} models`} disabled={busy} onClick={e => { e.stopPropagation(); p.onDiscover(provider); }}>{busy ? <LoaderCircle size={11} className="spin" /> : <RefreshCw size={11} />}</button>}
      </span>
      {!unlocked && <small className="model-group-note">Add your {providerName} API key in Settings — the dropdown then lists every model that key reaches.</small>}
      {unlocked && !live && busy && <small className="model-group-note">{providers[provider].keyless ? 'Reading the models installed on this machine…' : 'Reading what your key reaches…'}</small>}
      {providers[provider].keyless && !live && !busy && !error && <small className="model-group-note">No local models found yet. Load one in LM Studio (with its server running) or run <code>ollama pull</code>, then refresh.</small>}
      {unlocked && !live && !busy && error && <small className="model-group-note">Could not read the live list ({error}). Showing a starter set; type any model ID in Settings.</small>}
      {list.slice(0, VISIBLE_CAP).map(m => {
        const seed = findModel(m.id);
        const included = seed && seed.provider === provider ? badgeFor(seed, p.reach) === 'included' : false;
        const local = Boolean(providers[provider].keyless);
        const badgeText = local ? 'Local' : included ? 'Included / Free' : m.free ? 'Free on your key' : 'BYOK';
        return row(m, () => chooseVendor(provider, m), badgeText, local || included || Boolean(m.free), local ? 'runs on this machine' : unlocked ? (p.inference === 'credits' ? 'on your plan' : 'on your key') : `${seed?.weight ?? 3} cr/1K on credits`);
      })}
      {list.length > VISIBLE_CAP && <small className="model-group-note">{(list.length - VISIBLE_CAP).toLocaleString()} more — type to narrow the list.</small>}
    </div>;
  }

  return <div className="model-picker" ref={root}>
    {/* The dropdown that holds the current model shows it; the other shows its own name, dimmed. */}
    <button type="button" className={`chip-button model-trigger${open ? ' open' : ''}${holdsCurrent ? '' : ' idle'}`} disabled={p.disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)} title={holdsCurrent ? `Choose a model — ${LANE_LABEL[p.lane]}` : managed ? 'US models: Anthropic, OpenAI, Google, xAI, Groq, Cerebras' : 'Other providers, on your own API key'}>
      {holdsCurrent
        ? (p.inference === 'free' ? <Sparkles size={13} strokeWidth={1.75} /> : p.inference === 'credits' ? <Wallet size={13} strokeWidth={1.75} /> : <KeyRound size={13} strokeWidth={1.75} />)
        : (managed ? <Sparkles size={13} strokeWidth={1.75} /> : <Globe size={13} strokeWidth={1.75} />)}
      <span className="model-name">{holdsCurrent ? modelLabel(p.model, p.labels) : LANE_LABEL[p.lane]}</span>
      {holdsCurrent && <em className={`pay-badge ${p.inference}`}>{badge}</em>}
      <ChevronDown size={12} />
    </button>
    {open && <div className="model-menu" role="listbox" aria-label={`Model: ${LANE_LABEL[p.lane]}`}>
      <div className="model-lane-head"><strong>{LANE_LABEL[p.lane]}</strong><small>{managed ? 'Anthropic, OpenAI, Google, xAI, Groq and Cerebras — free, plan, or your own key.' : 'Runs on your own API key. Saved in this browser only.'}</small></div>
      {total > 8 && <label className="model-search"><Search size={12} /><input ref={search} type="search" value={query} placeholder={`Filter ${total.toLocaleString()} models…`} aria-label="Filter models" onChange={e => setQuery(e.target.value)} /></label>}

      {extendedTotal > 0 && <div className="model-tabs" role="tablist" aria-label="Catalog Sections">
        <button type="button" role="tab" aria-selected={sectionTab === 'ready'} className={sectionTab === 'ready' ? 'model-tab active' : 'model-tab'} onClick={() => setSectionTab('ready')}>Ready to run ({readyTotal.toLocaleString()})</button>
        <button type="button" role="tab" aria-selected={sectionTab === 'extended'} className={sectionTab === 'extended' ? 'model-tab active' : 'model-tab'} onClick={() => setSectionTab('extended')}>More, untested ({extendedTotal.toLocaleString()})</button>
      </div>}

      {sectionTab === 'ready' && (
        <div className="model-section ready-section">
          <div className="model-section-header">
            <span className="model-section-title"><Sparkles size={11} strokeWidth={2} /> Ready to Run</span>
            <em className="section-badge ready">Verified Active</em>
          </div>

          {managed && freeModels.length > 0 && <div className="model-group">
            <span className="model-group-label"><Sparkles size={11} strokeWidth={2} />Free · no key needed</span>
            {p.free.enabled
              ? <small className="model-group-note">{freeModels.length} model{freeModels.length === 1 ? '' : 's'} this deployment funds · {p.free.monthlyCredits.toLocaleString()} credits a month, then bring your own key.</small>
              : <small className="model-group-note">{emptyReason(p.reach)}</small>}
            {shown(freeModels).map(m => row(m, () => { setOpen(false); p.onPick(m.id, 'free', p.free.providers[m.id] as Provider | undefined); }, 'Included / Free', true, `${p.free.providers[m.id] ?? 'this deployment'} · runs with nothing entered`))}
          </div>}

          {managed && (p.paid.enabled || p.paid.configured) && paidModels.length > 0 && <div className="model-group">
            <span className="model-group-label"><CreditCard size={11} strokeWidth={2} />Paid plan {p.reach.credits ? '· plan active' : p.paid.enabled ? '· needs your plan token' : '· opening soon'}</span>
            <small className="model-group-note">{p.reach.credits ? 'Runs on this deployment’s keys and draws from your plan allowance.' : p.paid.enabled ? 'Subscribers run these on this deployment’s keys. Paste your plan access token in Settings.' : 'The operator has listed these for the paid plan; checkout is not open yet.'}</small>
            {shown(paidModels).map(m => row(m, () => choosePlan(m), 'Plan', p.reach.credits, p.reach.credits ? 'on your plan' : 'needs a plan'))}
          </div>}

          {usable.map(({ provider, readyModels, live, error }) => {
            if (!readyModels.length) return null;
            const list = shown(readyModels);
            if (query && !list.length) return null;
            return renderVendorGroup(provider, list, live, error, 'ready');
          })}
        </div>
      )}

      {sectionTab === 'extended' && extendedTotal > 0 && (
        <div className="model-section extended-section">
          <div className="model-section-header">
            <span className="model-section-title"><KeyRound size={11} strokeWidth={2} /> Extended Catalog</span>
            <em className="section-badge extended">Extended Listings</em>
          </div>

          {usable.map(({ provider, extendedModels, live, error }) => {
            if (!extendedModels.length) return null;
            const list = shown(extendedModels);
            if (query && !list.length) return null;
            return renderVendorGroup(provider, list, live, error, 'extended');
          })}
        </div>
      )}

      {/* Nothing can run yet: say so, and say where a key goes. No model is listed that would fail on send. */}
      {readyTotal + extendedTotal === 0 && <div className="model-empty">
        <small className="model-group-note">{managed ? 'No models are available yet. Add an API key in Settings and its models appear here.' : 'No models are available yet. Add a key for one of these providers in Settings and its models appear here.'}</small>
        <button type="button" className="button small" onClick={() => { setOpen(false); p.onOpenSettings(); }}><KeyRound size={12} />Open Settings</button>
      </div>}

      {query && total > 0 && !shown(freeModels).length && !shown(paidModels).length && usable.every(v => !shown(v.models).length) && <small className="model-group-note">Nothing matches “{query}”. You can still type any model ID in Settings.</small>}
    </div>}
  </div>;
}
