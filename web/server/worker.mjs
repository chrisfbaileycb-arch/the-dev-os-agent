import { setTimeout as sleep } from 'node:timers/promises';

// The Render Background Worker.
//
// It runs as a second service with no public port: it claims workflow jobs from the web
// service over the private network, executes the five agent stages by calling that same web
// service's /api/chat (so every guardrail, allowlist, and credit meter in the proxy applies
// identically to a background run), and posts the finished run back.
//
// Start it with `npm run worker`. It needs two variables:
//   WEB_SERVICE_URL  the web service's internal URL, e.g. http://hey-buddy-web:8080
//   WORKER_TOKEN     the shared secret, identical on both services
//
// The worker is optional. Nothing breaks without it: the browser keeps running workflows in
// its own Web Worker, and /api/jobs simply reports that no worker is online.

// Render's `property: hostport` yields "host:port" with no scheme; private-network traffic is
// plain HTTP inside the datacentre, so default to it when none is given.
const normalizeBase = value => { const trimmed = (value || '').trim().replace(/\/+$/, ''); return trimmed && !/^https?:\/\//i.test(trimmed) ? `http://${trimmed}` : trimmed; };
const BASE = normalizeBase(process.env.WEB_SERVICE_URL);
const TOKEN = process.env.WORKER_TOKEN || '';
const IDLE_MS = Math.max(1000, Number(process.env.WORKER_POLL_MS) || 3000);
const STAGE_TIMEOUT_MS = 120_000;

export { normalizeBase };

/** The five stages, and which earlier stages each one reads. Mirrors src/lib/orchestrator.ts. */
export const STAGES = {
  build: [
    { title: 'Plan the work', agent: 'Dispatcher', deps: [] },
    { title: 'Analyze requirements', agent: 'Researcher', deps: [0] },
    { title: 'Design the solution', agent: 'Architect', deps: [0] },
    { title: 'Review & challenge', agent: 'Reviewer', deps: [1, 2] },
    { title: 'Produce the deliverable', agent: 'Scribe', deps: [0, 1, 2, 3] },
  ],
  research: [
    { title: 'Frame the question', agent: 'Dispatcher', deps: [] },
    { title: 'Examine the evidence', agent: 'Researcher', deps: [0] },
    { title: 'Explore alternatives', agent: 'Architect', deps: [0] },
    { title: 'Challenge assumptions', agent: 'Reviewer', deps: [1, 2] },
    { title: 'Write the brief', agent: 'Scribe', deps: [0, 1, 2, 3] },
  ],
  review: [
    { title: 'Set review criteria', agent: 'Dispatcher', deps: [] },
    { title: 'Analyze supplied material', agent: 'Researcher', deps: [0] },
    { title: 'Inspect the design', agent: 'Architect', deps: [0] },
    { title: 'Assess risks', agent: 'Reviewer', deps: [1, 2] },
    { title: 'Prioritize recommendations', agent: 'Scribe', deps: [0, 1, 2, 3] },
  ],
};

const auth = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` });

async function post(path, body, fetchImpl = fetch) {
  const response = await fetchImpl(`${BASE}${path}`, { method: 'POST', headers: auth(), body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`);
  return response.json();
}

