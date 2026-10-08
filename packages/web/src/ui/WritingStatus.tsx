import { useEffect, useRef, useState } from 'react';
import { Hourglass } from 'lucide-react';
import { isStalled, quietSeconds, writingLabel } from '../lib/activity';

// The hourglass that shows a reply is being written.
//
// It flips while the text is growing, holds still and turns amber when nothing new has arrived for
// a few seconds (see lib/activity.ts), and shows a running character count so "is it writing?" has
// a visible answer: the number moves, or it does not.

/** The icon on its own, for places that only need the motion. `active` false holds it still. */
export function HourglassIcon({ active = true, stalled = false, size = 14 }: { active?: boolean; stalled?: boolean; size?: number }) {
  return <span className={`hourglass${active && !stalled ? ' turning' : ''}${stalled ? ' stalled' : ''}`} aria-hidden="true"><Hourglass size={size} strokeWidth={1.9} /></span>;
}

/**
 * Watch a growing string. While `working`, returns whether it has gone quiet and for how long; the
 * clock only runs during a reply, so an idle page has no timer.
 */
export function useWritingActivity(content: string, working: boolean) {
  const lastChange = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { lastChange.current = Date.now(); setNow(Date.now()); }, [content, working]);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);
  return { stalled: working && isStalled(lastChange.current, now), quiet: quietSeconds(lastChange.current, now) };
}

/** Hourglass plus a status line for one in-progress reply. Renders nothing once the reply is done. */
export default function WritingStatus({ content, working, code = false }: { content: string; working: boolean; code?: boolean }) {
  const { stalled, quiet } = useWritingActivity(content, working);
  if (!working) return null;
  return <p className={`writing-status${stalled ? ' stalled' : ''}`} role="status"><HourglassIcon stalled={stalled} /><span>{writingLabel({ chars: content.length, code, stalled, quiet })}</span></p>;
}
