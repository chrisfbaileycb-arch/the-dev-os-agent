import React, { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, ArrowUpRight, Boxes, Search, ShieldCheck, Sparkles, Square, Workflow as WorkflowIcon, Layers3, Network, Database, Globe2 } from "lucide-react";
import { Button } from "../components/Button";
import { Textarea } from "../components/Textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/Select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/Dialog";
import { RunPanel } from "../components/RunPanel";
import { agentRoles } from "../helpers/agentRoles";
import { executeRun } from "../helpers/executeRun";
import { exportRun } from "../helpers/exportRun";
import { useConnection } from "../helpers/useConnection";
import { useNotes } from "../helpers/useNotes";
import { useRuns } from "../helpers/useRuns";
import { providerCatalog } from "../helpers/providerCatalog";
import type { Run, Workflow } from "../helpers/runTypes";
import styles from "./_index.module.css";

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
  const [params, setParams] = useSearchParams();
  const [goal, setGoal] = useState("");
  const [workflow, setWorkflow] = useState<Workflow>("build");
  const [run, setRun] = useState<Run | null>(null);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lastSaved = useRef("");

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

  async function start() {
    setConfirmOpen(false);
    if (busy) return;
    const trimmed = goal.trim();
    if (!trimmed) { toast.error("Enter a goal first."); return; }
    setBusy(true); setSelectedStep(null); lastSaved.current = "";
    if (viewId) setParams({});
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    try {
      const final = await executeRun(
        { runId: crypto.randomUUID(), goal: trimmed, workflow, connection, knowledge: notes },
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
    if (connection.mode === "remote") {
      if (!connection.model.trim()) { toast.error("Choose a model in Settings before launching a hosted run."); return; }
      if (connection.provider !== "custom" && !connection.apiKey.trim()) { toast.error("Add your provider API key in Settings. Keys stay in this browser session."); return; }
      setConfirmOpen(true);
      return;
    }
    void start();
  }

  const endpointLabel = connection.provider === "custom" ? connection.endpoint || "your custom endpoint" : providerCatalog[connection.provider].endpoint;

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
            <p className={styles.muted}>Give your team a goal. They plan, explore, review, and synthesize.</p>
          </div>
        </div>
        <label className={styles.srOnly} htmlFor="goal">Your goal</label>
        <Textarea id="goal" value={goal} maxLength={12000} disabled={busy} rows={5} onChange={(e) => setGoal(e.target.value)} placeholder="Describe a problem, explore an idea, or plan your next project." className={styles.goal} />
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
        <p className={styles.footnote}><ShieldCheck size={13} strokeWidth={1.75} />{connection.mode === "demo" ? "Demo uses scripted outputs, not AI. Connect a hosted model in Settings for real results." : "Your goal and matching notes pass through this app's server proxy to your selected provider."}</p>
      </section>

      <section className={styles.statGrid} aria-label="Workspace summary">
        <div className={styles.stat}><span className={styles.statIcon}><Network size={17} strokeWidth={1.75} /></span><div><span className={styles.statLabel}>Specialized agents</span><strong className={styles.statValue}>5 <small>working as one</small></strong></div></div>
        <div className={styles.stat}><span className={styles.statIcon}><WorkflowIcon size={17} strokeWidth={1.75} /></span><div><span className={styles.statLabel}>Orchestration</span><strong className={styles.statValue}>Ruflo <small>browser-adapted core</small></strong></div></div>
        <div className={styles.stat}><span className={styles.statIcon}><Database size={17} strokeWidth={1.75} /></span><div><span className={styles.statLabel}>Workspace memory</span><strong className={styles.statValue}>{notes.length} <small>saved note{notes.length === 1 ? "" : "s"}</small></strong></div></div>
      </section>

      {shown ? (
        <RunPanel run={shown} selectedStepId={selectedStep} onSelectStep={setSelectedStep} onExport={() => download("freetoken-run.md", exportRun(shown))} />
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
            <DialogDescription>Your goal, matching note excerpts, and intermediate agent outputs will pass through this app's server proxy to:</DialogDescription>
          </DialogHeader>
          <code className={styles.endpoint}>{endpointLabel}</code>
          <p className={styles.muted}>Five stages use up to 15 API requests including retries, each capped at {connection.maxTokens.toLocaleString()} output tokens. Provider charges may apply. Agents cannot execute generated code.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => void start()}>Approve and launch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
