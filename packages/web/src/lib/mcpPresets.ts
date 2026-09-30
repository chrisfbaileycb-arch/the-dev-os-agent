import { guessTransport, type McpTransport } from './mcp';

// Model Context Protocol (MCP) server presets for Signal Forge OS.
//
// Includes protocol-level access to the 20 active MCP integrations:
// 1. GitHub MCP (`github:`)
// 2. Supabase MCP (`supabase:`)
// 3. Database / SQL MCP (`postgres:` / `sqlite:`)
// 4. Playwright MCP (`playwright:`)
// 5. Filesystem MCP (`fs:`)
// 6. Firecrawl MCP (`firecrawl:`)
// 7. Exa MCP (`exa:`)
// 8. Vercel MCP (`vercel:`)
// 9. Render MCP (`render:`)
// 10. Cloudflare MCP (`cloudflare:`)
// 11. Docker MCP (`docker:`)
// 12. Sentry MCP (`sentry:`)
// 13. Stripe MCP (`stripe:`)
// 14. Postman MCP (`postman:`)
// 15. Figma MCP (`figma:`)
// 16. Linear MCP (`linear:`)
// 17. Jira MCP (`jira:`)
// 18. Slack MCP (`slack:`)
// 19. Notion MCP (`notion:`)
// 20. Sequential Thinking MCP (`thinking:`)

export type McpPresetGroup = 'Reasoning' | 'Developer' | 'Docs and search' | 'Data and infrastructure' | 'Business';

export interface McpPreset {
  id: string;
  name: string;
  url: string;
  group: McpPresetGroup;
  blurb: string;
  /** What to paste into the token field, or null when the server needs no credential. */
  token: string | null;
  transport?: McpTransport;
  prefix?: string;
}

