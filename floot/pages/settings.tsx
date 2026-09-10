import React, { useState } from "react";
import { Helmet } from "react-helmet";
import { toast } from "sonner";
import { Check, FlaskConical, Globe2, LoaderCircle, Search, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/Select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/Dialog";
import { useConnection } from "../helpers/useConnection";
import { useRuns } from "../helpers/useRuns";
import { providerCatalog } from "../helpers/providerCatalog";
import { postModels } from "../endpoints/models_POST.schema";
import type { Provider } from "../helpers/runTypes";
import styles from "./settings.module.css";

export default function SettingsPage() {
  const { connection, setConnection, switchProvider, persist, reset } = useConnection();
  const { clearWorkspace } = useRuns();
  const [models, setModels] = useState<string[]>(providerCatalog[connection.provider].models);
  const [checking, setChecking] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const preset = providerCatalog[connection.provider];

  async function discover() {
    setChecking(true);
    try {
      const { ids } = await postModels({ provider: connection.provider, apiKey: connection.apiKey.trim() || undefined, baseUrl: connection.provider === "custom" ? connection.endpoint : undefined });
      setModels(ids);
      if (ids.length && !ids.includes(connection.model)) setConnection((c) => ({ ...c, model: ids[0] }));
      toast.success(ids.length ? `Connected. Found ${ids.length} model${ids.length === 1 ? "" : "s"}.` : "The endpoint returned no models. You can still type a model ID.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load models."); }
    finally { setChecking(false); }
  }

  function saveConnection() {
    if (connection.mode === "remote") {
      if (connection.provider === "custom") { try { const u = new URL(connection.endpoint); if (u.protocol !== "https:") throw new Error(); } catch { toast.error("Enter a valid HTTPS custom API base URL, including its version path."); return; } }
      if (!connection.model.trim()) { toast.error("Choose or type a model ID."); return; }
    }
    persist();
    toast.success("Connection saved. Your API key stays in memory for this session only.");
  }

  async function clearAll() {
    setConfirmClear(false);
    try {
      const result = await clearWorkspace.mutateAsync();
      reset();
      toast.success(`Cleared ${result.runsDeleted} run${result.runsDeleted === 1 ? "" : "s"} and ${result.notesDeleted} note${result.notesDeleted === 1 ? "" : "s"}.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not clear the workspace."); }
  }

  return (
    <>
      <Helmet><title>Settings - FreeToken Web</title></Helmet>
      <div className={styles.pageHeading}>
        <span className={styles.eyebrow}>Make it yours</span>
        <h1 className={styles.h1}>Your browser. Your model provider.</h1>
        <p className={styles.lede}>No local runtime or software installation required.</p>
      </div>
      <div className={styles.layout}>
        <section className={styles.panel} aria-labelledby="conn-title">
          <h2 id="conn-title" className={styles.h2}>Inference connection</h2>
          <p className={styles.help}>Start with a scripted preview, or connect a hosted provider with your own key.</p>
          <div className={styles.modePicker} role="group" aria-label="Mode">
            <button type="button" className={connection.mode === "demo" ? `${styles.mode} ${styles.modeSelected}` : styles.mode} aria-pressed={connection.mode === "demo"} onClick={() => setConnection((c) => ({ ...c, mode: "demo" }))}><FlaskConical size={18} strokeWidth={1.75} /><strong>Scripted preview</strong><small>No AI, no network calls, no cost.</small></button>
            <button type="button" className={connection.mode === "remote" ? `${styles.mode} ${styles.modeSelected}` : styles.mode} aria-pressed={connection.mode === "remote"} onClick={() => setConnection((c) => ({ ...c, mode: "remote" }))}><Globe2 size={18} strokeWidth={1.75} /><strong>Hosted API</strong><small>Real inference on your provider.</small></button>
          </div>
          <label className={styles.field}><span>Provider</span>
            <Select value={connection.provider} onValueChange={(v) => { switchProvider(v as Provider); setModels(providerCatalog[v as Provider].models); }} disabled={connection.mode === "demo"}>
              <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(providerCatalog) as Provider[]).map((p) => <SelectItem key={p} value={p}>{providerCatalog[p].name} ({providerCatalog[p].tier})</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className={styles.field}><span>API base URL</span>
            <Input type="url" disabled={connection.mode === "demo" || connection.provider !== "custom"} value={connection.endpoint} placeholder="https://your-provider.example/v1" onChange={(e) => { setModels([]); setConnection((c) => ({ ...c, endpoint: e.target.value })); }} />
          </label>
          <p className={styles.help}>{connection.provider === "custom" ? "HTTPS only, public hostnames only. Include the version path. A local Ollama is not reachable from a hosted proxy." : "Fixed for this provider. Requests go through this app's server-side proxy, so provider CORS is not required."}</p>
          <label className={styles.field}><span>{preset.keyHint}</span>
            <Input type="password" autoComplete="off" spellCheck={false} disabled={connection.mode === "demo"} value={connection.apiKey} placeholder="Your provider key" onChange={(e) => setConnection((c) => ({ ...c, apiKey: e.target.value }))} />
          </label>
          <p className={styles.help}>Kept in memory for this browser session and sent per request to the proxy. It is never written to the database, exports, or logs. Prefer a restricted, short-lived key.</p>
          <div className={styles.row}>
            <label className={`${styles.field} ${styles.grow}`}><span>Model ID</span>
              <Input list="model-catalog" disabled={connection.mode === "demo"} value={connection.model} placeholder="Model served by your provider" onChange={(e) => setConnection((c) => ({ ...c, model: e.target.value }))} />
              <datalist id="model-catalog">{models.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            <Button variant="outline" disabled={connection.mode === "demo" || checking || (connection.provider === "custom" && !connection.endpoint)} onClick={() => void discover()}>{checking ? <LoaderCircle className={styles.spin} size={15} /> : <Search size={15} />}Discover</Button>
          </div>
          <label className={styles.field}><span>Maximum output tokens per request</span>
            <Select value={String(connection.maxTokens)} onValueChange={(v) => setConnection((c) => ({ ...c, maxTokens: Number(v) }))} disabled={connection.mode === "demo"}>
              <SelectTrigger aria-label="Maximum output tokens"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="512">512 tokens</SelectItem>
                <SelectItem value="1024">1,024 tokens</SelectItem>
                <SelectItem value="2048">2,048 tokens</SelectItem>
                <SelectItem value="4096">4,096 tokens</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Button onClick={saveConnection}>Save connection<Check size={15} /></Button>
        </section>
        <div className={styles.column}>
          <section className={styles.panel}>
            <span className={styles.icon}><ShieldCheck size={20} strokeWidth={1.75} /></span>
            <h2 className={styles.h2}>Hosted, honestly.</h2>
            <h3 className={styles.h3}>In your tab</h3><p className={styles.help}>The interface, task coordination, exact-prompt cache, and keyword retrieval.</p>
            <h3 className={styles.h3}>In this browser</h3><p className={styles.help}>Notes and run history live in IndexedDB on this device. Your browser can evict them; export important work. Provider keys are never stored.</p>
            <h3 className={styles.h3}>On your provider</h3><p className={styles.help}>Model inference. Each stage returns as one complete response; five stages make five calls, up to fifteen with retries.</p>
            <h3 className={styles.h3}>Not included</h3><p className={styles.help}>Shell execution, autonomous code changes, browsing, vector embeddings, and model hosting. Provider usage may cost money.</p>
          </section>
          <section className={`${styles.panel} ${styles.danger}`}>
            <h2 className={styles.h2}>Clear workspace</h2>
            <p className={styles.help}>Delete saved notes, run history, and connection settings from this browser.</p>
            <Button variant="destructive" onClick={() => setConfirmClear(true)}><Trash2 size={15} />Clear workspace data</Button>
          </section>
        </div>
      </div>
      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader><DialogTitle>Clear this workspace?</DialogTitle><DialogDescription>This permanently removes notes, run history, and saved connection details from this browser. Export anything you want to keep first.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmClear(false)}>Cancel</Button><Button variant="destructive" onClick={() => void clearAll()}>Delete workspace data</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
