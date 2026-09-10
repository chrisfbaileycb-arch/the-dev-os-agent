export type Workflow = "build" | "research" | "review";
export type RunMode = "demo" | "remote";
export type Provider = "openrouter" | "groq" | "cohere" | "custom";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface StepView {
  id: string;
  title: string;
  agent: string;
  type: string;
  status: StepStatus;
  output?: string;
  error?: string;
  attempts: number;
  dependencies: string[];
}

export interface Run {
  id: string;
  goal: string;
  workflow: Workflow;
  mode: RunMode;
  model: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  steps: StepView[];
  tokens: number;
  calls: number;
  cacheHits: number;
  contextTitles: string[];
}

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface Connection {
  mode: RunMode;
  provider: Provider;
  endpoint: string;
  model: string;
  apiKey: string;
  maxTokens: number;
}

export interface Completion {
  text: string;
  tokens: number;
}
