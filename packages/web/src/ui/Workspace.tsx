import type { CSSProperties, ReactNode } from 'react';
import { clampSplit } from '../lib/split';
export interface WorkspaceProps { previewOpen: boolean; resizing: boolean; chatPercent: number; children: ReactNode; }
/** Keeps session state in App while presenting the developer conversation and execution pane side by side. */
export default function Workspace({ previewOpen, resizing, chatPercent, children }: WorkspaceProps) {
  const left = clampSplit(chatPercent);
  return <div className={`${previewOpen ? 'workspace with-preview' : 'workspace'}${resizing ? ' resizing' : ''}`} aria-label="Developer workspace" style={previewOpen ? { '--chat-column': `${left}fr`, '--preview-column': `${100 - left}fr` } as CSSProperties : undefined}>{children}</div>;
}
