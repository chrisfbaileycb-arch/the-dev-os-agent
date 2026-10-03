import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, Code2, FolderOpen, ListChecks, MessageSquare, Mic, MicOff, Paperclip, Plug, Send, Square, X } from 'lucide-react';
import type { Persona, WorkMode } from '../lib/roster';
import { WORK_MODES, workflows } from '../lib/roster';
import type { Workflow } from '../lib/types';
import type { Photo } from '../lib/photos';
import type { CatalogModel, InferenceMode } from '../lib/catalog';
import type { Provider } from '../lib/providers';
import type { Reach } from '../lib/availability';
import type { FreeTier } from '../lib/store';
import type { PaidTier } from '../lib/deployment';
import type { Discovered } from '../lib/discovered';
import type { ModelChoice } from '../lib/modelChoices';
import type { PipeSettings } from '../lib/pipes';
import ModelPicker from './ModelPicker';
import { GithubMark } from './GithubMark';
import { iconFor } from './icons';

// The prompt dock: a solid bar pinned to the bottom of the conversation, above the status bar,
// with everything a message needs within one reach — how you are working, agent, model,
// attachments, voice, connectors.
//
// The first control is the work mode (see WORK_MODES in lib/roster.ts): Chat, Build, or Plan. It
// replaces a dropdown that mixed "Direct chat" with three workflow verbs, and it decides the rest
// of the bar — Build binds the Coder / Builder agent, so no agent chip is shown; Plan shows which
// kind of plan to run. The sentence under the bar always says what the current mode will do.
//
// The textarea grows with the draft up to a ceiling and then scrolls, so a long prompt never
// pushes the send button off screen or swallows the conversation above it.

/** What actually runs: a single chat turn, or one of the multi-phase workflows. */
export type RunMode = 'chat' | Workflow;
export interface Attached { name: string; content: string; }

export interface DockProps {
  draft: string; setDraft: (v: string) => void;
  workMode: WorkMode; setWorkMode: (m: WorkMode) => void;
  plan: Workflow; setPlan: (w: Workflow) => void;
  persona: Persona; openRoster: () => void;
  attachments: Attached[]; photos: Photo[];
  addFiles: (files: File[]) => void; removeAttachment: (name: string) => void; removePhoto: (name: string) => void;
  openConnectors: () => void; connectorCount: number; openGithubPull: () => void;
  model: string; provider?: Provider; inference: InferenceMode; free: FreeTier; paid: PaidTier; labels: Record<string, string>; reach: Reach; keyed: Set<Provider>;
  /** Save (or, with '', forget) a provider key typed into a model dropdown. Browser storage only. */
  saveProviderKey: (provider: Provider, key: string) => void;
  discovered: Discovered; discovering: Set<Provider>; pipes: PipeSettings;
  pickModel: (id: string, mode?: InferenceMode, provider?: Provider) => void; modelNeedsKey: (model: CatalogModel) => void; modelNeedsPlan: (model: ModelChoice) => void; discover: (provider: Provider) => void;
  busy: boolean; ready: boolean; send: () => void; stop: () => void;
  listening: boolean; voiceSupported: boolean; toggleVoice: () => void;
  tokens: { draft: number; context: number };
  truncated?: boolean;
  onContinue?: () => void;
}

const MAX_HEIGHT = 200;
const MODE_ICONS: Record<WorkMode, typeof MessageSquare> = { chat: MessageSquare, build: Code2, plan: ListChecks };
const SEND_LABEL: Record<WorkMode, string> = { chat: 'Send', build: 'Build', plan: 'Start plan' };

