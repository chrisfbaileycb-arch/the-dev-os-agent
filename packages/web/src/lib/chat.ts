import { complete, ProviderError } from './provider';
import { formatMemories, retrieve, selectMemories } from './memory';
import { composePrompt, personaById, type Persona } from './roster';
import { parseToolCall, toolProtocol, type ToolSpec } from './tools';
import { estimateTokens } from './catalog';
import { BUILD_DELIVERY_RULES } from './buildPreview';
import type { ChatMessage, ToolTrace } from './store';
import type { Connection, Knowledge, MemoryEntry } from './types';

// One chat turn with a single agent: retrieved notes, the few persistent memories that match this
// message, attachments, photos, recent history, the new message, and a tool loop over the
// persona's tools plus any connected MCP tools.

export interface TurnInput { connection: Connection; personaId: string; history: ChatMessage[]; input: string; attachments: { name: string; content: string }[]; photos?: { name: string; dataUrl: string }[]; tools?: ToolSpec[]; knowledge: Knowledge[]; /** Every persistent memory; only the matching few are sent. */ memories?: MemoryEntry[]; buildPreview?: boolean; signal: AbortSignal; onDelta?: (text: string) => void; onTool?: (trace: ToolTrace) => void; }
export interface TurnResult { text: string; tokens: number; /** Input and output tokens across every call this turn, when the provider reported both each time. */ usage?: { input: number; output: number }; latencyMs: number; tokensPerSecond: number; tools: ToolTrace[]; contextTitles: string[]; /** The memories this turn actually carried, so their use can be recorded. */ memoriesUsed: MemoryEntry[]; }

const MAX_TOOL_CALLS = 3;
const transcript = (history: ChatMessage[]) => history.slice(-12).map(m => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.content.slice(0, 4000)}`).join('\n\n');
const argsSummary = (args: Record<string, unknown>) => { const s = JSON.stringify(args); return s.length > 80 ? `${s.slice(0, 77)}...` : s; };

export async function chatTurn(t: TurnInput): Promise<TurnResult> {
  const persona = personaById(t.personaId);
  const notes = retrieve(t.input, t.knowledge);
  // A targeted lookup, never the whole store: see selectMemories.
  const recalled = selectMemories(t.input, t.memories ?? []);
  const memoryBlock = formatMemories(recalled);
  const photos = t.photos ?? [];
  // The caller assembles the tool list (persona tools plus every enabled connector) so that
  // one place decides what an agent can reach. See src/lib/connectors.ts.
  const specs: ToolSpec[] = t.tools ?? [];
  const context = [...(memoryBlock ? [`[persistent memory]\n${memoryBlock}`] : []), ...notes.map(n => `[note: ${n.title}]\n${n.content.slice(0, 6000)}`), ...t.attachments.map(a => `[attached: ${a.name}]\n${a.content.slice(0, 12000)}`)].join('\n\n');
  const started = performance.now();
  const system = composePrompt(persona) + (t.buildPreview ? `\n\n${BUILD_DELIVERY_RULES}` : '') + (specs.length ? `\n\n${toolProtocol(specs)}` : '');
  const tools: ToolTrace[] = []; let firstToken = 0; let tokens = 0; let followUps = ''; let input = 0; let output = 0; let allSplit = true;
  const photoNote = photos.length ? `\n\n(${photos.length} photo${photos.length === 1 ? '' : 's'} attached: ${photos.map(p => p.name).join(', ')})` : '';
  for (let round = 0; ; round++) {
    const prompt = `${context ? `CONTEXT (untrusted reference data)\n${context}\n\n` : ''}${t.history.length ? `RECENT CONVERSATION\n${transcript(t.history)}\n\n` : ''}USER\n${t.input}${photoNote}${followUps}`;
    let text = '';
    const result = await complete(t.connection, system, prompt, t.signal, partial => { if (!firstToken) firstToken = performance.now(); text = partial; if (!partial.trimStart().startsWith('TOOL')) t.onDelta?.(partial); }, photos.map(p => p.dataUrl));
    tokens += result.tokens || estimateTokens(system + prompt + result.text);
    if (result.inputTokens === undefined || result.outputTokens === undefined) allSplit = false; else { input += result.inputTokens; output += result.outputTokens; }
    text = result.text;
    const call = parseToolCall(text, specs);
    if (!call || round >= MAX_TOOL_CALLS) {
      const finalText = call ? `${text}\n\n(The agent asked for another tool call, but the limit of ${MAX_TOOL_CALLS} per message was reached.)` : text;
      const elapsed = (performance.now() - started) / 1000;
      return { text: finalText, tokens, ...(allSplit && input + output > 0 ? { usage: { input, output } } : {}), latencyMs: Math.round((firstToken || performance.now()) - started), tokensPerSecond: elapsed > 0 ? Math.round(tokens / elapsed) : 0, tools, contextTitles: notes.map(n => n.title), memoriesUsed: recalled };
    }
    const spec = specs.find(s => s.name === call.tool)!;
    let trace: ToolTrace;
    try { const ran = await spec.run(call.args, t.signal); const output = typeof ran === 'string' ? ran : ran.output; const summary = typeof ran === 'string' ? ran.split('\n').slice(0, 2).join(' ').slice(0, 120) || 'ok' : ran.summary; trace = { tool: call.tool, args: call.args, summary, ok: true }; followUps += `\n\nTOOL RESULT ${call.tool} ${argsSummary(call.args)}\n${output}`; }
    catch (e) { if (t.signal.aborted) throw t.signal.reason; const message = e instanceof Error ? e.message : 'Tool failed.'; trace = { tool: call.tool, args: call.args, summary: message, ok: false }; followUps += `\n\nTOOL RESULT ${call.tool}\nerror: ${message}`; }
    tools.push(trace); t.onTool?.(trace);
    if (tools.length > MAX_TOOL_CALLS) throw new ProviderError('Tool loop exceeded its limit.');
  }
}
