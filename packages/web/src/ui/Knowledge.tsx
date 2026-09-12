import { useRef, useState } from 'react';
import { Database, Plus, Search, Trash2 } from 'lucide-react';
import type { Knowledge } from '../lib/types';
export default function KnowledgeHub({ knowledge, busy, save, remove, notify }: { knowledge: Knowledge[]; busy: boolean; save: (doc: Knowledge) => Promise<void>; remove: (id: string) => Promise<void>; notify: (s: string) => void }) {
  const [title, setTitle] = useState(''); const [content, setContent] = useState(''); const [search, setSearch] = useState(''); const input = useRef<HTMLInputElement>(null);
  async function submit() {
    if (!title.trim() || !content.trim()) { notify('Give your note a title and some content.'); return; }
    if (knowledge.length >= 100) { notify('Knowledge hub limit: 100 notes. Remove an old note first.'); return; }
    try { await save({ id: crypto.randomUUID(), title: title.trim().slice(0, 120), content: content.slice(0, 50000), createdAt: new Date().toISOString() }); setTitle(''); setContent(''); notify('Note saved in this browser.'); } catch (e) { notify(e instanceof Error ? e.message : 'Could not save the note.'); }
  }
  async function importFile(file?: File) {
    if (!file) return; if (!/\.(txt|md|csv|json)$/i.test(file.name) || file.size > 200_000) { notify('Choose a text, Markdown, CSV, or JSON file smaller than 200 KB.'); return; }
    try { const text = await file.text(); setTitle(file.name); setContent(text.slice(0, 50000)); notify(text.length > 50000 ? 'File loaded and trimmed to 50,000 characters. Review it, then save.' : 'File loaded into the editor. Review it, then save.'); } catch (e) { notify(e instanceof Error ? e.message : 'Could not read the file.'); }
  }
  const shown = knowledge.filter(d => `${d.title} ${d.content}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page">
    <div className="page-head"><div><h1>Knowledge hub</h1><p>Notes and documents that stay on this device. Matching passages are retrieved by keyword and attached to each message or run.</p></div><button className="button small" onClick={() => input.current?.click()}><Plus size={13} />Import file</button><input ref={input} type="file" className="sr-only" accept=".txt,.md,.csv,.json" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></div>
    <div className="two-col">
      <section className="panel"><h2>Add a note</h2><label>Title<input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="Menu, hours, pricing, brand voice…" /></label><label>Content<textarea value={content} maxLength={50000} rows={10} onChange={e => setContent(e.target.value)} placeholder="Paste the context your agents should know." /></label><p className="help">Stored in IndexedDB in this browser only; never sent to the server store. Matching excerpts go to your model provider only with a message you send. Do not add passwords or card numbers.</p><button className="button primary small" onClick={() => void submit()} disabled={busy}><Plus size={13} />Save note</button></section>
      <section>
        <div className="search"><Search size={14} /><input aria-label="Search notes" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes…" /></div>
        {shown.map(d => <article className="note" key={d.id}><div className="note-head"><h3>{d.title}</h3><button className="icon-button" disabled={busy} aria-label={`Delete ${d.title}`} onClick={() => void remove(d.id)}><Trash2 size={14} /></button></div><p>{d.content.slice(0, 240)}{d.content.length > 240 ? '…' : ''}</p><small>{d.content.length.toLocaleString()} characters · {new Date(d.createdAt).toLocaleDateString()}</small></article>)}
        {!knowledge.length && <div className="empty"><Database size={22} strokeWidth={1.5} /><p>Nothing saved yet. A menu, a price list, or a brand voice note goes a long way.</p></div>}
      </section>
    </div>
  </div>;
}
