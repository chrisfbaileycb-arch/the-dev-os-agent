import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, Mic, MicOff, Paperclip, Send, Square, X } from 'lucide-react';
import type { Persona } from '../lib/roster';
import { workflows } from '../lib/roster';
import type { Workflow } from '../lib/types';
import { iconFor } from './icons';
export type RunMode = 'chat' | Workflow;
export interface Attached { name: string; content: string; }
export interface DockProps { draft: string; setDraft: (v: string) => void; mode: RunMode; setMode: (m: RunMode) => void; persona: Persona; openRoster: () => void; attachments: Attached[]; addFiles: (files: File[]) => void; removeAttachment: (name: string) => void; busy: boolean; ready: boolean; send: () => void; stop: () => void; listening: boolean; voiceSupported: boolean; toggleVoice: () => void; tokens: { draft: number; context: number }; }
export default function Dock(p: DockProps) {
  const [dragging, setDragging] = useState(false); const area = useRef<HTMLTextAreaElement>(null); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const el = area.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 220)}px`; }, [p.draft]);
  function onDrop(e: DragEvent) { e.preventDefault(); setDragging(false); p.addFiles([...e.dataTransfer.files]); }
  const Icon = iconFor(p.persona.icon);
  return <div className={dragging ? 'dock dragging' : 'dock'} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
    {p.attachments.length > 0 && <div className="dock-attachments">{p.attachments.map(a => <span key={a.name} className="chip"><Paperclip size={11} />{a.name}<small>{Math.ceil(a.content.length / 4).toLocaleString()} tok</small><button aria-label={`Remove ${a.name}`} onClick={() => p.removeAttachment(a.name)}><X size={11} /></button></span>)}</div>}
    <label className="sr-only" htmlFor="draft">Message</label>
    <textarea id="draft" ref={area} rows={1} value={p.draft} maxLength={12000} disabled={p.busy} placeholder={p.mode === 'chat' ? `Message ${p.persona.name}… (Enter to send, Shift+Enter for a new line, drop a file to attach)` : `Describe the goal for “${workflows[p.mode].label}”…`} onChange={e => p.setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (p.draft.trim() && !p.busy && p.ready) p.send(); } }} onPaste={e => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); p.addFiles(files); } }} />
    <div className="dock-bar">
      <button className="chip-button" onClick={p.openRoster} title="Choose an agent" disabled={p.busy}><Icon size={13} strokeWidth={1.75} />{p.persona.name}<ChevronDown size={12} /></button>
      <label className="chip-select"><select aria-label="Mode" value={p.mode} disabled={p.busy} onChange={e => p.setMode(e.target.value as RunMode)}><option value="chat">Chat</option>{(Object.keys(workflows) as Workflow[]).map(w => <option key={w} value={w}>{workflows[w].label}</option>)}</select><ChevronDown size={12} /></label>
      <button className="icon-button" title="Attach a text file" aria-label="Attach a text file" disabled={p.busy} onClick={() => input.current?.click()}><Paperclip size={15} strokeWidth={1.75} /></button>
      <input ref={input} type="file" className="sr-only" accept=".txt,.md,.csv,.json,.html" multiple onChange={e => { p.addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <button className={p.listening ? 'icon-button live' : 'icon-button'} title={p.voiceSupported ? (p.listening ? 'Stop listening' : 'Speak your message') : 'Voice input is not available in this browser'} aria-label="Voice input" aria-pressed={p.listening} disabled={!p.voiceSupported || p.busy} onClick={p.toggleVoice}>{p.listening ? <MicOff size={15} strokeWidth={1.75} /> : <Mic size={15} strokeWidth={1.75} />}</button>
      <span className="dock-counters" title="Estimated tokens in your message and in the attached context"><em>{p.tokens.draft.toLocaleString()}</em> draft · <em>{p.tokens.context.toLocaleString()}</em> context</span>
      {p.busy ? <button className="button danger small" onClick={p.stop}><Square size={13} />Stop</button> : <button className="button primary small" disabled={!p.draft.trim() || !p.ready} onClick={p.send}><Send size={13} />{p.mode === 'chat' ? 'Send' : workflows[p.mode].verb}</button>}
    </div>
  </div>;
}
