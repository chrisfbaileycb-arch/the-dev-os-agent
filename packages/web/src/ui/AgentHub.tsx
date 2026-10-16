import { useEffect, useState } from 'react';
import { CircleAlert, Download, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { refreshSystemSkills, type SkillDef, type SystemPrompts } from '../lib/skillRegistry';
import { saveBlob } from '../lib/download';
interface Catalog { builtIn: SkillDef[]; imported: SkillDef[]; }
interface Props { notify: (message: string) => void; prompts: SystemPrompts; changed: () => void; }
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data as T;
}
export default function AgentHub(p: Props) {
  const [catalog, setCatalog] = useState<Catalog>({ builtIn: [], imported: [] });
  const [url, setUrl] = useState('');
  const [directory, setDirectory] = useState('');
  const [ref, setRef] = useState('');
  const [token, setToken] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [prompts, setPrompts] = useState(p.prompts);
  const reload = async () => { setCatalog(await api<Catalog>('/api/admin/skills')); };
  useEffect(() => { void reload().catch(e => p.notify(e.message)); }, []);
  useEffect(() => setPrompts(p.prompts), [p.prompts]);
  async function run(work: () => Promise<void>) {
    setBusy(true); setNote('');
    try { await work(); await reload(); await refreshSystemSkills(); p.changed(); } catch (e) { setNote(e instanceof Error ? e.message : 'Hub update failed.'); } finally { setBusy(false); }
  }
  return <>
    <section className="panel">
      <div className="panel-head"><h2>Agent Skills &amp; Tool Hub Manager</h2><button className="button small" disabled={busy} onClick={() => void run(reload)}><RefreshCw size={12} />Refresh</button></div>
      <p className="help">{catalog.builtIn.length} built-in engineering packages · {catalog.imported.length} repository packages. Users toggle published skills in their workspace. Imports preserve complete instructions, tool schemas, and supporting text resources; no repository scripts execute during indexing.</p>
      <h3>Import Agent Repository</h3>
      <p className="help">Reads a public repository through GitHub's API, indexes its SKILL.md files and agent definitions into this deployment's own catalog, and keeps no clone and no fork on anyone's account.</p>
      <p className="help"><CircleAlert size={12} /> Ensure imported skills are from trusted sources before enabling in production swarms. An imported pathway is written by someone else and is handed to the model verbatim when a visitor switches it on.</p>
      <label>Repository URL<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/agency-enterprise/agency-agents" /></label>
      <div className="form-grid"><label>Directory (optional)<input value={directory} onChange={e => setDirectory(e.target.value)} placeholder="skills or engineering" /></label><label>Branch or commit (optional)<input value={ref} onChange={e => setRef(e.target.value)} placeholder="Repository default branch" /></label></div>
      <label>GitHub token (optional, session only)<input type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} placeholder="For private repositories or higher rate limits" /></label>
      <button className="button primary small" disabled={busy || !url.trim()} onClick={() => void run(async () => {
        const result = await api<{ count: number; commit: string }>('/api/admin/skills/import', { method: 'POST', body: JSON.stringify({ url, directory, ref, token }) });
        setToken(''); setNote(`Indexed ${result.count} complete packages from commit ${result.commit}.`);
      })}>{busy ? <LoaderCircle size={12} className="spin" /> : <Download size={12} />}Import &amp; publish catalog</button>
      {note && <p className="help" role="status">{note}</p>}
      <label>Search published skills<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {[...catalog.builtIn, ...catalog.imported].filter(s => `${s.name} ${s.blurb}`.toLowerCase().includes(query.toLowerCase())).map(skill => <details className="hub-skill" key={skill.id}>
        <summary>{skill.name} <small>{skill.markdown?.length.toLocaleString()} characters · {skill.repository ? `Imported: ${skill.repository}` : 'Built-in'}</small></summary>
        <p className="help">{skill.blurb}</p>{skill.provenance && <p className="help"><a href={skill.provenance.source} target="_blank" rel="noreferrer">Repository source</a> · {skill.provenance.license} · {skill.provenance.commit}</p>}
        <pre className="skill-body">{skill.markdown}</pre>
        {Object.entries(skill.resources ?? {}).map(([path, content]) => <details key={path}><summary>{path}</summary><pre className="skill-body">{content}</pre></details>)}
        <div className="row gap"><button className="button small" onClick={() => saveBlob(new Blob([JSON.stringify(skill, null, 2)], { type: 'application/json' }), `${skill.id}.json`)}>Export complete package</button>{skill.id.startsWith('repo-') && <button className="button small danger" disabled={busy} onClick={() => void run(async () => { await api('/api/admin/skills', { method: 'DELETE', body: JSON.stringify({ id: skill.id }) }); setNote(`${skill.name} removed from the published catalog.`); })}><Trash2 size={12} />Remove from catalog</button>}</div>
      </details>)}
    </section>
    <section className="panel">
      <h2>Protected system defaults</h2>
      <p className="help">Only authenticated administrators can change these deployment defaults. Personal task instructions and knowledge core remain in each browser’s Settings.</p>
      <label>General system prompt<textarea rows={6} value={prompts.general} onChange={e => setPrompts(v => ({ ...v, general: e.target.value }))} /></label>
      <label>Developer system prompt<textarea rows={6} value={prompts.build} onChange={e => setPrompts(v => ({ ...v, build: e.target.value }))} /></label>
      <button className="button primary small" disabled={busy || !prompts.general.trim() || !prompts.build.trim()} onClick={() => void run(async () => { await api('/api/admin/system-prompts', { method: 'PUT', body: JSON.stringify(prompts) }); setNote('System defaults saved. They apply to the next task.'); })}>Save protected defaults</button>
    </section>
  </>;
}
