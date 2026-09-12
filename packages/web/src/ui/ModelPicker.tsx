import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, KeyRound, Sparkles, Wallet } from 'lucide-react';
import { catalog, findModel, type CatalogModel, type InferenceMode } from '../lib/catalog';
import { providers, type Provider } from '../lib/providers';
import { canPayFor, emptyReason, hasAnyKey, type Reach } from '../lib/availability';
import type { FreeTier } from '../lib/store';

// The model dropdown on the prompt dock.
//
// The free group is the deployment's own answer, rendered verbatim. It used to be a compiled-in
// list of six ids the build hoped were free, cross-checked against the server's copy of the same
// hope; both were wrong, so every entry showed "not funded here" or failed on send. There is now
// nothing to cross-check: `free.models` is what this deployment funds, so every entry in that
// group is runnable with no key by construction, and there is no locked state to explain.
//
// Models that need a key keep their compiled entries, because a key-only model is a suggestion
// rather than a promise — the visitor's own provider decides what it serves, and the model field
// in Settings accepts anything typed.

export interface ModelPickerProps {
  model: string;
  inference: InferenceMode;
  demo: boolean;
  free: FreeTier;
  /** Gateway labels by id, so a discovered model reads as "DeepSeek V4 Flash" and not as its id. */
  labels: Record<string, string>;
  /** What can be paid for right now. Shared with Settings so the two cannot disagree. */
  reach: Reach;
  /** Providers holding a key, including one being typed. Unlocks that vendor and only that vendor. */
  keyed: Set<Provider>;
  disabled?: boolean;
  /** `mode` is set when the group the visitor picked from decides how the run is paid for. */
  onPick: (model: string, mode?: InferenceMode) => void;
  onPreview: () => void;
  onNeedsKey: (model: CatalogModel) => void;
}

const PREVIEW = '__preview__';

export function modelLabel(model: string, demo: boolean, labels: Record<string, string> = {}): string {
  if (demo) return 'Scripted preview';
  return labels[model] ?? findModel(model)?.label ?? model ?? 'No model';
}

/** The one-word badge next to the model name: how this run gets paid for. */
export function payLabel(inference: InferenceMode, demo: boolean): string {
  if (demo) return 'offline';
  return inference === 'free' ? 'free' : inference === 'credits' ? 'credits' : 'your key';
}

export default function ModelPicker(p: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // The free group, straight from the server, labelled by the gateway where it has a name for it.
  const freeModels = useMemo(() => p.free.models.map(id => ({ id, label: p.labels[id] ?? findModel(id)?.label ?? id })), [p.free.models, p.labels]);
  const selected = (id: string) => !p.demo && p.model.toLowerCase() === id.toLowerCase();
  const badge = payLabel(p.inference, p.demo);
  const payable = (m: CatalogModel) => canPayFor(m.provider, p.reach);
  const nothingOffered = !p.free.enabled && !hasAnyKey(p.reach) && p.inference !== 'credits';

  // Group keyed catalog entries by provider so each vendor's section is visually distinct.
  const keyedByProvider = useMemo(() => {
    const order: Provider[] = ['anthropic', 'openai', 'google', 'openrouter'];
    const groups: { provider: Provider; models: CatalogModel[] }[] = [];
    for (const provider of order) {
      const models = catalog.filter(m => m.provider === provider);
      if (models.length) groups.push({ provider, models });
    }
    return groups;
  }, []);

  function chooseKeyed(m: CatalogModel) {
    setOpen(false);
    // A model nothing can pay for is still selectable: it opens Settings and names the key it
    // needs, rather than failing quietly on send.
    if (payable(m)) p.onPick(m.id, p.inference === 'credits' ? 'credits' : 'byok');
    else p.onNeedsKey(m);
  }

  return <div className="model-picker" ref={root}>
    <button type="button" className={open ? 'chip-button model-trigger open' : 'chip-button model-trigger'} disabled={p.disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)} title="Choose a model">
      {p.inference === 'free' && !p.demo ? <Sparkles size={13} strokeWidth={1.75} /> : p.inference === 'credits' ? <Wallet size={13} strokeWidth={1.75} /> : <KeyRound size={13} strokeWidth={1.75} />}
      <span className="model-name">{modelLabel(p.model, p.demo, p.labels)}</span>
      <em className={`pay-badge ${p.demo ? 'offline' : p.inference}`}>{badge}</em>
      <ChevronDown size={12} />
    </button>
    {open && <div className="model-menu" role="listbox" aria-label="Model">
      <div className="model-group">
        <span className="model-group-label"><Sparkles size={11} strokeWidth={2} />Free · no key needed</span>
        {p.free.enabled
          ? <small className="model-group-note">{freeModels.length} model{freeModels.length === 1 ? '' : 's'} this deployment funds · {p.free.monthlyCredits.toLocaleString()} credits a month, then bring your own key.</small>
          : <small className="model-group-note">{emptyReason(p.reach)}</small>}
        {freeModels.map(m => <button key={m.id} type="button" role="option" aria-selected={selected(m.id)} className={selected(m.id) ? 'model-option active' : 'model-option'} onClick={() => { setOpen(false); p.onPick(m.id, 'free'); }}>
          <strong>{m.label}{selected(m.id) && <Check size={12} />}</strong>
          <small>{p.free.providers[m.id] ?? 'this deployment'} · free here</small>
        </button>)}
      </div>
      {keyedByProvider.map(({ provider, models }) => {
        const providerName = providers[provider].name;
        const unlocked = canPayFor(provider, p.reach);
        return <div key={provider} className="model-group">
          <span className="model-group-label"><KeyRound size={11} strokeWidth={2} />{providerName} {unlocked ? '· key active' : '· bring your key'}</span>
          {!unlocked && <small className="model-group-note">Add your {providerName} API key in Settings — it unlocks this vendor the moment you type it.</small>}
          {models.map(m => <button key={m.id} type="button" role="option" aria-selected={selected(m.id)} className={`model-option${selected(m.id) ? ' active' : ''}${payable(m) ? '' : ' locked'}`} onClick={() => chooseKeyed(m)}>
            <strong>{m.label}{selected(m.id) && <Check size={12} />}</strong>
            <small>{payable(m) ? (p.inference === 'credits' ? `${m.weight} cr/1K on credits` : 'on your key') : `${m.weight} cr/1K on credits`}</small>
            <span>{m.note}</span>
          </button>)}
        </div>;
      })}
      {nothingOffered && <small className="model-group-note">Nothing here is runnable yet, so the scripted preview below is the one option that works offline.</small>}
      <button type="button" role="option" aria-selected={p.demo} className={p.demo ? 'model-option preview active' : 'model-option preview'} value={PREVIEW} onClick={() => { setOpen(false); p.onPreview(); }}>
        <strong>Scripted preview{p.demo && <Check size={12} />}</strong>
        <small>No AI, no network</small>
        <span>Walk through the workspace with canned text. Works offline.</span>
      </button>
    </div>}
  </div>;
}
