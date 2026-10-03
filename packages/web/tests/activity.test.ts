import { describe, expect, it } from 'vitest';
import { STALL_AFTER_MS, isStalled, quietSeconds, writingLabel } from '../src/lib/activity';

describe('writing activity', () => {
  it('turns while output is fresh and stops once it has been quiet long enough', () => {
    expect(isStalled(1000, 1000 + STALL_AFTER_MS - 1)).toBe(false);
    expect(isStalled(1000, 1000 + STALL_AFTER_MS)).toBe(true);
  });

  it('counts whole quiet seconds and never goes negative', () => {
    expect(quietSeconds(0, 12_900)).toBe(12);
    expect(quietSeconds(5000, 1000)).toBe(0);
  });

  it('says what is happening: working, writing, writing code, or quiet', () => {
    expect(writingLabel({ chars: 0, code: false, stalled: false, quiet: 0 })).toBe('Working…');
    expect(writingLabel({ chars: 1240, code: false, stalled: false, quiet: 0 })).toBe(`Writing · ${(1240).toLocaleString()} characters`);
    expect(writingLabel({ chars: 1240, code: true, stalled: false, quiet: 0 })).toMatch(/^Writing code · /);
    const quiet = writingLabel({ chars: 1240, code: true, stalled: true, quiet: 14 });
    expect(quiet).toMatch(/No new output for 14s/);
    expect(quiet).not.toMatch(/characters/);
  });
});
