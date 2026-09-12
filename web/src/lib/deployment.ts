import { DEFAULT_FREE_POOL } from './catalog';
import { workspaceId } from './store';
import type { FreeTier } from './store';

// What this particular deployment can do, read once at startup from /api/providers.
//
// The zero-config tier only works if the server holds provider keys, so the browser asks
// before promising anything: the model dropdown marks free entries live or locked from this
// answer, and a deployment with no keys falls back to the scripted preview instead of failing
// on the visitor's first message.

/**
 * Hey Buddy's own paid plans, as this deployment reports them.
 *
 * `checkout` is null until the operator sets the plan's checkout URL in the environment, and the
 * Plans page renders that honestly rather than putting a Subscribe button over a dead link. It
 * is a deployment setting, not a build-time constant, so opening checkout is a dashboard edit.
 */
export interface BillingPlan { id: string; name: string; price: string; cadence: string; checkout: string | null; }
export interface Billing { enabled: boolean; plans: BillingPlan[]; }

/**
 * One model as the gateway describes it, discovered rather than compiled in.
 *
 * `tier` is the gateway's own word — free, paid, premium — and `free` is the server's verdict on
 * it, which is stricter: free requires zero input and output pricing as well as the label. The UI
 * shows `label` and sends `id`, and never has to guess at either.
 */
export interface GatewayModel { id: string; label: string; tier: string; free: boolean; context: number | null; vision: boolean; reasoning: boolean; }
/** Whether discovery is working, so a deployment with an empty free tier can say why. */
export interface GatewayCatalog { url: string | null; models: GatewayModel[]; discovered: boolean; count: number; free: number; at: string | null; error: string | null; }

export interface Deployment { free: FreeTier; billing: Billing; gateway: string | null; gatewayCatalog: GatewayCatalog; ollamaBridge: string | null; reachable: boolean; }

/**
 * What a visitor sees whenever the zero-config tier cannot serve them: keys unset, provider
 * rate-limiting, or upstream down. Mirrors FREE_TIER_UNAVAILABLE in server/proxy.mjs — the two
 * are compared in tests so the wording cannot drift between the server and the browser.
 *
 * It deliberately does not distinguish those causes. None of them is the visitor's key to fix,
 * and both routes out — wait, or bring your own key — are the same in every case.
 */
export const FREE_TIER_WARMING = 'Public free tier warming up — enter your own key in Settings or try again shortly.';

/** Server codes that mean "the free tier, not you". Anything else is reported as it arrived. */
const WARMING_CODES = new Set(['free_tier_unavailable', 'free_tier_busy']);
export const isFreeTierWarming = (code?: string): boolean => Boolean(code && WARMING_CODES.has(code));

export const emptyGatewayCatalog: GatewayCatalog = { url: null, models: [], discovered: false, count: 0, free: 0, at: null, error: null };

export const offlineDeployment: Deployment = {
  free: { enabled: false, models: [], providers: {}, monthlyCredits: DEFAULT_FREE_POOL, perHour: 0 },
  billing: { enabled: false, plans: [] },
  gateway: null,
  gatewayCatalog: emptyGatewayCatalog,
  ollamaBridge: null,
  reachable: false,
};

/**
 * The gateway catalogue as reported, filtered rather than trusted. Ids become model names in
 * outbound requests and labels become text on screen, so both are bounded here; an entry that
 * does not survive that is dropped rather than repaired.
 */
function gatewayCatalogFrom(raw: unknown): GatewayCatalog {
  const source = (raw ?? {}) as Partial<GatewayCatalog>;
  const models = (Array.isArray(source.models) ? source.models : [])
    .filter((m): m is GatewayModel => Boolean(m) && typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 200)
    .slice(0, 1000)
    .map(m => ({
      id: m.id,
      label: typeof m.label === 'string' && m.label.trim() ? m.label.slice(0, 80) : m.id,
      tier: typeof m.tier === 'string' ? m.tier.slice(0, 20) : 'unknown',
      free: m.free === true,
      context: Number.isFinite(m.context) ? Number(m.context) : null,
      vision: m.vision === true,
      reasoning: m.reasoning === true,
    }));
  return {
    url: typeof source.url === 'string' && /^https:\/\//.test(source.url) ? source.url : null,
    models,
    discovered: source.discovered === true,
    count: Number.isFinite(source.count) ? Number(source.count) : models.length,
    free: Number.isFinite(source.free) ? Number(source.free) : models.filter(m => m.free).length,
    at: typeof source.at === 'string' ? source.at : null,
    error: typeof source.error === 'string' ? source.error.slice(0, 300) : null,
  };
}

/** Gateway labels by id, so the dock and the status bar can name a discovered model. */
export function labelsFrom(catalog: GatewayCatalog): Record<string, string> {
  return Object.fromEntries(catalog.models.map(m => [m.id, m.label]));
}

/**
 * Plans as reported, filtered rather than trusted. A checkout URL is somewhere this app sends a
 * person who is about to pay, so it must be HTTPS and carry no credentials — the server checks
 * the same thing, and checking twice costs nothing next to sending someone's card details
 * somewhere unintended.
 */
