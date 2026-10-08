import { guessTransport, type McpTransport } from './mcp';

// Bookmarks for remote MCP servers the visitor connects with their own token.
// Nothing in this list runs inside the app. A server answers only if that URL
// is a real public MCP endpoint. Fake in-process tools (filesystem, SQL,
// sequential thinking, and the other scripted ECC stand-ins) are not here.

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
  { id: 'github', name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', group: 'Developer', blurb: 'Repos, pull requests, and issues on the visitor\'s own GitHub token', token: 'GitHub personal access token' },
  { id: 'supabase', name: 'Supabase', url: 'https://mcp.supabase.com/mcp', group: 'Data and infrastructure', blurb: 'The visitor\'s own Supabase project', token: 'Supabase personal access token' },
  { id: 'firecrawl', name: 'Firecrawl', url: 'https://mcp.firecrawl.dev/mcp', group: 'Docs and search', blurb: 'Page scrape on a Firecrawl key', token: 'Firecrawl API key' },
  { id: 'exa', name: 'Exa', url: 'https://mcp.exa.ai/mcp', group: 'Docs and search', blurb: 'Web search on an Exa key', token: 'Exa API key' },
  { id: 'vercel', name: 'Vercel', url: 'https://mcp.vercel.com/mcp', group: 'Data and infrastructure', blurb: 'The visitor\'s own Vercel projects', token: 'Vercel API token' },
  { id: 'render', name: 'Render', url: 'https://mcp.render.com/mcp', group: 'Data and infrastructure', blurb: 'The visitor\'s own Render services', token: 'Render API key' },
  { id: 'cloudflare', name: 'Cloudflare', url: 'https://mcp.cloudflare.com/mcp', group: 'Data and infrastructure', blurb: 'The visitor\'s own Cloudflare account', token: 'Cloudflare API token' },
  { id: 'sentry', name: 'Sentry', url: 'https://mcp.sentry.dev/mcp', group: 'Developer', blurb: 'The visitor\'s own Sentry issues', token: 'Sentry user auth token' },
  { id: 'stripe', name: 'Stripe', url: 'https://mcp.stripe.com', group: 'Business', blurb: 'The visitor\'s own Stripe account', token: 'Stripe restricted API key' },
  { id: 'postman', name: 'Postman', url: 'https://mcp.postman.com/mcp', group: 'Developer', blurb: 'The visitor\'s own Postman collections', token: 'Postman API key' },
  { id: 'figma', name: 'Figma', url: 'https://mcp.figma.com/mcp', group: 'Developer', blurb: 'The visitor\'s own Figma files', token: 'Figma personal access token' },
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp', group: 'Developer', blurb: 'The visitor\'s own Linear workspace', token: 'Linear API key' },
  { id: 'slack', name: 'Slack', url: 'https://mcp.slack.com/mcp', group: 'Business', blurb: 'The visitor\'s own Slack workspace', token: 'Slack bot user token (xoxb-…)' },
  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp', group: 'Docs and search', blurb: 'The visitor\'s own Notion workspace', token: 'Notion integration token' },
  { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/mcp', group: 'Developer', blurb: 'Search models, datasets, and Spaces', token: 'Hugging Face access token' },
  { id: 'neon', name: 'Neon', url: 'https://mcp.neon.tech/mcp', group: 'Data and infrastructure', blurb: 'The visitor\'s own Neon project', token: 'Neon API key' },
  { id: 'context7', name: 'Context7', url: 'https://mcp.context7.com/mcp', group: 'Docs and search', blurb: 'Current library documentation by version', token: null },
  { id: 'deepwiki', name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp', group: 'Docs and search', blurb: 'Ask questions about any public GitHub repo', token: null },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', url: 'https://docs.mcp.cloudflare.com/mcp', group: 'Docs and search', blurb: 'Search the Cloudflare developer docs', token: null },
];

export const MCP_PRESET_GROUPS: McpPresetGroup[] = ['Developer', 'Data and infrastructure', 'Docs and search', 'Business'];

/** The values a preset writes into the Add-a-server form. */
export function presetForm(preset: McpPreset): { name: string; url: string; transport: McpTransport } {
  return { name: preset.name, url: preset.url, transport: preset.transport ?? guessTransport(preset.url) };
}

/** True when a server at this URL is already connected, so the catalog can mark it instead of duplicating it. */
export function presetConnected(preset: McpPreset, connections: { url: string }[]): boolean {
  const key = (u: string) => { try { const p = new URL(u); return `${p.host}${p.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return u.toLowerCase(); } };
  return connections.some(c => key(c.url) === key(preset.url));
}
