import type { Provider } from './providers';
import type { InferenceMode } from './catalog';
import type { Persona } from './roster';
export type Mode = 'demo' | 'remote';
export type Workflow = 'build' | 'research' | 'review';
export interface Connection { provider?: Provider; saveKey?: boolean; serverAccessToken?: string; mode: Mode; inference?: InferenceMode; endpoint: string; model: string; token: string; maxTokens: number; }
export interface Knowledge { id: string; title: string; content: string; createdAt: string; }
export interface StepView { id: string; title: string; agent: string; status: string; output?: string; error?: string; attempts: number; }
/** `origin` records where the stages ran: this browser's Web Worker, or the Render background worker. */
export interface Run { id: string; goal: string; workflow: Workflow; mode: Mode; model: string; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; startedAt: string; completedAt?: string; steps: StepView[]; tokens: number; calls: number; cacheHits: number; contextTitles: string[]; sessionId?: string; persona?: string; origin?: 'browser' | 'server'; }
/**
 * `leadPersona` carries the lead agent itself, not only its id. A custom agent lives in
 * localStorage, which a Web Worker cannot read, so an id alone would resolve to the default agent
 * inside the worker and quietly drop the lead context of the very agent the user wrote.
 */
export interface StartMessage { type: 'start'; runId: string; goal: string; workflow: Workflow; connection: Connection; knowledge: Knowledge[]; sessionId?: string; persona?: string; leadPersona?: Persona; attachments?: { name: string; content: string }[]; }
export type WorkerMessage = StartMessage | { type: 'cancel' };
export type WorkerEvent = { type: 'update'; run: Run } | { type: 'done'; run: Run } | { type: 'error'; message: string };
export interface Completion { text: string; tokens: number; }
