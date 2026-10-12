import { guessTransport, type McpTransport, type McpAuthHeader } from './mcp';

export type McpPresetGroup = 'Developer' | 'Data and infrastructure' | 'Web and research' | 'Business' | 'File and runtime' | 'Creative media';
export type ServerKind = 'remote' | 'bridge' | 'media';
export interface McpPreset {
  id: string; name: string; url: string; group: McpPresetGroup; blurb: string;
  authHeader?: McpAuthHeader; token: string | null; kind: ServerKind; docs: string; setup?: string; transport?: McpTransport;
}
const remote = (id: string, name: string, url: string, group: McpPresetGroup, blurb: string, token: string, docs: string): McpPreset => ({ id, name, url, group, blurb, token, docs, kind: 'remote', ...(id === 'exa' ? { authHeader: 'x-api-key' as const } : {}) });
const bridge = (id: string, name: string, group: McpPresetGroup, blurb: string, docs: string, setup: string): McpPreset => ({ id, name, url: '', group, blurb, token: 'Your HTTPS bridge access token', docs, setup, kind: 'bridge' });

/** Distinct tool providers. Inference providers belong exclusively to Settings/Admin. */
export const MCP_SERVERS: readonly McpPreset[] = [
  remote('github', 'GitHub', 'https://api.githubcopilot.com/mcp/', 'Developer', 'Repositories, pull requests, issues, and code review.', 'GitHub personal access token', 'https://github.com/github/github-mcp-server'),
  remote('supabase', 'Supabase', 'https://mcp.supabase.com/mcp', 'Data and infrastructure', 'Project schemas, SQL, and database development. Prefer a development project with read-only access.', 'Authorized Supabase OAuth access token or your authenticated bridge', 'https://supabase.com/docs/guides/getting-started/mcp'),
  remote('firecrawl', 'Firecrawl', 'https://mcp.firecrawl.dev/v2/mcp', 'Web and research', 'Scrape, crawl, and extract structured website data.', 'Firecrawl API key', 'https://github.com/firecrawl/firecrawl-mcp-server'),
  remote('exa', 'Exa', 'https://mcp.exa.ai/mcp', 'Web and research', 'Semantic web search and source discovery.', 'Exa API key (or use the public server within its limits)', 'https://docs.exa.ai/reference/exa-mcp'),
  remote('vercel', 'Vercel', 'https://mcp.vercel.com', 'Data and infrastructure', 'Projects, deployments, and build diagnostics.', 'Authorized Vercel OAuth access token or your authenticated bridge', 'https://vercel.com/docs/mcp/vercel-mcp'),
  remote('render', 'Render', 'https://mcp.render.com/mcp', 'Data and infrastructure', 'Services, deployment logs, and infrastructure status.', 'Render API key', 'https://render.com/docs/mcp-server'),
  remote('cloudflare', 'Cloudflare', 'https://bindings.mcp.cloudflare.com/mcp', 'Data and infrastructure', 'Workers bindings, storage, and account infrastructure.', 'Authorized Cloudflare OAuth access token or your authenticated bridge', 'https://github.com/cloudflare/mcp-server-cloudflare'),
  remote('sentry', 'Sentry', 'https://mcp.sentry.dev/mcp', 'Developer', 'Errors, traces, and production debugging.', 'Authorized Sentry OAuth access token or your authenticated bridge', 'https://docs.sentry.io/product/sentry-mcp/'),
  remote('stripe', 'Stripe', 'https://mcp.stripe.com', 'Business', 'Payments, subscriptions, and billing tools.', 'Stripe restricted API key or authorized OAuth token', 'https://docs.stripe.com/mcp'),
  remote('postman', 'Postman', 'https://mcp.postman.com/mcp', 'Developer', 'API collections, contracts, and testing workflows.', 'Postman API key', 'https://learning.postman.com/docs/developer/ai-tools/remote-mcp-server/'),
  remote('figma', 'Figma', 'https://mcp.figma.com/mcp', 'Developer', 'Design context and design-to-code workflows.', 'Authorized Figma OAuth access token or your authenticated bridge', 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/'),
  remote('linear', 'Linear', 'https://mcp.linear.app/mcp', 'Developer', 'Issues, project planning, and engineering tickets.', 'Linear API key or authorized OAuth token', 'https://linear.app/docs/mcp'),
  remote('slack', 'Slack', 'https://mcp.slack.com/mcp', 'Business', 'Workspace search and collaboration. Requires an approved Slack app.', 'Authorized Slack user OAuth token with MCP scopes; not a bot token', 'https://docs.slack.dev/ai/slack-mcp-server/'),
  remote('notion', 'Notion', 'https://mcp.notion.com/mcp', 'Business', 'Workspace pages, knowledge, and documentation.', 'Authorized Notion OAuth access token or your authenticated bridge; not an integration key', 'https://developers.notion.com/docs/get-started-with-mcp'),
  remote('neon', 'Neon', 'https://mcp.neon.tech/mcp', 'Data and infrastructure', 'Postgres branches, migrations, and database diagnostics.', 'Neon API key or authorized OAuth token', 'https://neon.com/docs/ai/neon-mcp-server'),
  bridge('filesystem', 'Local Filesystem', 'File and runtime', 'Read and write explicitly allowed directories on your own machine.', 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem', 'Run @modelcontextprotocol/server-filesystem with an explicit directory allowlist behind your authenticated HTTPS MCP bridge. This hosted app cannot access your disk directly.'),
  bridge('sqlite', 'SQLite', 'File and runtime', 'Inspect and query a database you explicitly attach to a local bridge.', 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite', 'Choose a maintained SQLite MCP server, bind only your chosen database, and expose it through an authenticated HTTPS bridge. The upstream reference server is archived.'),
  bridge('docker', 'Docker / Container CLI', 'File and runtime', 'Container diagnostics through a separately controlled runtime.', 'https://docs.docker.com/ai/mcp-catalog-and-toolkit/', 'Configure Docker MCP Toolkit locally and expose selected tools through an authenticated HTTPS MCP bridge. Docker socket access is privileged; review every action.'),
  bridge('brave', 'Brave Search', 'Web and research', 'Independent web and local search using your Brave Search key.', 'https://github.com/brave/brave-search-mcp-server', 'Run the official Brave Search MCP server with BRAVE_API_KEY on your bridge, then enter its HTTPS MCP URL below. Do not paste the search API endpoint as an MCP URL.'),
  bridge('puppeteer', 'Puppeteer / Fetch', 'Web and research', 'Browser automation and rendered page inspection.', 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/puppeteer', 'Attach a maintained browser MCP server to your HTTPS bridge. The upstream Puppeteer reference is archived. The Web tab also offers the built-in public-page fetch tool.'),
  bridge('playwright', 'Playwright', 'Developer', 'Browser interactions, accessibility snapshots, and end-to-end checks.', 'https://github.com/microsoft/playwright-mcp', 'Run @playwright/mcp on an isolated browser profile behind your authenticated HTTPS MCP bridge. Enter the bridge URL below.'),
  bridge('tavily', 'Tavily', 'Web and research', 'Agent research, extraction, and grounded search.', 'https://github.com/tavily-ai/tavily-mcp', 'Use the official Tavily MCP setup with TAVILY_API_KEY on your authenticated bridge, then paste its HTTPS MCP endpoint below.'),
  bridge('resend', 'Resend', 'Business', 'Transactional email tools with explicit approval before sending.', 'https://github.com/resend/mcp-send-email', 'Run the official Resend MCP server with your restricted Resend key behind an authenticated HTTPS bridge. Review recipients and payload before each send.'),
  { id: 'heygen', name: 'HeyGen / Video Avatar Generator', kind: 'media', url: '', group: 'Creative media', blurb: 'Optional avatar videos. Uses your HeyGen key only when requested and approved.', token: 'HeyGen API key', docs: 'https://developers.heygen.com/reference/create-video' },
  { id: 'nano-banana', name: 'Nano Banana / Image Generation', kind: 'media', url: '', group: 'Creative media', blurb: 'Optional marketing images and multimodal assets. Separate from coding inference.', token: 'Google Gemini image-generation API key', docs: 'https://ai.google.dev/gemini-api/docs/image-generation' },
];
export const MCP_PRESETS = MCP_SERVERS;
export const MCP_PRESET_GROUPS: McpPresetGroup[] = ['Developer', 'File and runtime', 'Data and infrastructure', 'Web and research', 'Business', 'Creative media'];
export function presetForm(preset: Pick<McpPreset, 'name' | 'url' | 'transport' | 'authHeader'>): { name: string; url: string; transport: McpTransport; authHeader: McpAuthHeader } {
  return { name: preset.name, url: preset.url, transport: preset.transport ?? guessTransport(preset.url), authHeader: preset.authHeader ?? 'Authorization' };
}
export function presetConnected(preset: Pick<McpPreset, 'url'>, connections: { url: string }[]): boolean {
  if (!preset.url) return false;
  const key = (value: string) => { try { const url = new URL(value); return `${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}${url.search}`; } catch { return value; } };
  return connections.some(c => key(c.url) === key(preset.url));
}