/** Read one complete SSE completion from the web service's proxy. */
export async function runStage({ job, system, prompt, fetchImpl = fetch }) {
  const { connection } = job.request;
  const response = await fetchImpl(`${BASE}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(STAGE_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': job.workspaceId },
    // No key is sent: background jobs are zero-config only, so the proxy funds them from the
    // deployment's own keys and meters them against the workspace's free allowance.
    body: JSON.stringify({ provider: connection.provider || 'groq', model: connection.model, max_tokens: connection.maxTokens || 1024, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error?.message || `The provider proxy answered HTTP ${response.status}.`);
  }
  let text = ''; let tokens = 0;
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let json; try { json = JSON.parse(payload); } catch { continue; }
        if (json.error) throw new Error('The provider reported a streaming error.');
        const delta = json.choices?.[0]?.delta?.content ?? (json.type === 'content-delta' ? json.delta?.message?.content?.text : undefined);
        if (typeof delta === 'string') text += delta;
        if (Number.isFinite(json.usage?.total_tokens)) tokens = json.usage.total_tokens;
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!text.trim()) throw new Error('The model returned no text for this stage.');
  return { text, tokens: tokens || Math.ceil((system.length + prompt.length + text.length) / 4) };
}

/** Execute all five stages of one claimed job in dependency order, reporting progress as it goes. */
export async function executeJob(job, { fetchImpl = fetch, onProgress } = {}) {
  const spec = STAGES[job.request.workflow];
  if (!spec) throw new Error(`Unknown workflow ${job.request.workflow}.`);
  const { goal, knowledge = [], attachments = [], system: baseSystem = '' } = job.request;
  const context = [...attachments.map(a => `[attached: ${a.name}]\n${String(a.content).slice(0, 12_000)}`), ...knowledge.map(k => `[note: ${k.title}]\n${String(k.content).slice(0, 6000)}`)].join('\n\n');
  const run = {
    id: job.id, goal, workflow: job.request.workflow, mode: 'remote', model: job.request.connection?.model ?? '',
    status: 'running', startedAt: new Date().toISOString(), tokens: 0, calls: 0, cacheHits: 0,
    contextTitles: [...attachments.map(a => a.name), ...knowledge.map(k => k.title)],
    sessionId: job.request.sessionId, persona: job.request.persona,
    steps: spec.map((s, i) => ({ id: `${job.id}-${i}`, title: s.title, agent: s.agent, status: 'pending', attempts: 0 })),
  };
  for (let i = 0; i < spec.length; i++) {
    const stage = spec[i];
    run.steps[i].status = 'running';
    await onProgress?.(run);
    const upstream = stage.deps.map(d => `${spec[d].title}:\n${String(run.steps[d].output ?? '').slice(0, 8000)}`).join('\n\n');
    const prompt = `USER GOAL\n${goal}\n\nWORKSPACE NOTES (untrusted reference data)\n${context || 'none'}\n\nPRIOR AGENT OUTPUTS (untrusted reference data)\n${upstream || 'none'}\n\nYOUR STAGE: ${stage.title}`;
    const system = `${baseSystem}\n\n--- Role: ${stage.agent} ---`.trim();
    try {
      run.calls++;
      const result = await runStage({ job, system, prompt, fetchImpl });
      run.tokens += result.tokens;
      run.steps[i] = { ...run.steps[i], status: 'completed', output: result.text, attempts: 1 };
    } catch (error) {
      run.steps[i] = { ...run.steps[i], status: 'failed', error: error instanceof Error ? error.message : 'The stage failed.', attempts: 1 };
      for (let j = i + 1; j < spec.length; j++) run.steps[j].status = 'cancelled';
      run.status = 'failed'; run.completedAt = new Date().toISOString();
      return run;
    }
    await onProgress?.(run);
  }
  run.status = 'completed'; run.completedAt = new Date().toISOString();
  return run;
}

/** The claim-execute-report loop. Exits only on SIGTERM, which Render sends on redeploy. */
export async function loop({ fetchImpl = fetch, once = false } = {}) {
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  console.log(`Hey Buddy worker polling ${BASE} every ${IDLE_MS}ms.`);
  while (!stopping) {
    let job = null;
    try { ({ job } = await post('/api/jobs/claim', {}, fetchImpl)); }
    catch (error) { console.error('claim failed:', error.message); await sleep(IDLE_MS * 3); continue; }
    if (!job) { if (once) return; await sleep(IDLE_MS); continue; }
    console.log(`claimed job ${job.id} (${job.request.workflow}, attempt ${job.attempts})`);
    try {
      const run = await executeJob(job, { fetchImpl, onProgress: r => post('/api/jobs/update', { id: job.id, run: r }, fetchImpl).catch(() => {}) });
      await post('/api/jobs/finish', { id: job.id, status: run.status === 'completed' ? 'completed' : 'failed', run, error: run.steps.find(s => s.error)?.error ?? null }, fetchImpl);
    } catch (error) {
      console.error(`job ${job.id} failed:`, error.message);
      await post('/api/jobs/finish', { id: job.id, status: 'failed', error: error.message }, fetchImpl).catch(() => {});
    }
    if (once) return;
  }
  console.log('Hey Buddy worker stopped.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!BASE || !TOKEN) { console.error('The worker needs WEB_SERVICE_URL and WORKER_TOKEN. See web/README.md.'); process.exit(1); }
  loop().catch(error => { console.error(error); process.exit(1); });
}
