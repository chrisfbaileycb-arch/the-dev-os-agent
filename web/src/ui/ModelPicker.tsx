import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, KeyRound, Sparkles, Wallet } from 'lucide-react';
import { catalog, findModel, type CatalogModel, type InferenceMode } from '../lib/catalog';
import { providers } from '../lib/providers';
import type { FreeTier } from '../lib/store';

// The model dropdown that lives on the prompt dock.
//
// It sorts models by what a visitor can actually run *right now*, not by vendor: the zero-config
// group first, live and needing nothing, then the models that need a key. A locked entry is
// still shown and still selectable — picking one opens Settings rather than silently failing —
// because hiding them would make the free tier look like the whole product.

export interface ModelPickerProps {
  model: string;
  inference: InferenceMode;
  demo: boolean;
  free: FreeTier;
  hasKey: boolean;
  disabled?: boolean;
  onPick: (model: string) => void;
  onPreview: () => void;
  onNeedsKey: (model: CatalogModel) => void;
}

const PREVIEW = '__preview__';

export function modelLabel(model: string, demo: boolean): string {
  if (demo) return 'Scripted preview';
  return findModel(model)?.label ?? model ?? 'No model';
}

/** The one-word badge next to the model name: how this run gets paid for. */
export function payLabel(inference: InferenceMode, demo: boolean): string {
  if (demo) return 'offline';
  return inference === 'free' ? 'free' : inference === 'credits' ? 'credits' : 'your key';
}

export default function ModelPicker(p: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = findModel(p.model);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const live = (m: CatalogModel) => Boolean(m.zeroConfig && p.free.enabled && p.free.models.includes(m.id));
  const zeroConfig = catalog.filter(m => m.zeroConfig);
  const keyed = catalog.filter(m => !m.zeroConfig);

  function choose(m: CatalogModel) {
    setOpen(false);
    if (live(m) || p.hasKey || p.inference === 'credits') p.onPick(m.id);
    else if (m.zeroConfig) p.onNeedsKey(m); // free tier is off on this deployment
    else p.onNeedsKey(m);
  }

  const badge = p.demo ? 'offline' : p.inference === 'free' ? 'free' : p.inference === 'credits' ? 'credits' : 'your key';
  return <div className="model-picker" ref={root}>
    <button type="button" className={open ? 'chip-button model-trigger open' : 'chip-button model-trigger'} disabled={p.disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)} title="Choose a model">
      {p.inference === 'free' && !p.demo ? <Sparkles size={13} strokeWidth={1.75} /> : p.inference === 'credits' ? <Wallet size={13} strokeWidth={1.75} /> : <KeyRound size={13} strokeWidth={1.75} />}
      <span className="model-name">{modelLabel(p.model, p.demo)}</span>
      <em className={`pay-badge ${p.demo ? 'offline' : p.inference}`}>{badge}</em>
      <ChevronDown size={12} />
    </button>
    {open && <div className="model-menu" role="listbox" aria-label="Model">
      <div className="model-group">
        <span className="model-group-label"><Sparkles size={11} strokeWidth={2} />Free · no key needed</span>
        {p.free.enabled
          ? <small className="model-group-note">{p.free.monthlyCredits.toLocaleString()} credits a month on this deployment, then bring your own key.</small>
          : <small className="model-group-note">This deployment has no server keys configured, so free models are unavailable here.</small>}
        {zeroConfig.map(m => <button key={m.id} type="button" role="option" aria-selected={current?.id === m.id && !p.demo} className={`model-option${current?.id === m.id && !p.demo ? ' active' : ''}${live(m) ? '' : ' locked'}`} onClick={() => choose(m)}>
          <strong>{m.label}{current?.id === m.id && !p.demo && <Check size={12} />}</strong>
          <small>{providers[m.provider].name} · {live(m) ? 'ready now' : 'not funded here'}</small>
          <span>{m.note}</span>
        </button>)}
      </div>
      <div className="model-group">
        <span className="model-group-label"><KeyRound size={11} strokeWidth={2} />Deep reasoning · your key</span>
        <small className="model-group-note">{p.hasKey ? 'Billed by your provider; no credits are drawn.' : 'Add an OpenRouter, Groq, or custom key in Settings to unlock these.'}</small>
        {keyed.map(m => <button key={m.id} type="button" role="option" aria-selected={current?.id === m.id && !p.demo} className={`model-option${current?.id === m.id && !p.demo ? ' active' : ''}${p.hasKey || p.inference === 'credits' ? '' : ' locked'}`} onClick={() => choose(m)}>
          <strong>{m.label}{current?.id === m.id && !p.demo && <Check size={12} />}</strong>
          <small>{providers[m.provider].name} · {m.weight} cr/1K on credits</small>
          <span>{m.note}</span>
        </button>)}
      </div>
      <button type="button" role="option" aria-selected={p.demo} className={p.demo ? 'model-option preview active' : 'model-option preview'} value={PREVIEW} onClick={() => { setOpen(false); p.onPreview(); }}>
        <strong>Scripted preview{p.demo && <Check size={12} />}</strong>
        <small>No AI, no network</small>
        <span>Walk through the workspace with canned text. Works offline.</span>
      </button>
    </div>}
  </div>;
}