export const MCP_PRESETS: McpPreset[] = [
  // 1. Sequential Thinking MCP
  { id: 'thinking', name: 'Sequential Thinking', prefix: 'thinking:', url: 'https://mcp.thinking.internal/mcp', group: 'Reasoning', blurb: 'Dynamic multi-step reasoning scratchpad, hypotheses, pathways, and planning', token: null },

  // 2. GitHub MCP
  { id: 'github', name: 'GitHub', prefix: 'github:', url: 'https://api.githubcopilot.com/mcp/', group: 'Developer', blurb: 'Inspect, fork, branches, PR diffs, issues, and Actions CI/CD', token: 'GitHub personal access token' },

  // 3. Supabase MCP
  { id: 'supabase', name: 'Supabase', prefix: 'supabase:', url: 'https://mcp.supabase.com/mcp', group: 'Data and infrastructure', blurb: 'PostgreSQL schemas, tables, queries, RLS policies, auth', token: 'Supabase personal access token' },

  // 4. Database / SQL MCP
  { id: 'database', name: 'Database / SQL', prefix: 'postgres:', url: 'https://mcp.database.internal/mcp', group: 'Data and infrastructure', blurb: 'Direct database connectivity (Postgres/SQLite), schemas, queries, migrations', token: 'Database connection string (optional)' },

  // 5. Playwright MCP
  { id: 'playwright', name: 'Playwright', prefix: 'playwright:', url: 'https://mcp.playwright.internal/mcp', group: 'Developer', blurb: 'Headless browser automation, DOM snapshots, UI testing, and test traces', token: null },

  // 6. Filesystem MCP
  { id: 'fs', name: 'Filesystem', prefix: 'fs:', url: 'https://mcp.fs.internal/mcp', group: 'Data and infrastructure', blurb: 'Workspace file operations: read, write, search, move, and edit with atomic guarantees', token: null },

  // 7. Firecrawl MCP
  { id: 'firecrawl', name: 'Firecrawl', prefix: 'firecrawl:', url: 'https://mcp.firecrawl.dev/mcp', group: 'Docs and search', blurb: 'Convert live URLs and technical documentation into clean LLM Markdown', token: 'Firecrawl API key' },

  // 8. Exa MCP
  { id: 'exa', name: 'Exa', prefix: 'exa:', url: 'https://mcp.exa.ai/mcp', group: 'Docs and search', blurb: 'Real-time neural developer search, doc updates, and code examples', token: 'Exa API key' },

  // 9. Vercel MCP
  { id: 'vercel', name: 'Vercel', prefix: 'vercel:', url: 'https://mcp.vercel.com/mcp', group: 'Data and infrastructure', blurb: 'Manage frontend deployments, preview builds, build logs, and env vars', token: 'Vercel API token' },

  // 10. Render MCP
  { id: 'render', name: 'Render', prefix: 'render:', url: 'https://mcp.render.com/mcp', group: 'Data and infrastructure', blurb: 'Manage backend web services, workers, cron jobs, logs, and redeployments', token: 'Render API key' },

  // 11. Cloudflare MCP
  { id: 'cloudflare', name: 'Cloudflare', prefix: 'cloudflare:', url: 'https://mcp.cloudflare.com/mcp', group: 'Data and infrastructure', blurb: 'Cloudflare Workers, Pages, D1 SQL, KV namespaces, and DNS routing', token: 'Cloudflare API token' },

  // 12. Docker MCP
  { id: 'docker', name: 'Docker', prefix: 'docker:', url: 'https://mcp.docker.internal/mcp', group: 'Data and infrastructure', blurb: 'Connect to Docker daemons, build images, compose stacks, and container logs', token: null },

  // 13. Sentry MCP
  { id: 'sentry', name: 'Sentry', prefix: 'sentry:', url: 'https://mcp.sentry.dev/mcp', group: 'Developer', blurb: 'Real-time observability, stack traces, crash triaging, and commit isolation', token: 'Sentry user auth token' },

  // 14. Stripe MCP
  { id: 'stripe', name: 'Stripe', prefix: 'stripe:', url: 'https://mcp.stripe.com', group: 'Business', blurb: 'Subscription statuses, webhook deliveries, checkout audits, and billing events', token: 'Stripe restricted API key' },

  // 15. Postman MCP
  { id: 'postman', name: 'Postman', prefix: 'postman:', url: 'https://mcp.postman.com/mcp', group: 'Developer', blurb: 'Import, run, and validate API test collections and response schemas', token: 'Postman API key' },

  // 16. Figma MCP
  { id: 'figma', name: 'Figma', prefix: 'figma:', url: 'https://mcp.figma.com/mcp', group: 'Developer', blurb: 'Read design file nodes, tokens, components, and canvas specs to code', token: 'Figma personal access token' },

  // 17. Linear MCP
  { id: 'linear', name: 'Linear', prefix: 'linear:', url: 'https://mcp.linear.app/mcp', group: 'Developer', blurb: 'Issue backlogs, engineering tasks, cycles, and PR status sync', token: 'Linear API key' },

  // 18. Jira MCP
  { id: 'jira', name: 'Jira', prefix: 'jira:', url: 'https://mcp.jira.internal/mcp', group: 'Developer', blurb: 'Enterprise issue tracking, JQL searches, sprint boards, and dependencies', token: 'Atlassian API token' },

  // 19. Slack MCP
  { id: 'slack', name: 'Slack', prefix: 'slack:', url: 'https://mcp.slack.com/mcp', group: 'Business', blurb: 'Channel alerts, team discussions, incident triage, and deployment summaries', token: 'Slack bot user token (xoxb-…)' },

  // 20. Notion MCP
  { id: 'notion', name: 'Notion', prefix: 'notion:', url: 'https://mcp.notion.com/mcp', group: 'Docs and search', blurb: 'Search internal knowledge bases, architecture decision records (ADRs), PRDs', token: 'Notion integration token' },

  // Additional Community Presets
  { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/mcp', group: 'Developer', blurb: 'Search models, datasets, and Spaces', token: 'Hugging Face access token' },
  { id: 'neon', name: 'Neon', url: 'https://mcp.neon.tech/mcp', group: 'Data and infrastructure', blurb: 'Serverless Postgres branches and queries', token: 'Neon API key' },
  { id: 'context7', name: 'Context7', url: 'https://mcp.context7.com/mcp', group: 'Docs and search', blurb: 'Current library documentation by version', token: null },
  { id: 'deepwiki', name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp', group: 'Docs and search', blurb: 'Ask questions about any public GitHub repo', token: null },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', url: 'https://docs.mcp.cloudflare.com/mcp', group: 'Docs and search', blurb: 'Search the Cloudflare developer docs', token: null },
];

export const MCP_PRESET_GROUPS: McpPresetGroup[] = ['Reasoning', 'Developer', 'Data and infrastructure', 'Docs and search', 'Business'];

/** The values a preset writes into the Add-a-server form. */
export function presetForm(preset: McpPreset): { name: string; url: string; transport: McpTransport } {
  return { name: preset.name, url: preset.url, transport: preset.transport ?? guessTransport(preset.url) };
}

/** True when a server at this URL is already connected, so the catalog can mark it instead of duplicating it. */
export function presetConnected(preset: McpPreset, connections: { url: string }[]): boolean {
  const key = (u: string) => { try { const p = new URL(u); return `${p.host}${p.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return u.toLowerCase(); } };
  return connections.some(c => key(c.url) === key(preset.url));
}
