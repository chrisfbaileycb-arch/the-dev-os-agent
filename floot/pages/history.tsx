import React from "react";
import { Helmet } from "react-helmet";
import { Link } from "react-router-dom";
import { Download, Clock3, ChevronRight, Workflow as WorkflowIcon, ArrowRight } from "lucide-react";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Skeleton } from "../components/Skeleton";
import { useRuns } from "../helpers/useRuns";
import { useNotes } from "../helpers/useNotes";
import type { Run } from "../helpers/runTypes";
import styles from "./history.module.css";

const variant = (status: Run["status"]) => (status === "completed" ? "success" : status === "running" ? "warning" : status === "failed" ? "destructive" : "secondary");

export default function HistoryPage() {
  const { query, runs } = useRuns();
  const { notes } = useNotes();
  function exportWorkspace() {
    const body = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), runs, notes }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "freetoken-workspace.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <Helmet><title>Run history - Hey Buddy</title></Helmet>
      <div className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>Your work, remembered</span>
          <h1 className={styles.h1}>Every run. Ready to revisit.</h1>
          <p className={styles.lede}>Run history is saved in this browser, not on a remote account. Exports never include provider keys.</p>
        </div>
        <Button variant="outline" onClick={exportWorkspace} disabled={!runs.length && !notes.length}><Download size={15} />Export workspace</Button>
      </div>
      {query.isPending ? (
        <div className={styles.list}><Skeleton className={styles.skeleton} /><Skeleton className={styles.skeleton} /><Skeleton className={styles.skeleton} /></div>
      ) : runs.length ? (
        <ol className={styles.list}>
          {runs.map((r) => (
            <li key={r.id}>
              <Link to={`/?run=${encodeURIComponent(r.id)}`} className={styles.item}>
                <span className={styles.icon}><WorkflowIcon size={17} strokeWidth={1.75} /></span>
                <span className={styles.text}>
                  <span className={styles.goal}>{r.goal}</span>
                  <span className={styles.meta}>{r.workflow} / {r.mode === "demo" ? "Scripted preview" : r.model} / {new Date(r.startedAt).toLocaleString()}</span>
                </span>
                <Badge variant={variant(r.status)}>{r.status}</Badge>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.empty}>
          <Clock3 size={28} strokeWidth={1.5} />
          <h2 className={styles.h2}>Your first run is the beginning.</h2>
          <p className={styles.lede}>Launch a workflow to start building your history.</p>
          <Button asChild><Link to="/">Go to workspace<ArrowRight size={15} /></Link></Button>
        </div>
      )}
    </>
  );
}
