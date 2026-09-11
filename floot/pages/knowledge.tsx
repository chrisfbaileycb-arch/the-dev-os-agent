import React, { useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { toast } from "sonner";
import { Plus, Search, Trash2, Database } from "lucide-react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { Skeleton } from "../components/Skeleton";
import { useNotes } from "../helpers/useNotes";
import styles from "./knowledge.module.css";

export default function KnowledgePage() {
  const { query, notes, save, remove } = useNotes();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [search, setSearch] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function saveNote() {
    if (!title.trim() || !content.trim()) { toast.error("Give your note a title and some content."); return; }
    try {
      await save.mutateAsync({ id: crypto.randomUUID(), title: title.trim().slice(0, 120), content: content.slice(0, 50_000) });
      setTitle(""); setContent(""); toast.success("Note saved in this browser.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save the note."); }
  }

  async function importText(file?: File) {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 100_000) { toast.error("Choose a Markdown or text file smaller than 100 KB."); return; }
    try {
      const text = await file.text();
      if (text.length > 50_000) throw new Error("Notes are limited to 50,000 characters.");
      setTitle(file.name); setContent(text); toast("File loaded into the editor. Review it, then save the note.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not read the file."); }
  }

  const filtered = notes.filter((d) => `${d.title} ${d.content}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <Helmet><title>Knowledge - Hey Buddy</title></Helmet>
      <div className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>Context that stays with you</span>
          <h1 className={styles.h1}>Knowledge for your team.</h1>
          <p className={styles.lede}>Save notes. Matching passages are retrieved by keyword and given to the agents as untrusted reference data.</p>
        </div>
        <Button variant="outline" onClick={() => fileInput.current?.click()}><Plus size={15} />Import text</Button>
        <input className={styles.srOnly} type="file" accept=".txt,.md" ref={fileInput} onChange={(e) => { void importText(e.target.files?.[0]); e.target.value = ""; }} aria-label="Import a text or Markdown file" />
      </div>
      <div className={styles.layout}>
        <section className={styles.panel} aria-labelledby="note-form-title">
          <h2 id="note-form-title" className={styles.h2}>Add a workspace note</h2>
          <label className={styles.field}><span>Title</span><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Project requirements, product context" /></label>
          <label className={styles.field}><span>Content</span><Textarea value={content} maxLength={50_000} rows={9} onChange={(e) => setContent(e.target.value)} placeholder="Add useful context for your agents." /></label>
          <p className={styles.help}>Stored in this browser using IndexedDB. Matching excerpts are sent to your provider only when you approve a hosted run. Do not add passwords or secrets.</p>
          <Button onClick={() => void saveNote()} disabled={save.isPending}>Save note<Plus size={15} /></Button>
        </section>
        <section className={styles.list} aria-label="Saved notes">
          <div className={styles.search}><Search size={15} strokeWidth={1.75} /><Input aria-label="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your notes" /></div>
          {query.isPending ? (
            <div className={styles.skeletons}><Skeleton className={styles.skeleton} /><Skeleton className={styles.skeleton} /></div>
          ) : filtered.length ? filtered.map((d) => (
            <article className={styles.note} key={d.id}>
              <div className={styles.noteTop}><h3 className={styles.h3}>{d.title}</h3><Button variant="ghost" size="icon-sm" aria-label={`Delete ${d.title}`} disabled={remove.isPending} onClick={() => remove.mutate({ id: d.id }, { onError: (e) => toast.error(e.message) })}><Trash2 size={15} /></Button></div>
              <p className={styles.excerpt}>{d.content.slice(0, 260)}{d.content.length > 260 ? "..." : ""}</p>
              <small className={styles.meta}>{d.content.length.toLocaleString()} characters / {new Date(d.createdAt).toLocaleDateString()}</small>
            </article>
          )) : (
            <div className={styles.empty}><Database size={26} strokeWidth={1.5} /><h3 className={styles.h3}>{notes.length ? "No notes match that search." : "A little context goes a long way."}</h3><p className={styles.help}>{notes.length ? "Try a different word." : "Save a note on the left. The researcher reads the closest matches on every run."}</p></div>
          )}
        </section>
      </div>
    </>
  );
}
