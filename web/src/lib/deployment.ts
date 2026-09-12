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

export async function loadDeployment(signal?: AbortSignal): Promise<Deployment> {
  try {
    const response = await fetch('/api/providers', { credentials: 'same-origin', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10_000)]) });
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
