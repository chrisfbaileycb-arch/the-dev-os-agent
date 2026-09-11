import { DEFAULT_FREE_POOL } from './catalog';
import { workspaceId } from './store';
import type { FreeTier } from './store';

// What this particular deployment can do, read once at startup from /api/providers.
//
// The zero-config tier only works if the server holds provider keys, so the browser asks
// before promising anything: the model dropdown marks free entries live or locked from this
// answer, and a deployment with no keys falls back to the scripted preview instead of failing
// on the visitor's first message.

export interface Deployment { free: FreeTier; ollamaBridge: string | null; reachable: boolean; }

export const offlineDeployment: Deployment = {
  free: { enabled: false, models: [], monthlyCredits: DEFAULT_FREE_POOL, perHour: 0 },
  ollamaBridge: null,
  reachable: false,
};

export async function loadDeployment(signal?: AbortSignal): Promise<Deployment> {
  try {
    const response = await fetch('/api/providers', { credentials: 'same-origin', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10_000)]) });
    if (!response.ok) return offlineDeployment;
    const body = await response.json() as { free?: Partial<FreeTier>; ollamaBridge?: string | null };
    const free = body.free ?? {};
    return {
      reachable: true,
      ollamaBridge: typeof body.ollamaBridge === 'string' ? body.ollamaBridge : null,
      free: {
        enabled: free.enabled === true && Array.isArray(free.models) && free.models.length > 0,
        models: Array.isArray(free.models) ? free.models.filter((m): m is string => typeof m === 'string') : [],
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