function billingFrom(raw: unknown): Billing {
  const plans = Array.isArray((raw as Billing)?.plans) ? (raw as Billing).plans : [];
  const clean = plans
    .filter((p): p is BillingPlan => Boolean(p) && typeof p.id === 'string' && typeof p.name === 'string')
    .map(p => ({
      id: p.id, name: p.name,
      price: typeof p.price === 'string' ? p.price : '',
      cadence: typeof p.cadence === 'string' ? p.cadence : '',
      checkout: typeof p.checkout === 'string' && /^https:\/\//.test(p.checkout) && !/[@#]/.test(p.checkout) ? p.checkout : null,
    }));
  return { enabled: clean.some(p => p.checkout), plans: clean };
}

/**
 * Which provider funds each free model, as the server reports it. Filtered rather than trusted:
 * this lands in a Connection and decides which endpoint a request goes to, so a malformed or
 * unexpected value should leave the browser guessing rather than pointed somewhere arbitrary.
 */
function providerMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

/**
 * How long to wait for /api/providers, and how many times to ask.
 *
 * The old single attempt with a 10 second ceiling was tuned for a warm server, and this one is
 * not always warm: on Render's free plan the instance sleeps after inactivity and the first
 * request wakes it, which routinely takes longer than ten seconds. That timeout then aborted the
 * only attempt, the browser concluded the deployment funded nothing, and the app dropped into the
 * scripted preview for the rest of the session — so the visitor's first impression of a working
 * free tier was "no AI, no network", curable only by a reload they had no reason to try.
 *
 * A waking instance is a normal condition, not an error, so it is waited out and retried.
 */
export const DEPLOYMENT_TIMEOUT_MS = 20_000;
export const DEPLOYMENT_ATTEMPTS = 3;
const BACKOFF_MS = [1_500, 4_000];

export interface LoadOptions {
  attempts?: number;
  timeoutMs?: number;
  /** Called before each retry, so the UI can say the deployment is waking rather than sit blank. */
  onRetry?: (attempt: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const nap = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * What this deployment can do, retried while it wakes up.
 *
 * Returns `offlineDeployment` only once every attempt has failed. `reachable` is the field that
 * matters to the caller: it separates "the server answered and funds nothing", which is a real
 * state worth acting on, from "the server did not answer", which is a state to wait out.
 */
export async function loadDeployment(signal?: AbortSignal, options: LoadOptions = {}): Promise<Deployment> {
  const attempts = Math.max(1, options.attempts ?? DEPLOYMENT_ATTEMPTS);
  const sleep = options.sleep ?? nap;
  for (let attempt = 1; ; attempt++) {
    const result = await attemptLoad(signal, options.timeoutMs ?? DEPLOYMENT_TIMEOUT_MS);
    if (result.reachable) return result;
    // The caller went away — a closed tab is not something to retry into.
    if (signal?.aborted || attempt >= attempts) return offlineDeployment;
    options.onRetry?.(attempt);
    await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
  }
}

async function attemptLoad(signal: AbortSignal | undefined, timeoutMs: number): Promise<Deployment> {
  try {
    const response = await fetch('/api/providers', { credentials: 'same-origin', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeoutMs)]) });
    if (!response.ok) return offlineDeployment;
    const body = await response.json() as { free?: Partial<FreeTier>; billing?: unknown; gateway?: unknown; gatewayCatalog?: unknown; ollamaBridge?: string | null };
    const free = body.free ?? {};
    return {
      reachable: true,
      billing: billingFrom(body.billing),
      gateway: typeof body.gateway === 'string' && /^https:\/\//.test(body.gateway) ? body.gateway : null,
      gatewayCatalog: gatewayCatalogFrom(body.gatewayCatalog),
      ollamaBridge: typeof body.ollamaBridge === 'string' ? body.ollamaBridge : null,
      free: {
        enabled: free.enabled === true && Array.isArray(free.models) && free.models.length > 0,
        models: Array.isArray(free.models) ? free.models.filter((m): m is string => typeof m === 'string') : [],
        providers: providerMap(free.providers),
        monthlyCredits: Number.isFinite(free.monthlyCredits) ? Number(free.monthlyCredits) : DEFAULT_FREE_POOL,
        perHour: Number.isFinite(free.perHour) ? Number(free.perHour) : 0,
      },
    };
  } catch { return offlineDeployment; }
}

/** Whether a background worker is available to run heavy workflows off the browser. */
export async function loadWorkerStatus(signal?: AbortSignal): Promise<{ worker: boolean; depth: number }> {
  try {
    const response = await fetch('/api/jobs', { credentials: 'same-origin', headers: { 'X-Workspace-Id': workspaceId() }, signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(8000)]) });
    if (!response.ok) return { worker: false, depth: 0 };
    const body = await response.json() as { worker?: boolean; depth?: number };
    return { worker: body.worker === true, depth: Number(body.depth) || 0 };
  } catch { return { worker: false, depth: 0 }; }
}