export default function Dock(p: DockProps) {
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Auto-expand: reset to a single row, then grow to the content up to the ceiling.
  useEffect(() => {
    const el = area.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [p.draft]);

  function onDrop(e: DragEvent) { e.preventDefault(); setDragging(false); p.addFiles([...e.dataTransfer.files]); }
  const PersonaIcon = iconFor(p.persona.icon);
  const attached = p.attachments.length + p.photos.length;
  const placeholder = p.listening ? 'Listening… speak your message'
    : p.workMode === 'build' ? 'Describe the app or the change to build…'
      : p.workMode === 'plan' ? `Describe the goal for a ${workflows[p.plan].label.toLowerCase()}…`
        : `Message ${p.persona.name}…`;

  return <div className="dock-shell">
    <div className={dragging ? 'dock dragging' : 'dock'} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {attached > 0 && <div className="dock-attachments">
        {p.photos.map(ph => <span key={ph.name} className="chip photo-chip"><img src={ph.thumb} alt="" width={22} height={22} />{ph.name}<small>{ph.width}×{ph.height}</small><button aria-label={`Remove ${ph.name}`} onClick={() => p.removePhoto(ph.name)}><X size={11} /></button></span>)}
        {p.attachments.map(a => <span key={a.name} className="chip"><Paperclip size={11} />{a.name}<small>{Math.ceil(a.content.length / 4).toLocaleString()} tok</small><button aria-label={`Remove ${a.name}`} onClick={() => p.removeAttachment(a.name)}><X size={11} /></button></span>)}
      </div>}
      {p.truncated && !p.busy && <div className="dock-continuation" role="status">
        <span>Response was cut off by token limit.</span>
        <button type="button" className="button small primary continuation-btn" onClick={p.onContinue}>
          Continue from where you left off
        </button>
      </div>}

      {/* The input row: attach on the left, the draft in the middle, voice and send on the right —
          the three things a message needs, one reach from where you type. */}
      <div className="dock-input">
        <button className="icon-button dock-attach" title="Attach a file or photo" aria-label="Attach a file or photo" disabled={p.busy} onClick={() => fileInput.current?.click()}><FolderOpen size={16} strokeWidth={1.75} /></button>
        <button className="icon-button dock-attach" title="Pull a file from GitHub" aria-label="Pull a file from GitHub" disabled={p.busy} onClick={p.openGithubPull}><GithubMark size={16} strokeWidth={1.75} /></button>
        <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept=".txt,.md,.csv,.json,.html,image/*" multiple onChange={e => { p.addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <label className="sr-only" htmlFor="draft">Message</label>
        <textarea
          id="draft" ref={area} rows={1} value={p.draft} maxLength={12000} disabled={p.busy}
          placeholder={placeholder}
          onChange={e => p.setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (p.draft.trim() && !p.busy && p.ready) p.send(); } }}
          onPaste={e => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); p.addFiles(files); } }}
        />
        <span className="dock-send">
          <button className={p.listening ? 'icon-button mic recording' : 'icon-button mic'} title={p.voiceSupported ? (p.listening ? 'Stop recording' : 'Talk to speak') : 'Voice input needs Chrome, Edge, or Safari'} aria-label={p.listening ? 'Stop recording' : 'Talk to speak'} aria-pressed={p.listening} disabled={!p.voiceSupported || p.busy} onClick={p.toggleVoice}>{p.listening ? <MicOff size={16} strokeWidth={1.75} /> : <Mic size={16} strokeWidth={1.75} />}</button>
          {p.busy
            ? <button className="button danger small send" onClick={p.stop}><Square size={13} />Stop</button>
            : <button className="button primary small send" disabled={!p.draft.trim() || !p.ready} onClick={p.send} title={WORK_MODES[p.workMode].description}><Send size={14} /><span>{SEND_LABEL[p.workMode]}</span></button>}
        </span>
      </div>
      {p.listening && <p className="dock-recording" role="status"><span className="rec-dot" />Recording — click the mic again to stop</p>}

      {/* One control row. On a phone the chip labels collapse to icons and the row wraps. */}
      <div className="dock-bar">
        <span className="segmented work-modes" role="radiogroup" aria-label="How to work">
          {(Object.keys(WORK_MODES) as WorkMode[]).map(m => { const Icon = MODE_ICONS[m]; return <button key={m} role="radio" aria-checked={p.workMode === m} className={p.workMode === m ? 'active' : ''} title={`${WORK_MODES[m].label}: ${WORK_MODES[m].description}`} disabled={p.busy} onClick={() => p.setWorkMode(m)}><Icon size={12} strokeWidth={1.9} /><span className="chip-label">{WORK_MODES[m].short}</span></button>; })}
        </span>
        {p.workMode === 'plan' && <label className="chip-select"><select aria-label="Plan type" title="What kind of plan to run" value={p.plan} disabled={p.busy} onChange={e => p.setPlan(e.target.value as Workflow)}>
          {(Object.keys(workflows) as Workflow[]).map(w => <option key={w} value={w}>{workflows[w].label}</option>)}
        </select><ChevronDown size={12} /></label>}
        {p.workMode !== 'build' && <button className="chip-button" onClick={p.openRoster} title={p.workMode === 'plan' ? 'Choose the agent that leads the plan' : 'Choose an agent'} disabled={p.busy}><PersonaIcon size={13} strokeWidth={1.75} /><span className="chip-label">{p.persona.name}</span><ChevronDown size={12} /></button>}
        {/* Two dropdowns, one per lane (lib/modelLanes.ts): US models, and everything else on your own key. */}
        {(['us', 'own'] as const).map(lane => <ModelPicker key={lane} lane={lane} provider={p.provider} onSaveKey={p.saveProviderKey} model={p.model} inference={p.inference} free={p.free} paid={p.paid} labels={p.labels} reach={p.reach} keyed={p.keyed} discovered={p.discovered} discovering={p.discovering} pipes={p.pipes} disabled={p.busy} onPick={p.pickModel} onNeedsKey={p.modelNeedsKey} onNeedsPlan={p.modelNeedsPlan} onDiscover={p.discover} />)}
        <button className={p.connectorCount ? 'chip-button live' : 'chip-button'} title="Connectors: GitHub, web, documents, MCP, model providers" onClick={p.openConnectors} disabled={p.busy}><Plug size={13} strokeWidth={1.75} /><span className="chip-label">Connectors</span>{p.connectorCount ? <em>{p.connectorCount}</em> : null}</button>
        <span className="dock-counters" title="Estimated tokens in your message and in the attached context"><em>{p.tokens.draft.toLocaleString()}</em> draft · <em>{p.tokens.context.toLocaleString()}</em> context</span>
      </div>
    </div>
    <p className="dock-hint"><strong>{WORK_MODES[p.workMode].label}</strong> — {WORK_MODES[p.workMode].description} Enter to send · Shift+Enter for a new line.</p>
  </div>;
}
