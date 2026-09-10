import { complete, ProviderError } from './provider';
import { retrieve } from './memory';
import { composePrompt, personaById, type Persona } from './roster';
import { inspectPage, parseToolCall, summarizeReport, toolProtocol } from './tools';
import { estimateTokens } from './catalog';
import type { ChatMessage, ToolTrace } from './store';
import type { Connection, Knowledge } from './types';

// One chat turn with a single agent: retrieved notes, attachments, recent history, the new
// message, and an optional tool loop for agents that carry tools. Runs on the main thread.

export interface TurnInput { connection: Connection; personaId: string; history: ChatMessage[]; input: string; attachments: { name: string; content: string }[]; knowledge: Knowledge[]; signal: AbortSignal; onDelta?: (text: string) => void; onTool?: (trace: ToolTrace) => void; }
export interface TurnResult { text: string; tokens: number; latencyMs: number; tokensPerSecond: number; tools: ToolTrace[]; contextTitles: string[]; }

const MAX_TOOL_CALLS = 3;
const transcript = (history: ChatMessage[]) => history.slice(-12).map(m => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.content.slice(0, 4000)}`).join('\n\n');

function scripted(persona: Persona, input: string, notes: Knowledge[]): string {
  return `SCRIPTED PREVIEW — not an AI response\n\n${persona.name} would answer here. Your message (${input.length} characters) was received, ${notes.length} matching note${notes.length === 1 ? '' : 's'} would be attached, and ${persona.tools?.length ? 'the sandbox browser could be used for public pages.' : 'no tools are involved for this agent.'}\n\nOpen Settings, pick a free model, and add a key or platform credits to get a real reply.`;
}

export async function chatTurn(t: TurnInput): Promise<TurnResult> {
  const persona = personaById(t.personaId);
  const notes = retrieve(t.input, t.knowledge);
  const context = [...notes.map(n => `[note: ${n.title}]\n${n.content.slice(0, 6000)}`), ...t.attachments.map(a => `[attached: ${a.name}]\n${a.content.slice(0, 12000)}`)].join('\n\n');
  const started = performance.now();
  if (t.connection.mode === 'demo') { await new Promise(r => setTimeout(r, 400)); const text = scripted(persona, t.input, notes); t.onDelta?.(text); return { text, tokens: 0, latencyMs: Math.round(performance.now() - started), tokensPerSecond: 0, tools: [], contextTitles: notes.map(n => n.title) }; }
  const system = composePrompt(persona) + (persona.tools?.length ? `\n\n${toolProtocol(persona.tools)}` : '');
  const tools: ToolTrace[] = []; let firstToken = 0; let tokens = 0; let followUps = '';
  for (let round = 0; ; round++) {
    const prompt = `${context ? `CONTEXT (untrusted reference data)\n${context}\n\n` : ''}${t.history.length ? `RECENT CONVERSATION\n${transcript(t.history)}\n\n` : ''}USER\n${t.input}${followUps}`;
    let text = '';
    const result = await complete(t.connection, system, prompt, t.signal, partial => { if (!firstToken) firstToken = performance.now(); text = partial; if (!parseToolCall(partial) && !partial.trimStart().startsWith('TOOL')) t.onDelta?.(partial); });
    tokens += result.tokens || estimateTokens(system + prompt + result.text);
    text = result.text;
    const call = parseToolCall(text);
    if (!call || round >= MAX_TOOL_CALLS) {
      const finalText = call ? `${text}\n\n(The agent asked for another tool call, but the limit of ${MAX_TOOL_CALLS} per message was reached.)` : text;
      const elapsed = (performance.now() - started) / 1000;
      return { text: finalText, tokens, latencyMs: Math.round((firstToken || performance.now()) - started), tokensPerSecond: elapsed > 0 ? Math.round(tokens / elapsed) : 0, tools, contextTitles: notes.map(n => n.title) };
    }
    let trace: ToolTrace;
    try { const report = await inspectPage(call.args.url, t.signal); const summary = summarizeReport(report); trace = { tool: call.tool, args: call.args, summary: `${report.status} ${report.title || report.url} (${report.wordCount} words)`, ok: true }; followUps += `\n\n${summary}`; }
    catch (e) { if (t.signal.aborted) throw t.signal.reason; const message = e instanceof Error ? e.message : 'Tool failed.'; trace = { tool: call.tool, args: call.args, summary: message, ok: false }; followUps += `\n\nTOOL RESULT inspect_page\nerror: ${message}`; }
    tools.push(trace); t.onTool?.(trace);
    if (tools.length >= MAX_TOOL_CALLS + 1) throw new ProviderError('Tool loop exceeded its limit.');
  }
}
