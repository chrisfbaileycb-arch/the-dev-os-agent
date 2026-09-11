// Tool-call protocol for chat agents. The model answers with exactly one line that starts
// with TOOL and a JSON object naming a tool the workspace offered; the workspace runs it and
// replies with TOOL RESULT. Tools come from the persona (inspect_page) and from connected MCP
// servers. Small, explicit, and easy to audit in the transcript.

export interface ToolOutput { output: string; summary: string; }
export interface ToolSpec { name: string; description: string; run: (args: Record<string, unknown>, signal: AbortSignal) => Promise<string | ToolOutput>; }
export interface ToolCall { tool: string; args: Record<string, unknown>; }
export interface PageReport { url: string; status: number; title: string; description: string; canonical: string; robots: string; lang: string; h1: string[]; headingCount: number; og: Record<string, string>; wordCount: number; text: string; links: { href: string; text: string }[]; elapsedMs: number; }

export function toolProtocol(specs: ToolSpec[]): string {
  return `TOOLS\nYou may call one tool per reply by answering with a single line and nothing else:\nTOOL {"tool": "<name>", "args": { ... }}\nAvailable:\n${specs.map(s => `- ${s.description}`).join('\n')}\nAfter a TOOL RESULT message, continue the task. Call at most three tools per user message, then answer in prose.`;
}

export function parseToolCall(text: string, specs: ToolSpec[]): ToolCall | null {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  if (!line.startsWith('TOOL ')) return null;
  try {
    const parsed = JSON.parse(line.slice(5)) as Record<string, unknown>;
    if (typeof parsed.tool !== 'string' || !specs.some(s => s.name === parsed.tool)) return null;
    const { tool, args, ...rest } = parsed;
    const finalArgs = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : rest;
    return { tool, args: finalArgs };
  } catch { return null; }
}

export async function inspectPage(url: string, signal: AbortSignal): Promise<PageReport> {
  const response = await fetch('/api/browse', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error?.message === 'string' ? body.error.message : `Browser runner failed (HTTP ${response.status}).`);
  return body as PageReport;
}

export function summarizeReport(r: PageReport): string {
  return `url: ${r.url}\nstatus: ${r.status}\ntitle: ${r.title}\ndescription: ${r.description}\ncanonical: ${r.canonical}\nrobots: ${r.robots}\nlang: ${r.lang}\nh1: ${r.h1.join(' | ')}\nheadings: ${r.headingCount}\nog: ${Object.entries(r.og).map(([k, v]) => `${k}=${v}`).join('; ')}\nwords: ${r.wordCount}\nlinks (${r.links.length}): ${r.links.slice(0, 25).map(l => `${l.text || '(no text)'} -> ${l.href}`).join('\n  ')}\ntext:\n${r.text}`;
}

export const inspectPageSpec: ToolSpec = {
  name: 'inspect_page',
  description: 'inspect_page {"url": "https://example.com/page"}: open one public page in the sandbox browser and return its title, description, canonical, robots, headings, social tags, visible text, and links.',
  run: async (args, signal) => { const report = await inspectPage(String(args.url ?? ''), signal); return { output: summarizeReport(report), summary: `${report.status} ${report.title || report.url} (${report.wordCount} words)` }; },
};
