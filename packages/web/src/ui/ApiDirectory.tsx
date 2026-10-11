import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Globe, LoaderCircle, Search } from 'lucide-react';
import { apiCategories, apiEntries, apiSource, apiWorkspaceDraft, defaultApiFilters, filterApis, type ApiAccess, type ApiEntry } from '../lib/apiDirectory';
import { fetchUrl, type PageSnapshot } from '../lib/connectors';

const accessLabels: Record<ApiAccess, string> = { none: 'No key', key: 'API key', oauth: 'OAuth / login', other: 'Other requirements', unknown: 'Unknown access' };
const PAGE_SIZE = 24;
export default function ApiDirectory({ onUse, webEnabled, openConnectors }: { onUse: (draft: string) => void; webEnabled: boolean; openConnectors: () => void }) {
  const [filters, setFilters] = useState(defaultApiFilters);
  const [page, setPage] = useState(0);
  const [reading, setReading] = useState<string | null>(null);
  const [result, setResult] = useState<{ entry: ApiEntry; snapshot?: PageSnapshot; error?: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const matches = useMemo(() => filterApis(apiEntries, filters), [filters]);
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  function update(patch: Partial<typeof filters>) { setFilters(value => ({ ...value, ...patch })); setPage(0); }
  async function readExample(entry: ApiEntry) {
    if (!entry.review || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setReading(entry.id); setResult(null);
    try { const snapshot = await fetchUrl(entry.review.sampleUrl, controller.signal); if (!controller.signal.aborted) setResult({ entry, snapshot }); }
    catch (error) { if (!controller.signal.aborted) setResult({ entry, error: error instanceof Error ? error.message : 'The public API could not be read.' }); }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) setReading(null); }
  }
  function cancel() { request.current?.abort(); request.current = null; setReading(null); }

  return <div className="page api-directory">
    <div className="page-head"><div><h1>API directory</h1><p>Find public data your agents can use. Start with no-key access, or explore services that require an account.</p></div><Globe size={24} aria-hidden="true" /></div>
    <div className="panel api-directory-intro">
      <p><strong>No key means no credential for the listed public endpoint.</strong> It does not guarantee unlimited, commercial, or permanently free access. API keys usually require an account; this directory does not distribute shared keys.</p>
      <p className="help">Reviewed examples have provider documentation and a dated keyless HTTP check. Other entries show the source directory’s claims and still need review. Opening this tab grants no tool permissions. Read example sends one public GET through this deployment, without forwarding provider credentials or browser cookies.</p>
      <div className="api-directory-stats"><span><strong>{apiEntries.length.toLocaleString()}</strong> entries</span><span><strong>{apiCategories.length}</strong> categories</span><span><strong>{apiEntries.filter(entry => entry.review).length}</strong> reviewed examples</span></div>
    </div>
    <section className="panel" aria-label="API filters">
      <div className="form-grid">
        <label className="grow"><span><Search size={13} aria-hidden="true" /> Search APIs</span><input value={filters.query} placeholder="Weather, books, vehicles, public data…" onChange={event => update({ query: event.target.value })} /></label>
        <label>Access<select value={filters.access} onChange={event => update({ access: event.target.value as ApiAccess | 'all' })}><option value="none">No key</option><option value="all">All access types</option><option value="key">API key / signup</option><option value="oauth">OAuth / login</option><option value="other">Other requirements</option><option value="unknown">Unknown</option></select></label>
        <label>Category<select value={filters.category} onChange={event => update({ category: event.target.value })}><option value="all">All categories</option>{apiCategories.map(category => <option key={category}>{category}</option>)}</select></label>
      </div>
      <div className="api-directory-toggles"><label className="check"><input type="checkbox" checked={filters.httpsOnly} onChange={event => update({ httpsOnly: event.target.checked })} />HTTPS only</label><label className="check"><input type="checkbox" checked={filters.reviewedOnly} onChange={event => update({ reviewedOnly: event.target.checked })} />Reviewed examples only</label><button className="text-button" onClick={() => { setFilters(defaultApiFilters); setPage(0); }}>Reset filters</button></div>
    </section>
    {!webEnabled && <div className="panel"><p>The public URL reader is off for agents. You can still read an example here yourself; to use it in chat, enable the URL reader in Connectors.</p><button className="button small" onClick={openConnectors}>Open Connectors</button></div>}
    {reading && <div className="panel api-directory-reading" role="status"><LoaderCircle size={16} aria-hidden="true" />Reading one public example… <button className="button small" onClick={cancel}>Cancel</button></div>}
    {result && <section className="panel api-directory-result" aria-label="API example result" aria-live="polite">
      <div className="panel-head"><h2>{result.entry.name} example</h2><button className="button small" onClick={() => setResult(null)}>Close result</button></div>
      {result.error ? <p role="alert">{result.error}</p> : result.snapshot && <><p><strong>HTTP {result.snapshot.status}</strong> · {result.snapshot.contentType}</p><p className="help">{result.snapshot.url}{result.snapshot.truncated ? ' · Response text truncated to the reader limit.' : ''}</p><pre>{result.snapshot.text}</pre></>}
    </section>}
    <p className="help" role="status">{matches.length.toLocaleString()} matching entries · Page {currentPage + 1} of {pageCount}</p>
    {visible.length ? <div className="api-directory-grid">{visible.map(entry => <article className="panel api-directory-card" key={entry.id}>
      <div className="api-directory-card-head"><h2>{entry.name}</h2><span className={`api-access api-access-${entry.access}`}>{accessLabels[entry.access]}{entry.review ? '' : ' (source)'}</span></div>
      <p>{entry.description}</p>
      <p className="help">{entry.categories.join(' · ')}{entry.review && ` · ${entry.review.scope}`}</p>
      {entry.review ? <><p className="api-review">Docs reviewed · GET returned 200 on {entry.review.checked} UTC</p><p className="help">{entry.review.usage}</p></> : <><p className="api-unreviewed">Needs provider review · Source auth: {entry.sourceAuth || 'Unknown'}</p><p className="help">Source HTTPS: {entry.https} · Source CORS: {entry.cors}</p></>}
      <div className="api-directory-actions"><a className="button small" href={entry.review?.docs ?? entry.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} aria-hidden="true" />Provider docs</a>{entry.review && <><button className="button small" disabled={!!reading} aria-label={`Read ${entry.name} example`} onClick={() => void readExample(entry)}>Read example</button><button className="button small" disabled={!webEnabled} aria-label={`Use ${entry.name} in workspace`} onClick={() => onUse(apiWorkspaceDraft(entry))}>Use in workspace</button></>}</div>
    </article>)}</div> : <div className="panel"><p>No APIs match these filters.</p></div>}
    <nav className="api-directory-pagination" aria-label="API pages"><button className="button small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button className="button small" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></nav>
    <p className="help">Directory metadata from <a href={`${apiSource.repository}/tree/${apiSource.commit}`} target="_blank" rel="noopener noreferrer">Public APIs · {apiSource.commit.slice(0, 7)}</a> (<a href="/licenses/public-apis-MIT.txt" target="_blank" rel="noopener noreferrer">{apiSource.license} license</a>). Source metadata is a snapshot, not an endorsement or live availability test. MCP servers require separate tool and permission review.</p>
  </div>;
}
