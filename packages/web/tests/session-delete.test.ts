import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushDeletes, removeSessionEverywhere, storage } from '../src/lib/store';

const KEY = 'sf-deleted-sessions';
let removed: string[]; let fail: boolean; let store: Map<string, string>;
beforeEach(() => {
  removed = []; fail = false; store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  vi.spyOn(storage, 'artifacts').mockResolvedValue([]);
  vi.spyOn(storage, 'executionEvents').mockResolvedValue([]);
  vi.spyOn(storage, 'removeSession').mockImplementation(async (id: string) => { removed.push(id); });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => _url === '/api/workspace/session' ? new Response(JSON.stringify({ workspaceId: '11111111-2222-4333-8444-555555555555' })) : fail ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ ok: true, sent: JSON.parse(String(init?.body ?? '{}')) }), { headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('deleting a session', () => {
  it('removes it locally and tells the server, leaving nothing queued', async () => {
    await removeSessionEverywhere('s1');
    expect(removed).toEqual(['s1']);
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(call => call[0] === '/api/state/delete')!;
    expect(call[0]).toBe('/api/state/delete');
    expect(JSON.parse(call[1].body)).toEqual({ sessions: ['s1'] });
    expect(store.has(KEY)).toBe(false);
  });

  it('keeps the id queued when the server does not answer, and retries it later', async () => {
    fail = true;
    await removeSessionEverywhere('s1');
    await removeSessionEverywhere('s2');
    expect(JSON.parse(store.get(KEY)!)).toEqual(['s1', 's2']);
    fail = false;
    await flushDeletes();
    expect(store.has(KEY)).toBe(false);
    const last = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(JSON.parse(last[1].body)).toEqual({ sessions: ['s1', 's2'] });
  });

  it('does nothing when there is nothing queued', async () => {
    await flushDeletes();
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('deletes only the selected session artifacts and execution events', async () => {
  vi.spyOn(storage, 'artifacts').mockResolvedValue([{ id: 'a1', sessionId: 's1' }, { id: 'a2', sessionId: 's2' }] as Awaited<ReturnType<typeof storage.artifacts>>);
  vi.spyOn(storage, 'executionEvents').mockResolvedValue([{ id: 'e1', sessionId: 's1' }, { id: 'e2', sessionId: 's2' }] as Awaited<ReturnType<typeof storage.executionEvents>>);
  const removeArtifact = vi.spyOn(storage, 'removeArtifact').mockResolvedValue(undefined);
  const removeEvent = vi.spyOn(storage, 'removeExecutionEvent').mockResolvedValue(undefined);
  await removeSessionEverywhere('s1');
  expect(removeArtifact.mock.calls).toEqual([['a1']]); expect(removeEvent.mock.calls).toEqual([['e1']]);
});
