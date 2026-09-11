import React, { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, ArrowUpRight, Boxes, Search, ShieldCheck, Sparkles, Square, Workflow as WorkflowIcon, Layers3, Network, Database, Globe2, Paperclip, ImagePlus, Mic, MicOff, Plug, X, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { Button } from "../components/Button";
import { Textarea } from "../components/Textarea";
import { Input } from "../components/Input";
import { Switch } from "../components/Switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/Select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/Dialog";
import { RunPanel } from "../components/RunPanel";
import { agentRoles } from "../helpers/agentRoles";
import { executeRun } from "../helpers/executeRun";
import { exportRun } from "../helpers/exportRun";
import { useConnection } from "../helpers/useConnection";
import { useNotes } from "../helpers/useNotes";
import { useRuns } from "../helpers/useRuns";
import { useMcpServers } from "../helpers/useMcpServers";
import { useVoiceInput } from "../helpers/useVoiceInput";
import { attachments as attach, type TextAttachment, type PhotoAttachment } from "../helpers/attachments";
import { providerCatalog } from "../helpers/providerCatalog";
import type { Run, Workflow } from "../helpers/runTypes";
import styles from "./_index.module.css";

const MAX_FILES = 6;
const MAX_PHOTOS = 5;

function download(name: string, body: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const signature = (run: Run) => run.steps.map((s) => `${s.status}:${s.attempts}`).join("|") + run.status;

export default function WorkspacePage() {
  const { connection } = useConnection();
  const { notes } = useNotes();
  const { runs, save } = useRuns();
  const mcp = useMcpServers();
  const [params, setParams] = useSearchParams();
  const [goal, setGoal] = useState("");
  const [workflow, setWorkflow] = useState<Workflow>("build");
  const [run, setRun] = useState<Run | null>(null);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [files, setFiles] = useState<TextAttachment[]>([]);
  const [photos, setPhotos] = useState<PhotoAttachment[]>([]);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpForm, setMcpForm] = useState({ name: "", url: "", token: "", saveToken: false });
  const [mcpBusy, setMcpBusy] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const lastSaved = useRef("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const voice = useVoiceInput(
    (text) => setGoal((g) => (g.trim() ? `${g.replace(/\s+$/, "")} ${text}` : text)),
    (message) => toast.error(message),
  );

  const viewId = params.get("run");
  const viewed = !run && viewId ? runs.find((r) => r.id === viewId) ?? null : null;
  const shown = run ?? viewed;

  useEffect(() => {
    if (!busy) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [busy]);
  useEffect(() => () => controller.current?.abort(new DOMException("Left the page", "AbortError")), []);

  function persist(snapshot: Run, force = false) {
    const sig = signature(snapshot);
    if (!force && sig === lastSaved.current) return;
    lastSaved.current = sig;
    save.mutate(snapshot, { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the run.") });
  }

  async function addFiles(list: FileList | File[] | null | undefined) {
    const incoming = Array.from(list ?? []);
    if (!incoming.length || busy) return;
    setReading(true);
    let nextFiles = files.length;
    let nextPhotos = photos.length;
    for (const file of incoming) {
      try {
        if (attach.isImage(file)) {
          if (nextPhotos >= MAX_PHOTOS) { toast.error(`Up to ${MAX_PHOTOS} photos per run.`); continue; }
          const photo = await attach.readPhoto(file);
          setPhotos((p) => [...p, photo]); nextPhotos += 1;
        } else {
          if (nextFiles >= MAX_FILES) { toast.error(`Up to ${MAX_FILES} files per run.`); continue; }
          const text = await attach.readText(file);
          setFiles((f) => [...f, text]); nextFiles += 1;
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not read ${file.name}.`);
      }
    }
    setReading(false);
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.files ?? []);
    if (!items.length) return;
    e.preventDefault();
    void addFiles(items);
  }

  function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault(); setDragging(false);
    void addFiles(e.dataTransfer?.files);
  }

  async function start() {
    setConfirmOpen(false);
    if (busy) return;
    const trimmed = goal.trim();
    if (!trimmed) { toast.error("Enter a goal first."); return; }
    if (voice.listening) voice.toggle();
    setBusy(true); setSelectedStep(null); lastSaved.current = "";
    if (viewId) setParams({});
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    try {
      const final = await executeRun(
        {
          runId: crypto.randomUUID(), goal: trimmed, workflow, connection, knowledge: notes,
          attachments: files.map((f) => ({ name: f.name, content: f.content })),
          photos: photos.map((p) => ({ name: p.name, dataUrl: p.dataUrl })),
          tools: mcp.toolSpecs(),
        },
        ac.signal,
        (snapshot) => { setRun(snapshot); persist(snapshot); },
      );
      setRun(final); persist(final, true);
      if (final.status === "failed") toast.error(final.steps.find((s) => s.error)?.error ?? "Provider run failed. Check your key and model in Settings.");
      else if (final.status === "cancelled") toast("Run stopped.");
      else toast.success(final.mode === "demo" ? "Scripted preview finished. Connect a provider for real output." : "Run complete.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The workflow could not start.");
    } finally {
      setBusy(false); controller.current = null;
    }
  }

  function requestRun() {
    if (!goal.trim()) { toast.error("Enter a goal first."); return; }
    if (reading) { toast.error("Still reading your attachments. One moment."); return; }
    if (connection.mode === "remote") {
      if (!connection.model.trim()) { toast.error("Choose a model in Settings before launching a hosted run."); return; }
      if (connection.provider !== "custom" && !connection.apiKey.trim()) { toast.error("Add your provider API key in Settings. Keys stay in this browser session."); return; }
      if (photos.length && connection.provider === "cohere") { toast.error("Photos need a vision model on OpenRouter or Groq. Remove the photos or switch providers in Settings."); return; }
      setConfirmOpen(true);
      return;
    }
    void start();
  }

  async function connectMcp(e: React.FormEvent) {
    e.preventDefault();
    if (!/^https:\/\//i.test(mcpForm.url.trim())) { toast.error("Enter an https:// MCP server URL."); return; }
    setMcpBusy("new");
    try {
      const server = await mcp.add(mcpForm);
      if (server.error) toast.error(`${server.name}: ${server.error}`);
      else toast.success(`${server.name}: ${server.tools.length} tool${server.tools.length === 1 ? "" : "s"} available.`);
      setMcpForm({ name: "", url: "", token: "", saveToken: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not connect to that server.");
    } finally { setMcpBusy(null); }
  }

  const endpointLabel = connection.provider === "custom" ? connection.endpoint || "your custom endpoint" : providerCatalog[connection.provider].endpoint;
  const attachedCount = files.length + photos.length;
  const toolCount = mcp.enabledToolCount;

  return (
    <>
      <Helmet><title>Workspace - Hey Buddy</title></Helmet>
      <div className={styles.pageHeading}>
        <div>
          <div className={styles.eyebrow}><span className={styles.miniLine} aria-hidden="true" />Hey Buddy</div>
          <h1 className={styles.h1}>Big ideas. A whole team behind you.</h1>
          <p className={styles.lede}>One goal. Five specialists. A more thoughtful result.</p>
        </div>
        <span className={styles.editionBadge}><Globe2 size={14} strokeWidth={1.75} />Browser edition</span>
      </div>

      <section className={styles.composer} aria-labelledby="composer-title">
        <div className={styles.composerHeading}>
          <span className={styles.sparkBox}><Sparkles size={17} strokeWidth={1.75} /></span>
          <div>
            <h2 id="composer-title" className={styles.h2}>What would you like to accomplish?</h2>
            <p className={styles.muted}>Give your team a goal. Attach files or photos, speak it, or connect MCP tools.</p>
          </div>
        </div>
        <label className={styles.srOnly} htmlFor="goal">Your goal</label>
        <Textarea
          id="goal" value={goal} maxLength={12000} disabled={busy} rows={5}
          onChange={(e) => setGoal(e.target.value)}
          onPaste={onPaste} onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          placeholder="Describe a problem, explore an idea, or plan your next project. Drop files or photos here."
          className={`${styles.goal} ${dragging ? styles.goalDrop : ""}`}
        />

        {attachedCount > 0 && (
          <ul className={styles.chips} aria-label="Attachments">
            {photos.map((p, i) => (
              <li key={`p-${i}`} className={styles.photoChip}>
                <img src={p.thumb} alt={p.name} width={40} height={40} />
                <span className={styles.chipName}>{p.name}</span>
                <button type="button" className={styles.chipRemove} aria-label={`Remove ${p.name}`} disabled={busy} onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}><X size={12} /></button>
              </li>
            ))}
            {files.map((f, i) => (
              <li key={`f-${i}`} className={styles.chip}>
                <Paperclip size={12} strokeWidth={1.75} />
                <span className={styles.chipName}>{f.name}</span>
                <small>{Math.max(1, Math.round(f.content.length / 1024))} KB</small>
                <button type="button" className={styles.chipRemove} aria-label={`Remove ${f.name}`} disabled={busy} onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}><X size={12} /></button>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.dock} role="toolbar" aria-label="Composer tools">
          <input ref={fileInput} type="file" accept=".txt,.md,.csv,.json,.html" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          <Button type="button" variant="outline" size="sm" disabled={busy || reading} onClick={() => fileInput.current?.click()} title="Attach text, Markdown, CSV, JSON, or HTML files">
            {reading ? <Loader2 size={14} className={styles.spin} /> : <Paperclip size={14} strokeWidth={1.75} />}Attach files
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy || reading} onClick={() => photoInput.current?.click()} title="Add photos (sent to a vision model)">
            <ImagePlus size={14} strokeWidth={1.75} />Add photos
          </Button>
          <Button
            type="button" variant={voice.listening ? "destructive" : "outline"} size="sm" disabled={busy || !voice.supported}
            onClick={voice.toggle} aria-pressed={voice.listening}
            title={voice.supported ? (voice.listening ? "Stop listening" : "Dictate your goal") : "Voice input needs Chrome, Edge, or Safari."}
          >
            {voice.listening ? <MicOff size={14} strokeWidth={1.75} /> : <Mic size={14} strokeWidth={1.75} />}{voice.listening ? "Listening..." : "Microphone"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setMcpOpen(true)} title="Connect MCP servers">
            <Plug size={14} strokeWidth={1.75} />MCP servers{toolCount > 0 && <span className={styles.badge}>{toolCount}</span>}
          </Button>
        </div>

        <div className={styles.composerFooter}>
          <div className={styles.composerOptions}>
            <Select value={workflow} onValueChange={(v) => setWorkflow(v as Workflow)} disabled={busy}>
              <SelectTrigger className={styles.workflowSelect} aria-label="Workflow"><WorkflowIcon size={14} strokeWidth={1.75} /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="build">Build workflow</SelectItem>
                <SelectItem value="research">Research workflow</SelectItem>
                <SelectItem value="review">Review workflow</SelectItem>
              </SelectContent>
            </Select>
            <span className={styles.modelLabel}><span className={connection.mode === "demo" ? styles.dotIdle : styles.dotLive} aria-hidden="true" />{connection.mode === "demo" ? "Scripted preview" : connection.model || "Select a model"}</span>
          </div>
          {busy ? (
            <Button variant="destructive" onClick={() => controller.current?.abort(new DOMException("Stopped by user", "AbortError"))}><Square size={14} />Stop run</Button>
          ) : (
            <Button onClick={requestRun} disabled={!goal.trim()}>Launch team<ArrowRight size={15} /></Button>
          )}
        </div>
        <p className={styles.footnote}><ShieldCheck size={13} strokeWidth={1.75} />{connection.mode === "demo" ? "Demo uses scripted outputs, not AI. Connect a hosted model in Settings for real results." : "Your goal, attachments, and matching notes pass through this app's server proxy to your selected provider."}</p>
      </section>

      <section className={styles.statGrid} aria-label="Workspace summary">
        <div className={styles.stat}><span className={styles.statIcon}><Network size={17} strokeWidth={1.75} /></span><div><span className={styles.statLabel}>Specialized agents</span><strong className={styles.statValue}>5 <small>working as one</small></strong></div></div>
        <div className={styles.stat}><span className={styles.statIcon}><Plug size={17} strokeWidth={1.75} /></span><div><span className={styles.statLabel}>MCP tools</span><strong className={styles.statValue}>{toolCount} <small>{mcp.servers.length} server{mcp.servers.length === 1 ? "" : "s"} connected</small></strong></div></div>
        <div className={styles.stat}><span className={styles.statIcon}><Database size={17} strokeWidth={1.75} /></span><div><span className={styles.statLabel}>Workspace memory</span><strong className={styles.statValue}>{notes.length} <small>saved note{notes.length === 1 ? "" : "s"}</small></strong></div></div>
      </section>

      {shown ? (
        <RunPanel run={shown} selectedStepId={selectedStep} onSelectStep={setSelectedStep} onExport={() => download("hey-buddy-run.md", exportRun(shown))} />
      ) : (
        <>
          <div className={styles.sectionHeading}><div><h2 className={styles.h2}>A little inspiration to get started</h2><p className={styles.muted}>Pick a starting point. Make it your own.</p></div><span className={styles.subtleTag}>3 workflows</span></div>
          <section className={styles.templateGrid}>
            {agentRoles.templates.map((t, i) => (
              <button type="button" key={t.workflow} className={styles.template} onClick={() => { setWorkflow(t.workflow); setGoal(t.goal); document.getElementById("goal")?.focus(); }}>
                <span className={`${styles.templateIcon} ${styles[`tone${i}`]}`}>{i === 0 ? <Boxes size={19} strokeWidth={1.75} /> : i === 1 ? <Search size={19} strokeWidth={1.75} /> : <ShieldCheck size={19} strokeWidth={1.75} />}</span>
                <span className={styles.templateLabel}>{t.label}</span>
                <h3 className={styles.h3}>{t.title}</h3>
                <p className={styles.muted}>{t.description}</p>
                <span className={styles.templateLink}>Try this workflow<ArrowUpRight size={14} /></span>
              </button>
            ))}
          </section>
        </>
      )}

      <section className={styles.architecture}>
        <div className={styles.architectureCopy}>
          <span className={styles.eyebrow}>A smarter way to work</span>
          <h2 className={styles.h2}>Different perspectives.<br />One shared goal.</h2>
          <p className={styles.muted}>A planner sets direction. Specialists explore in parallel. A reviewer challenges the work before a final synthesis.</p>
          <Button asChild variant="link" className={styles.textLink}><Link to="/agents">Meet your team<ArrowRight size={14} /></Link></Button>
        </div>
        <div className={styles.flow} role="img" aria-label="Planner, then Researcher and Architect in parallel, then Reviewer, then Synthesizer">
          <span className={styles.flowNode}><Layers3 size={15} strokeWidth={1.75} />Plan</span>
          <span className={styles.flowLine} aria-hidden="true" />
          <span className={styles.flowStack}><span className={styles.flowNode}><Search size={14} strokeWidth={1.75} />Research</span><span className={styles.flowNode}><Boxes size={14} strokeWidth={1.75} />Design</span></span>
          <span className={styles.flowLine} aria-hidden="true" />
          <span className={styles.flowNode}><ShieldCheck size={15} strokeWidth={1.75} />Review</span>
          <span className={styles.flowLine} aria-hidden="true" />
          <span className={`${styles.flowNode} ${styles.flowFinal}`}><Sparkles size={15} strokeWidth={1.75} />Synthesize</span>
        </div>
      </section>

      <footer className={styles.footer}><span>No desktop app. No local engine. Just your browser.</span><span>Hey Buddy / Ruflo-derived orchestration</span></footer>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this run to your provider?</DialogTitle>
            <DialogDescription>Your goal, {attachedCount ? `${attachedCount} attachment${attachedCount === 1 ? "" : "s"}, ` : ""}matching note excerpts, and intermediate agent outputs will pass through this app's server proxy to:</DialogDescription>
          </DialogHeader>
          <code className={styles.endpoint}>{endpointLabel}</code>
          <p className={styles.muted}>Five stages use up to 15 API requests including retries, each capped at {connection.maxTokens.toLocaleString()} output tokens.{toolCount ? ` The Research stage may call up to 3 of your ${toolCount} enabled MCP tools.` : ""} Provider charges may apply. Agents cannot execute generated code.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => void start()}>Approve and launch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mcpOpen} onOpenChange={setMcpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>MCP servers</DialogTitle>
            <DialogDescription>Connect remote Model Context Protocol servers over HTTPS. Enabled tools are offered to the Research stage of hosted runs. Calls go through this app's server proxy.</DialogDescription>
          </DialogHeader>
          <form className={styles.mcpForm} onSubmit={(e) => void connectMcp(e)}>
            <div className={styles.mcpRow}>
              <Input aria-label="Server name" placeholder="Name (optional)" value={mcpForm.name} onChange={(e) => setMcpForm((f) => ({ ...f, name: e.target.value }))} maxLength={40} />
              <Input aria-label="Server URL" placeholder="https://mcp.example.com/mcp" value={mcpForm.url} onChange={(e) => setMcpForm((f) => ({ ...f, url: e.target.value }))} required inputMode="url" />
            </div>
            <div className={styles.mcpRow}>
              <Input aria-label="Bearer token" type="password" placeholder="Bearer token (optional)" value={mcpForm.token} onChange={(e) => setMcpForm((f) => ({ ...f, token: e.target.value }))} autoComplete="off" />
              <label className={styles.mcpRemember}><Switch checked={mcpForm.saveToken} onCheckedChange={(v) => setMcpForm((f) => ({ ...f, saveToken: v }))} aria-label="Remember token in this browser" />Remember token</label>
            </div>
            <Button type="submit" disabled={mcpBusy === "new"}>{mcpBusy === "new" ? <Loader2 size={14} className={styles.spin} /> : <Plug size={14} strokeWidth={1.75} />}Connect</Button>
          </form>
          {mcp.servers.length ? (
            <ul className={styles.mcpList}>
              {mcp.servers.map((s) => (
                <li key={s.id} className={styles.mcpItem}>
                  <div className={styles.mcpMeta}>
                    <strong>{s.name}</strong>
                    <span className={styles.mcpUrl}>{s.url}</span>
                    <span className={s.error ? styles.mcpError : styles.mcpOk}>{s.error ? s.error : `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}${s.tools.length ? `: ${s.tools.slice(0, 6).map((t) => t.name).join(", ")}${s.tools.length > 6 ? ", ..." : ""}` : ""}`}</span>
                  </div>
                  <div className={styles.mcpActions}>
                    <Switch checked={s.enabled} onCheckedChange={(v) => mcp.toggle(s.id, v)} aria-label={`Enable ${s.name}`} />
                    <Button type="button" variant="ghost" size="icon" aria-label={`Refresh ${s.name}`} disabled={mcpBusy === s.id} onClick={async () => { setMcpBusy(s.id); await mcp.refresh(s.id); setMcpBusy(null); }}>{mcpBusy === s.id ? <Loader2 size={14} className={styles.spin} /> : <RefreshCw size={14} />}</Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${s.name}`} onClick={() => mcp.remove(s.id)}><Trash2 size={14} /></Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No servers yet. Tokens are kept in this browser only, and only when you choose to remember them.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMcpOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
