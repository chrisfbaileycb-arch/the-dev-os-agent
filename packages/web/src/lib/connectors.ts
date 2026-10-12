export * from './toolAdapters';
import { githubSpecs, webSpecs, knowledgeSpecs, type ConnectorSettings } from './toolAdapters';
import { mcpToolSpecs, type McpConnection } from './mcp';
import { inspectPageSpec, type ToolSpec } from './tools';
import type { Knowledge } from './types';
import { CREW_SKILLS, loadSkillState } from './skillRegistry';

export interface ToolContext { settings: ConnectorSettings; mcp: McpConnection[]; knowledge: Knowledge[]; search: (query: string, docs: Knowledge[], limit?: number) => Knowledge[]; personaTools?: string[]; }

/** Every tool available for one turn, in the order the model sees them. */
export function activeTools(context: ToolContext): ToolSpec[] {
  const state = loadSkillState();
  const resourceSkills = CREW_SKILLS.filter(s => state.some(row => row.id === s.id && row.enabled) && Object.keys(s.resources ?? {}).length);
  return [
    ...(context.personaTools?.includes('inspect_page') ? [inspectPageSpec] : []),
    ...githubSpecs(context.settings.github),
    ...webSpecs(context.settings.web),
    ...knowledgeSpecs(context.settings.knowledge, context.knowledge, context.search),
    ...mcpToolSpecs(context.mcp),
    ...(resourceSkills.length ? [{
      name: 'read_skill_resource',
      description: `read_skill_resource {"skill":"skill-id","path":"resource-path"}: read a complete supporting file from an enabled skill. Available: ${resourceSkills.map(s => `${s.id}: ${Object.keys(s.resources ?? {}).join(', ')}`).join('; ')}. Reading a script does not execute it.`,
      run: async (args: Record<string, unknown>) => {
        const skill = resourceSkills.find(s => s.id === args.skill);
        const path = typeof args.path === 'string' ? args.path : '';
        if (!skill || !Object.hasOwn(skill.resources ?? {}, path)) throw new Error('That resource is not part of an enabled skill.');
        return { output: skill.resources![path], summary: `${skill.name}: ${path}` };
      },
    }] : []),
  ];
}

/** How many connectors are switched on, for the dock badge. */
export function activeCount(settings: ConnectorSettings, mcp: McpConnection[]): number {
  return (settings.github.enabled ? 1 : 0) + (settings.web.enabled ? 1 : 0) + (settings.knowledge.enabled ? 1 : 0) + mcp.filter(c => c.enabled && c.tools.length).length;
}
