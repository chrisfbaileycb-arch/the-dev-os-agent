import type { LucideIcon } from 'lucide-react';

/**
 * The GitHub mark, drawn here rather than imported.
 *
 * lucide-react carried brand logos up to 0.x and dropped them all at 1.0 for trademark reasons,
 * so `Github` is gone and the connectors hub, the push drawer, and the preview toolbar no longer
 * compile against the new version. The alternatives were worse: `GitBranch` is a generic git
 * glyph that stops saying "GitHub" in a list of four connectors, and dropping the mark costs the
 * one visual cue that says which service a button talks to.
 *
 * So the silhouette is inlined as a 24x24 path on the same viewBox and stroke contract every
 * lucide icon uses, which means it accepts size/strokeWidth/className and sits in a row of lucide
 * icons without looking foreign. GitHub's logo is used to refer to GitHub itself, which its brand
 * guidelines permit.
 */
export const GithubMark: LucideIcon = (({ size = 24, strokeWidth = 2, ...rest }: { size?: number | string; strokeWidth?: number | string } & Record<string, unknown>) =>
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>) as unknown as LucideIcon;

export default GithubMark;