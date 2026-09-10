import type { ToolName } from './roster';

// Tool-call protocol for chat agents that carry tools. The model answers with exactly one line
// that starts with TOOL and a JSON object; the workspace runs it and replies with TOOL RESULT.
// Small, explicit, and easy to audit in the transcript.

export interface ToolCall { tool: ToolName; args: Record<string, string>; }
export interface PageReport { url: string; status: number; title: string; description: string; canonical: string; robots: string; lang: string; h1: string[]; headingCount: number; og: Record<string, string>; wordCount: number; text: string; links: { href: string; text: string }[]; elapsedMs: number; }

export const toolDescriptions: Record<ToolName, string> = {
  inspect_page: 'inspect_page {"url": "https://example.com/page"}: open one public page in the sandbox browser and return its title, description, canonical, robots, headings, social tags, visible text, and links.',
};

export function toolProtocol(tools: ToolName[]): string {
  return `TOOLS\nYou may call one tool per reply by answering with a single line and nothing else:\nTOOL {"tool": "<name>", ...arguments}\nAvailable:\n${tools.map(t => `- ${toolDescriptions[t]}`).join('\n')}\nAfter a TOOL RESULT message, continue the task. Call at most three tools per user message, then answer in prose.`;
}

export function parseToolCall(text: string): ToolCall | null {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  if (!line.startsWith('TOOL ')) return null;
  try {
    const parsed = JSON.parse(line.slice(5)) as Record<string, unknown>;
    if (parsed.tool !== 'inspect_page' || typeof parsed.url !== 'string') return null;
    return { tool: 'inspect_page', args: { url: parsed.url } };
  } catch { return null; }
}

export async function inspectPage(url: string, signal: AbortSignal): Promise<PageReport> {
  const response = await fetch('/api/browse', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error?.message === 'string' ? body.error.message : `Browser runner failed (HTTP ${response.status}).`);
  return body as PageReport;
}

export function summarizeReport(r: PageReport): string {
  return `TOOL RESULT inspect_page\nurl: ${r.url}\nstatus: ${r.status}\ntitle: ${r.title}\ndescription: ${r.description}\ncanonical: ${r.canonical}\nrobots: ${r.robots}\nlang: ${r.lang}\nh1: ${r.h1.join(' | ')}\nheadings: ${r.headingCount}\nog: ${Object.entries(r.og).map(([k, v]) => `${k}=${v}`).join('; ')}\nwords: ${r.wordCount}\nlinks (${r.links.length}): ${r.links.slice(0, 25).map(l => `${l.text || '(no text)'} -> ${l.href}`).join('\n  ')}\ntext:\n${r.text}`;
}
