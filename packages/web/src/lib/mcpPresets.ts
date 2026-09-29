import { guessTransport, type McpTransport } from './mcp';

// A starter catalog of remote MCP servers, so "Custom MCP" is not a blank URL box.
//
// The connect flow here is a bearer token over https (see lib/mcp.ts), so this list holds servers
// that accept one — an API key, personal access token, or none at all. Servers that only speak
// OAuth (Slack, Figma, Canva, Asana, Atlassian and friends) are deliberately absent: picking one
// would produce a preset that can never connect from this app, which is worse than not listing it.
//
// A preset only prefills the form. Nothing is connected until the person presses "Connect and list
// tools", which is also where a wrong or moved URL surfaces as a readable error.

export type McpPresetGroup = 'Developer' | 'Docs and search' | 'Data and infrastructure' | 'Business';

export interface McpPreset {
  id: string;
  name: string;
  url: string;
  group: McpPresetGroup;
  blurb: string;
  /** What to paste into the token field, or null when the server needs no credential. */
  token: string | null;
  transport?: McpTransport;
}

export const MCP_PRESETS: McpPreset[] = [
  { id: 'github', name: 'GitHub (write-capable)', url: 'https://api.githubcopilot.com/mcp/', group: 'Developer', blurb: 'Issues, pull requests, branches, code search', token: 'GitHub personal access token' },
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp', group: 'Developer', blurb: 'Issues, projects, cycles', token: 'Linear API key' },
  { id: 'sentry', name: 'Sentry', url: 'https://mcp.sentry.dev/mcp', group: 'Developer', blurb: 'Errors, releases, performance traces', token: 'Sentry user auth token' },
  { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/mcp', group: 'Developer', blurb: 'Search models, datasets, and Spaces', token: 'Hugging Face access token' },

  { id: 'context7', name: 'Context7', url: 'https://mcp.context7.com/mcp', group: 'Docs and search', blurb: 'Current library documentation by version', token: null },
  { id: 'deepwiki', name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp', group: 'Docs and search', blurb: 'Ask questions about any public GitHub repo', token: null },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', url: 'https://docs.mcp.cloudflare.com/mcp', group: 'Docs and search', blurb: 'Search the Cloudflare developer docs', token: null },
  { id: 'exa', name: 'Exa Search', url: 'https://mcp.exa.ai/mcp', group: 'Docs and search', blurb: 'Web search built for agents', token: 'Exa API key' },

  { id: 'supabase', name: 'Supabase', url: 'https://mcp.supabase.com/mcp', group: 'Data and infrastructure', blurb: 'Projects, tables, SQL, edge functions', token: 'Supabase personal access token' },
  { id: 'neon', name: 'Neon', url: 'https://mcp.neon.tech/mcp', group: 'Data and infrastructure', blurb: 'Serverless Postgres branches and queries', token: 'Neon API key' },
  { id: 'render', name: 'Render', url: 'https://mcp.render.com/mcp', group: 'Data and infrastructure', blurb: 'Services, deploys, logs, metrics', token: 'Render API key' },

  { id: 'stripe', name: 'Stripe', url: 'https://mcp.stripe.com', group: 'Business', blurb: 'Customers, invoices, payments, subscriptions', token: 'Stripe restricted API key' },
];

export const MCP_PRESET_GROUPS: McpPresetGroup[] = ['Developer', 'Docs and search', 'Data and infrastructure', 'Business'];

/** The values a preset writes into the Add-a-server form. */
export function presetForm(preset: McpPreset): { name: string; url: string; transport: McpTransport } {
  return { name: preset.name, url: preset.url, transport: preset.transport ?? guessTransport(preset.url) };
}

/** True when a server at this URL is already connected, so the catalog can mark it instead of duplicating it. */
export function presetConnected(preset: McpPreset, connections: { url: string }[]): boolean {
  const key = (u: string) => { try { const p = new URL(u); return `${p.host}${p.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return u.toLowerCase(); } };
  return connections.some(c => key(c.url) === key(preset.url));
}
