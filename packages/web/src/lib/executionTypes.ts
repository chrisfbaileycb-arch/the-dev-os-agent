export type SandboxStatus = 'Idle' | 'Running' | 'Success' | 'Error Trapped';
export interface RuntimeArtifact {
  id: string; sessionId: string; runId?: string; stepId?: string; callId?: string;
  path: string; mimeType: string; encoding: 'utf8' | 'base64'; content: string;
  createdAt: string; source: string;
}
export type ArtifactOutput = Omit<RuntimeArtifact, 'id' | 'sessionId' | 'runId' | 'stepId' | 'callId' | 'createdAt'>;
export interface ExecutionEvent {
  id: string; sessionId: string; runId?: string; stepId?: string; callId?: string;
  at: string; kind: 'skill' | 'step' | 'tool' | 'runtime'; status: SandboxStatus;
  title: string; connector?: string; args?: Record<string, unknown>; stdout?: string;
  durationMs?: number; artifactIds?: string[];
}
