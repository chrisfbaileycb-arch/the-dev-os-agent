import React from "react";
import { Check, LoaderCircle, FileText, Download, X, AlertTriangle } from "lucide-react";
import { Button } from "./Button";
import { Badge } from "./Badge";
import type { Run } from "../helpers/runTypes";
import styles from "./RunPanel.module.css";

interface RunPanelProps {
  run: Run;
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
  onExport: () => void;
  className?: string;
}

const statusVariant = (status: Run["status"]) =>
  status === "completed" ? "success" : status === "running" ? "warning" : status === "failed" ? "destructive" : "secondary";

export const RunPanel = ({ run, selectedStepId, onSelectStep, onExport, className }: RunPanelProps) => {
  const completed = run.steps.filter((s) => s.status === "completed").length;
  const displayStep = run.steps.find((s) => s.id === selectedStepId) ?? [...run.steps].reverse().find((s) => s.output || s.error);
  const heading = run.status === "running" ? "Your team is on it" : run.status === "completed" ? "Your run is complete" : `Run ${run.status}`;
  return (
    <section className={`${styles.panel} ${className ?? ""}`} aria-label="Run progress">
      <div className={styles.heading}>
        <div>
          <h2 className={styles.title}>{heading}</h2>
          <p className={styles.subtitle}>
            <span className={styles.num}>{completed}</span> of <span className={styles.num}>{run.steps.length || 5}</span> stages completed. {run.mode === "demo" ? "Scripted preview, no AI inference." : run.model}
          </p>
        </div>
        <div className={styles.actions}>
          <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
          <Button variant="outline" size="sm" onClick={onExport}><Download size={14} />Export</Button>
        </div>
      </div>
      <ol className={styles.rail} aria-label="Stages">
        {run.steps.map((step, i) => {
          const selected = displayStep?.id === step.id;
          return (
            <li key={step.id} className={styles.railItem}>
              <button type="button" className={`${styles.step} ${styles[`step_${step.status}`]} ${selected ? styles.stepSelected : ""}`} onClick={() => onSelectStep(step.id)} aria-pressed={selected}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {step.status === "completed" ? <Check size={14} /> : step.status === "running" ? <LoaderCircle size={14} className={styles.spin} /> : step.status === "failed" ? <AlertTriangle size={14} /> : step.status === "cancelled" ? <X size={14} /> : i + 1}
                </span>
                <span className={styles.stepAgent}>{step.agent}</span>
                <span className={styles.stepStatus}>{step.status}{step.attempts > 1 ? ` (attempt ${step.attempts})` : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className={styles.output} aria-live="polite">
        <div className={styles.outputHeading}><FileText size={15} strokeWidth={1.75} /><strong>{displayStep ? displayStep.title : "Waiting for the first stage"}</strong></div>
        <pre className={styles.pre}>{displayStep?.output ?? displayStep?.error ?? "The workspace is coordinating your team. Each stage's output appears here as it finishes."}</pre>
      </div>
      <div className={styles.footer}>
        <span><span className={styles.num}>{run.calls}</span> provider requests</span>
        <span><span className={styles.num}>{run.tokens.toLocaleString()}</span> reported tokens</span>
        <span><span className={styles.num}>{run.contextTitles.length}</span> retrieved notes</span>
        <span><span className={styles.num}>{run.cacheHits}</span> exact-cache hits</span>
      </div>
      {run.status === "failed" && <p className={styles.help}>The run did not complete. Open the failed stage for details, check Settings, and launch a new run.</p>}
    </section>
  );
};
