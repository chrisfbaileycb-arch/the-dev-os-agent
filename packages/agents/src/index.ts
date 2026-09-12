// @hey-buddy/agents — persona definitions, workflow configurations, and shared agent types.
//
// This package is the canonical source for what agents exist and what they do.
// packages/web imports these definitions and wraps them in React UI.
// Future packages (CLI, API, Slack bot) can import the same definitions without
// pulling in React or browser-specific code.

export type PersonaGroup = 'general' | 'business' | 'skills' | 'custom';

export type AgentRole = 'planner' | 'researcher' | 'core-architect' | 'reviewer' | 'queen-coordinator';

export interface PersonaMeta {
  id: string;
  name: string;
  group: PersonaGroup;
  tagline: string;
  icon: string;
  capabilities: string[];
  role?: AgentRole;
}

export type WorkflowId = 'research' | 'build' | 'audit' | 'draft' | 'review';

export interface WorkflowMeta {
  id: WorkflowId;
  label: string;
  verb: string;
  description: string;
  steps: AgentRole[];
}

// Persona catalog — stable ids used as keys across sessions, runs, and URLs.
export const PERSONA_IDS = [
  'assistant', 'coder', 'chat',
  'operator', 'auditor', 'reputation', 'browser',
  'dispatcher', 'researcher', 'architect', 'reviewer', 'scribe',
] as const;

export type PersonaId = typeof PERSONA_IDS[number];

// Workflow catalog — ordered sequences of specialist agents.
export const WORKFLOW_IDS: WorkflowId[] = ['research', 'build', 'audit', 'draft', 'review'];

export const workflowMeta: Record<WorkflowId, WorkflowMeta> = {
  research: { id: 'research', label: 'Research', verb: 'Research', description: 'Dispatcher → Researcher → Scribe', steps: ['planner', 'researcher', 'queen-coordinator'] },
  build: { id: 'build', label: 'Build', verb: 'Build', description: 'Dispatcher → Researcher → Architect → Reviewer → Scribe', steps: ['planner', 'researcher', 'core-architect', 'reviewer', 'queen-coordinator'] },
  audit: { id: 'audit', label: 'Audit', verb: 'Audit', description: 'Dispatcher → Researcher → Reviewer → Scribe', steps: ['planner', 'researcher', 'reviewer', 'queen-coordinator'] },
  draft: { id: 'draft', label: 'Draft', verb: 'Draft', description: 'Dispatcher → Researcher → Scribe', steps: ['planner', 'researcher', 'queen-coordinator'] },
  review: { id: 'review', label: 'Review', verb: 'Review', description: 'Researcher → Architect → Reviewer → Scribe', steps: ['researcher', 'core-architect', 'reviewer', 'queen-coordinator'] },
};
