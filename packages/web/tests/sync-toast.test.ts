import { describe, expect, it } from 'vitest';
import { errorToast } from '../src/ui/GithubSyncDrawer';
import { GithubApiError } from '../src/lib/githubSync';

describe('errorToast', () => {
  it('titles the actionable GitHub statuses by code', () => {
    expect(errorToast('pull', new GithubApiError(401, 'x')).title).toContain('401 Unauthorized');
    expect(errorToast('push', new GithubApiError(409, 'x')).title).toContain('409 SHA conflict');
    expect(errorToast('push', new GithubApiError(422, 'x')).title).toContain('422');
  });
  it('falls back to the error text for anything else', () => {
    const t = errorToast('pull', new Error('offline'));
    expect(t).toEqual({ tone: 'error', title: 'Pull failed · ', message: 'offline' });
  });
});
