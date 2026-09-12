import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, KeyRound, Sparkles, Wallet } from 'lucide-react';
import { findModel, type CatalogModel, type InferenceMode } from '../lib/catalog';
import { providers, type Keyring } from '../lib/providers';
import { GROUPS, emptyReason, reachableModels, unreachableModels, type Reason } from '../lib/availability';
import type { FreeTier } from '../lib/store';

// The model dropdown that lives on the prompt dock.
//
// It lists what this visitor can run *right now* and nothing else — models the deployment funds,
// plus models their own key reaches. It used to list the whole compiled catalog with the rest
// marked "locked", on the reasoning that hiding them would make the free tier look like the
// whole product. That reasoning was wrong in practice: a menu is read top to bottom, and one
// where most entries do not work makes a person check every line to find the four that do.
//
// The rest are not gone. They are one click away under "more", still selectable, and choosing
// one opens Settings for the key it needs rather than failing on send.
//
// Availability comes from lib/availability, shared with the model hub so the two can never
// disagree — and the funded half of it comes from the server, because only the deployment knows
// which provider keys it holds.

export interface ModelPickerProps {
  model: string;
  inference: InferenceMode;
  demo: boolean;
  free: FreeTier;
  keys: Keyring;
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

  const [showAll, setShowAll] = useState(false);
  useEffect(() => { if (!open) setShowAll(false); }, [open]);

  const availability = { free: p.free, keys: p.keys, inference: p.inference };
  const reachable = reachableModels(availability);
  const hidden = unreachableModels(availability);
  const groups = (['free', 'key', 'credits'] as Reason[])
    .map(reason => ({ reason, items: reachable.filter(r => r.reason === reason) }))
    .filter(g => g.items.length);
  const label = (m: CatalogModel) => m.provider === 'custom' ? 'this deployment' : providers[m.provider].name;

  function choose(m: CatalogModel, ok: boolean) {
    setOpen(false);
    if (ok) p.onPick(m.id); else p.onNeedsKey(m);
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
      {groups.map(g => <div key={g.reason} className="model-group">
        <span className="model-group-label">{g.reason === 'free' ? <Sparkles size={11} strokeWidth={2} /> : g.reason === 'credits' ? <Wallet size={11} strokeWidth={2} /> : <KeyRound size={11} strokeWidth={2} />}{GROUPS[g.reason].label}</span>
        <small className="model-group-note">{GROUPS[g.reason].note}</small>
        {g.items.map(({ model: m }) => <button key={m.id} type="button" role="option" aria-selected={current?.id === m.id && !p.demo} className={`model-option${current?.id === m.id && !p.demo ? ' active' : ''}`} onClick={() => choose(m, true)}>
          <strong>{m.label}{current?.id === m.id && !p.demo && <Check size={12} />}</strong>
          <small>{label(m)} · ready now</small>
          <span>{m.note}</span>
        </button>)}
      </div>)}
      {!groups.length && <div className="model-group"><small className="model-group-note">{emptyReason(availability)}</small></div>}
      {hidden.length > 0 && <div className="model-group">
        <button type="button" className="link-button model-more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
          {showAll ? 'Hide' : `${hidden.length} more`} that need a key
        </button>
        {showAll && hidden.map(m => <button key={m.id} type="button" role="option" aria-selected={false} className="model-option locked" onClick={() => choose(m, false)}>
          <strong>{m.label}</strong>
          <small>{label(m)} · add that key to unlock</small>
          <span>{m.note}</span>
        </button>)}
      </div>}
      <button type="button" role="option" aria-selected={p.demo} className={p.demo ? 'model-option preview active' : 'model-option preview'} value={PREVIEW} onClick={() => { setOpen(false); p.onPreview(); }}>
        <strong>Scripted preview{p.demo && <Check size={12} />}</strong>
        <small>No AI, no network</small>
        <span>Walk through the workspace with canned text. Works offline.</span>
      </button>
    </div>}
  </div>;
}
