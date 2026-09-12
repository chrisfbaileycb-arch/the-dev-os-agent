import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, Mic, MicOff, Paperclip, Plug, Send, Square, X } from 'lucide-react';
import type { Persona } from '../lib/roster';
import { DIRECT_MODE_LABEL, WORKFLOW_GROUP_LABEL, workflows } from '../lib/roster';
import type { Workflow } from '../lib/types';
import type { Photo } from '../lib/photos';
import type { CatalogModel, InferenceMode } from '../lib/catalog';
import type { Provider } from '../lib/providers';
import type { Reach } from '../lib/availability';
import type { FreeTier } from '../lib/store';
import ModelPicker from './ModelPicker';
import { iconFor } from './icons';

// The prompt dock: a floating bar pinned to the bottom of the conversation, with everything a
// message needs within one reach — agent, mode, model, attachments, voice, connectors.
//
// The textarea grows with the draft up to a ceiling and then scrolls, so a long prompt never
// pushes the send button off screen or swallows the conversation above it.

export type RunMode = 'chat' | Workflow;
export interface Attached { name: string; content: string; }

export interface DockProps {
  draft: string; setDraft: (v: string) => void;
  mode: RunMode; setMode: (m: RunMode) => void;
  persona: Persona; openRoster: () => void;
  attachments: Attached[]; photos: Photo[];
  addFiles: (files: File[]) => void; removeAttachment: (name: string) => void; removePhoto: (name: string) => void;
  openConnectors: () => void; connectorCount: number;
  model: string; inference: InferenceMode; demo: boolean; free: FreeTier; labels: Record<string, string>; reach: Reach; keyed: Set<Provider>;
  pickModel: (id: string, mode?: InferenceMode) => void; pickPreview: () => void; modelNeedsKey: (m: CatalogModel) => void;
  busy: boolean; ready: boolean; send: () => void; stop: () => void;
  listening: boolean; voiceSupported: boolean; toggleVoice: () => void;
  tokens: { draft: number; context: number };
}

const MAX_HEIGHT = 200;

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

  return <div className="dock-shell">
    <div className={dragging ? 'dock dragging' : 'dock'} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {attached > 0 && <div className="dock-attachments">
        {p.photos.map(ph => <span key={ph.name} className="chip photo-chip"><img src={ph.thumb} alt="" width={22} height={22} />{ph.name}<small>{ph.width}×{ph.height}</small><button aria-label={`Remove ${ph.name}`} onClick={() => p.removePhoto(ph.name)}><X size={11} /></button></span>)}
        {p.attachments.map(a => <span key={a.name} className="chip"><Paperclip size={11} />{a.name}<small>{Math.ceil(a.content.length / 4).toLocaleString()} tok</small><button aria-label={`Remove ${a.name}`} onClick={() => p.removeAttachment(a.name)}><X size={11} /></button></span>)}
      </div>}

      <label className="sr-only" htmlFor="draft">Message</label>
      <textarea
        id="draft" ref={area} rows={1} value={p.draft} maxLength={12000} disabled={p.busy}
        placeholder={p.mode === 'chat' ? `Message ${p.persona.name}…` : `Describe the goal for “${workflows[p.mode].label}”…`}
        onChange={e => p.setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (p.draft.trim() && !p.busy && p.ready) p.send(); } }}
        onPaste={e => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); p.addFiles(files); } }}
      />

      {/* One control row. On a phone the chip labels collapse to icons and the row wraps,
          which keeps the draft field full width and the send button under the thumb. */}
      <div className="dock-bar">
        <button className="chip-button" onClick={p.openRoster} title="Choose an agent" disabled={p.busy}><PersonaIcon size={13} strokeWidth={1.75} /><span className="chip-label">{p.persona.name}</span><ChevronDown size={12} /></button>
        {/* Direct chat first and named as such, with the workflows behind a group labelled
            optional. One agent answering you is the normal case; five in sequence is a request. */}
        <label className="chip-select"><select aria-label="Mode" title="Direct chat answers with one agent. A workflow runs five in sequence." value={p.mode} disabled={p.busy} onChange={e => p.setMode(e.target.value as RunMode)}>
          <option value="chat">{DIRECT_MODE_LABEL}</option>
          <optgroup label={WORKFLOW_GROUP_LABEL}>{(Object.keys(workflows) as Workflow[]).map(w => <option key={w} value={w}>{workflows[w].label}</option>)}</optgroup>
        </select><ChevronDown size={12} /></label>
        <ModelPicker model={p.model} inference={p.inference} demo={p.demo} free={p.free} labels={p.labels} reach={p.reach} keyed={p.keyed} disabled={p.busy} onPick={p.pickModel} onPreview={p.pickPreview} onNeedsKey={p.modelNeedsKey} />
        <button className={p.connectorCount ? 'chip-button live' : 'chip-button'} title="Connectors: GitHub, web, documents, MCP" onClick={p.openConnectors} disabled={p.busy}><Plug size={13} strokeWidth={1.75} /><span className="chip-label">Connectors</span>{p.connectorCount ? <em>{p.connectorCount}</em> : null}</button>
        <span className="dock-counters" title="Estimated tokens in your message and in the attached context"><em>{p.tokens.draft.toLocaleString()}</em> draft · <em>{p.tokens.context.toLocaleString()}</em> context</span>
        <span className="dock-send">
          <button className="icon-button" title="Attach a file or photo" aria-label="Attach a file or photo" disabled={p.busy} onClick={() => fileInput.current?.click()}><Paperclip size={16} strokeWidth={1.75} /></button>
          <input ref={fileInput} type="file" className="sr-only" accept=".txt,.md,.csv,.json,.html,image/*" multiple onChange={e => { p.addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <button className={p.listening ? 'icon-button live' : 'icon-button'} title={p.voiceSupported ? (p.listening ? 'Stop listening' : 'Speak your message') : 'Voice input needs Chrome, Edge, or Safari'} aria-label="Voice input" aria-pressed={p.listening} disabled={!p.voiceSupported || p.busy} onClick={p.toggleVoice}>{p.listening ? <MicOff size={16} strokeWidth={1.75} /> : <Mic size={16} strokeWidth={1.75} />}</button>
          {p.busy
            ? <button className="button danger small send" onClick={p.stop}><Square size={13} />Stop</button>
            : <button className="button primary small send" disabled={!p.draft.trim() || !p.ready} onClick={p.send} title={p.mode === 'chat' ? 'Send' : workflows[p.mode].verb}><Send size={14} /><span>{p.mode === 'chat' ? 'Send' : workflows[p.mode].verb}</span></button>}
        </span>
      </div>
    </div>
    <p className="dock-hint">Enter to send · Shift+Enter for a new line · drop a file or photo to attach</p>
  </div>;
}
