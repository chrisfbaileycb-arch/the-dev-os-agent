import type { Provider } from './providers';
export type Mode = 'demo' | 'remote';
export type Workflow = 'build' | 'research' | 'review';
export interface Connection { provider?: Provider; saveKey?: boolean; serverAccessToken?: string; mode: Mode; endpoint: string; model: string; token: string; maxTokens: number; }
export interface Knowledge { id: string; title: string; content: string; createdAt: string; }
export interface StepView { id: string; title: string; agent: string; status: string; output?: string; error?: string; attempts: number; }
export interface Run { id: string; goal: string; workflow: Workflow; mode: Mode; model: string; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; startedAt: string; completedAt?: string; steps: StepView[]; tokens: number; calls: number; cacheHits: number; contextTitles: string[]; }
export interface StartMessage { type: 'start'; runId: string; goal: string; workflow: Workflow; connection: Connection; knowledge: Knowledge[]; }
export type WorkerMessage = StartMessage | { type: 'cancel' };
export type WorkerEvent = { type: 'update'; run: Run } | { type: 'done'; run: Run } | { type: 'error'; message: string };
export interface Completion { text: string; tokens: number; }
