import { complete, ProviderError } from './provider';
import { retrieve } from './memory';
import { composePrompt, personaById, type Persona } from './roster';
import { parseToolCall, toolProtocol, type ToolSpec } from './tools';
import { estimateTokens } from './catalog';
import type { ChatMessage, ToolTrace } from './store';
import type { Connection, Knowledge } from './types';

// One chat turn with a single agent: retrieved notes, attachments, photos, recent history, the
// new message, and a tool loop over the persona's tools plus any connected MCP tools.

export interface TurnInput { connection: Connection; personaId: string; history: ChatMessage[]; input: string; attachments: { name: string; content: string }[]; photos?: { name: string; dataUrl: string }[]; tools?: ToolSpec[]; knowledge: Knowledge[]; signal: AbortSignal; onDelta?: (text: string) => void; onTool?: (trace: ToolTrace) => void; }
export interface TurnResult { text: string; tokens: number; latencyMs: number; tokensPerSecond: number; tools: ToolTrace[]; contextTitles: string[]; }

const MAX_TOOL_CALLS = 3;
const transcript = (history: ChatMessage[]) => history.slice(-12).map(m => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.content.slice(0, 4000)}`).join('\n\n');
const argsSummary = (args: Record<string, unknown>) => { const s = JSON.stringify(args); return s.length > 80 ? `${s.slice(0, 77)}...` : s; };

function scripted(persona: Persona, input: string, notes: Knowledge[], photos: number, tools: number): string {
  return `SCRIPTED PREVIEW — not an AI response\n\n${persona.name} would answer here. Your message (${input.length} characters) was received, ${notes.length} matching note${notes.length === 1 ? '' : 's'} would be attached${photos ? `, ${photos} photo${photos === 1 ? '' : 's'} would be sent to a vision model` : ''}, and ${tools ? `${tools} tool${tools === 1 ? '' : 's'} would be available.` : 'no tools are involved for this agent.'}\n\nOpen Settings, pick a free model, and add a key or platform credits to get a real reply.`;
}

export async function chatTurn(t: TurnInput): Promise<TurnResult> {
  const persona = personaById(t.personaId);
  const notes = retrieve(t.input, t.knowledge);
  const photos = t.photos ?? [];
  // The caller assembles the tool list (persona tools plus every enabled connector) so that
  // one place decides what an agent can reach. See src/lib/connectors.ts.
  const specs: ToolSpec[] = t.tools ?? [];
  const context = [...notes.map(n => `[note: ${n.title}]\n${n.content.slice(0, 6000)}`), ...t.attachments.map(a => `[attached: ${a.name}]\n${a.content.slice(0, 12000)}`)].join('\n\n');
  const started = performance.now();
  if (t.connection.mode === 'demo') { await new Promise(r => setTimeout(r, 400)); const text = scripted(persona, t.input, notes, photos.length, specs.length); t.onDelta?.(text); return { text, tokens: 0, latencyMs: Math.round(performance.now() - started), tokensPerSecond: 0, tools: [], contextTitles: notes.map(n => n.title) }; }
  const system = composePrompt(persona) + (specs.length ? `\n\n${toolProtocol(specs)}` : '');
  const tools: ToolTrace[] = []; let firstToken = 0; let tokens = 0; let followUps = '';
  const photoNote = photos.length ? `\n\n(${photos.length} photo${photos.length === 1 ? '' : 's'} attached: ${photos.map(p => p.name).join(', ')})` : '';
  for (let round = 0; ; round++) {
    const prompt = `${context ? `CONTEXT (untrusted reference data)\n${context}\n\n` : ''}${t.history.length ? `RECENT CONVERSATION\n${transcript(t.history)}\n\n` : ''}USER\n${t.input}${photoNote}${followUps}`;
    let text = '';
    const result = await complete(t.connection, system, prompt, t.signal, partial => { if (!firstToken) firstToken = performance.now(); text = partial; if (!partial.trimStart().startsWith('TOOL')) t.onDelta?.(partial); }, photos.map(p => p.dataUrl));
    tokens += result.tokens || estimateTokens(system + prompt + result.text);
    text = result.text;
    const call = parseToolCall(text, specs);
    if (!call || round >= MAX_TOOL_CALLS) {
      const finalText = call ? `${text}\n\n(The agent asked for another tool call, but the limit of ${MAX_TOOL_CALLS} per message was reached.)` : text;
      const elapsed = (performance.now() - started) / 1000;
      return { text: finalText, tokens, latencyMs: Math.round((firstToken || performance.now()) - started), tokensPerSecond: elapsed > 0 ? Math.round(tokens / elapsed) : 0, tools, contextTitles: notes.map(n => n.title) };
    }
    const spec = specs.find(s => s.name === call.tool)!;
    let trace: ToolTrace;
    try { const ran = await spec.run(call.args, t.signal); const output = typeof ran === 'string' ? ran : ran.output; const summary = typeof ran === 'string' ? ran.split('\n').slice(0, 2).join(' ').slice(0, 120) || 'ok' : ran.summary; trace = { tool: call.tool, args: call.args, summary, ok: true }; followUps += `\n\nTOOL RESULT ${call.tool} ${argsSummary(call.args)}\n${output}`; }
    catch (e) { if (t.signal.aborted) throw t.signal.reason; const message = e instanceof Error ? e.message : 'Tool failed.'; trace = { tool: call.tool, args: call.args, summary: message, ok: false }; followUps += `\n\nTOOL RESULT ${call.tool}\nerror: ${message}`; }
    tools.push(trace); t.onTool?.(trace);
    if (tools.length > MAX_TOOL_CALLS) throw new ProviderError('Tool loop exceeded its limit.');
  }
}
