import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, KeyRound, LoaderCircle, Plug, RefreshCw, Search } from 'lucide-react';
import { findModel, type CatalogModel, type InferenceMode } from '../lib/catalog';
import { providers, type Provider } from '../lib/providers';
import type { Reach } from '../lib/availability';
import { capabilityTier, filterChoices, isDeveloperModel, modelChoices, rankChoices, TIER_LABELS, type ModelChoice } from '../lib/modelChoices';
import { pipeEnabled, type PipeSettings } from '../lib/pipes';
import { keyFingerprint, isFresh, type Discovered } from '../lib/discovered';
import type { PaidTier } from '../lib/deployment';
import type { FreeTier } from '../lib/store';
import { defaultBackends, type BackendAvailability, type Lane, isUsProvider } from '../lib/modelLanes';

export interface ModelPickerProps {
  lane?: Lane;
  backends?: BackendAvailability;
  developer?: boolean;
  /** Trigger caption, so the dock's single control line reads "Model" instead of a second title. */
  label?: string;
  provider?: Provider;
  onOpenSettings: () => void;
  onOpenConnectors?: () => void;
  connectorCount?: number;
  model: string;
  inference: InferenceMode;
  free: FreeTier;
  paid: PaidTier;
  labels: Record<string, string>;
  reach: Reach;
  keyed: Set<Provider>;
  discovered: Discovered;
  discovering: Set<Provider>;
  disabled?: boolean;
  onPick: (model: string, mode?: InferenceMode, provider?: Provider) => void;
  onNeedsKey: (model: CatalogModel) => void;
  onNeedsPlan: (model: ModelChoice) => void;
  onDiscover: (provider: Provider) => void;
  pipes: PipeSettings;
}
export function modelLabel(model: string, labels: Record<string, string> = {}): string { return labels[model] ?? findModel(model)?.label ?? model ?? 'No model'; }
export function payLabel(inference: InferenceMode): string { return inference === 'free' ? 'managed' : inference === 'credits' ? 'plan' : 'your key'; }
type Group = { id: string; name: string; source: 'BYOK' | 'Local' | 'Managed/Membership'; mode: InferenceMode; provider?: Provider; choices: ModelChoice[]; error?: string };
const ORDER: Provider[] = ['ollama', 'openai', 'anthropic', 'google', 'groq', 'xai', 'huggingface-backend', 'huggingface', 'openrouter', 'cerebras', 'github', 'nvidia', 'cohere', 'venice', 'vercel', 'aihubmix', 'xkiro', 'custom'];
export default function ModelPicker(p: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const options = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role=option]') ?? [])];
        const at = options.indexOf(document.activeElement as HTMLButtonElement);
        options[(at + (e.key === 'ArrowDown' ? 1 : options.length - 1) + options.length) % options.length]?.focus();
      }
    };
    document.addEventListener('mousedown', outside); root.current?.addEventListener('keydown', key); search.current?.focus();
    const element = root.current;
    return () => { document.removeEventListener('mousedown', outside); element?.removeEventListener('keydown', key); };
  }, [open]);
  const groups = useMemo<Group[]>(() => {
    const backends = p.backends ?? defaultBackends;
    const available = (provider?: Provider) => provider === 'huggingface-backend' ? backends.huggingface : isUsProvider(provider) ? backends.us : true;
    const eligible = (choices: ModelChoice[]) => rankChoices(choices.filter(m => !p.developer || isDeveloperModel(m.id)));
    const result: Group[] = [];
    if (p.free.enabled) result.push({ id: 'managed', name: 'Managed access', source: 'Managed/Membership', mode: 'free', choices: eligible(modelChoices(p.free.models.filter(id => available(p.free.providers[id] as Provider)).map(id => ({ id, label: p.labels[id] ?? p.free.labels[id] ?? id })))) });
    if (p.reach.credits) result.push({ id: 'membership', name: 'Membership', source: 'Managed/Membership', mode: 'credits', choices: eligible(modelChoices(p.paid.models.filter(id => available(p.paid.providers[id] as Provider)).map(id => ({ id, label: p.labels[id] ?? p.paid.labels[id] ?? id })))) });
    for (const provider of ORDER) {
      if (!available(provider) || !pipeEnabled(provider, p.pipes) || !p.keyed.has(provider)) continue;
      const credential = provider === p.provider && p.reach.token?.trim() ? p.reach.token : p.reach.keys[provider];
      const fingerprint = keyFingerprint(provider === 'ollama' ? p.pipes.ollamaUrl + (credential ?? '') : credential);
      const cache = p.discovered[provider];
      const live = isFresh(cache, Date.now(), fingerprint) ? cache : undefined;
      result.push({ id: provider, name: providers[provider].name, provider, source: provider === 'ollama' ? 'Local' : 'BYOK', mode: 'byok', choices: eligible(modelChoices(live && !live.error ? live.models : [], [], provider)), error: live?.error });
    }
    return result;
  }, [p.backends, p.developer, p.free, p.paid, p.reach, p.labels, p.keyed, p.pipes, p.provider, p.discovered]);
  const count = groups.reduce((n, g) => n + g.choices.length, 0);
  const source = p.inference !== 'byok' ? 'Managed/Membership' : p.provider === 'ollama' ? 'Local' : 'BYOK';
  function choose(g: Group, m: ModelChoice) {
    const provider = g.provider ?? (g.mode === 'free' ? p.free.providers[m.id] : p.paid.providers[m.id]) as Provider;
    p.onPick(m.id, g.mode, provider); setOpen(false); setQuery('');
  }
  return <div className={`model-picker unified-model-picker${open ? ' open' : ''}`} ref={root}>
    <button type="button" className={`dock-control model-trigger${open ? ' open' : ''}`} disabled={p.disabled} aria-haspopup="listbox" aria-expanded={open} aria-label="Model & Source" onClick={() => setOpen(v => !v)}>
      <KeyRound size={13} /><span className="model-trigger-label">{p.label ?? 'Model & Source'}</span><span className="model-name">{p.model ? modelLabel(p.model, p.labels) : 'Choose a model'}</span>{p.model && <em className="pay-badge">[{source}]</em>}<ChevronDown size={12} />
    </button>
    {open && <div className="model-menu">
      <div className="model-lane-head"><strong>Model &amp; Source</strong><small>{p.developer ? 'Developer workspace · coding-capable models' : 'Connected provider catalogs'}</small></div>
      <label className="model-search"><Search size={12} /><input ref={search} type="search" value={query} placeholder={`Search ${count} models`} aria-label="Filter models" onChange={e => setQuery(e.target.value)} /></label>
      <div role="listbox" aria-label="Available models and sources">
        {groups.map(g => {
          const matches = filterChoices(g.choices, query);
          return <div className="model-group" key={g.id}>
            <span className="model-group-label">{g.name} <em>[{g.source}]</em>{g.provider && <button type="button" className="model-refresh" aria-label={`Refresh ${g.name} models`} disabled={p.discovering.has(g.provider)} onClick={() => p.onDiscover(g.provider!)}>{p.discovering.has(g.provider) ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />}</button>}</span>
            {matches.map(m => <button type="button" key={m.id} role="option" aria-selected={p.model === m.id && p.inference === g.mode && (!g.provider || p.provider === g.provider)} className="model-option" onClick={() => choose(g, m)} title={m.id}>
              <strong><span className="model-option-name">{m.label}</span><em className="model-badge">[{g.source}]</em>{p.model === m.id && p.inference === g.mode && (!g.provider || p.provider === g.provider) && <Check size={12} />}</strong><small>{TIER_LABELS[capabilityTier(m.id, m.label)]} · {m.id}</small>
            </button>)}
            {!matches.length && <p className="model-group-note">{g.error || (p.discovering.has(g.provider!) ? 'Discovering available models…' : query ? 'No matching models.' : 'Refresh this provider to load its available models.')}</p>}
          </div>;
        })}
        {!groups.length && <p className="model-group-note">Connect a provider key or local endpoint in Settings to list available models.</p>}
      </div>
      <div className="row gap model-menu-actions"><button className="button small" onClick={() => { setOpen(false); p.onOpenSettings(); }}><KeyRound size={12} />Manage provider keys</button>{p.onOpenConnectors && <button className="button small" onClick={() => { setOpen(false); p.onOpenConnectors?.(); }}><Plug size={12} />Connectors{p.connectorCount ? ` (${p.connectorCount})` : ''}</button>}</div>
    </div>}
  </div>;
}
