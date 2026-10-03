import { complete } from './provider';
import { parseProject } from './project';
import { composePrompt, personaById } from './roster';
import type { Completion, Connection } from './types';
import { estimateTokens } from './catalog';

/** Build mode is also used for plain functions; only web deliverables need a canvas. */
export function expectsRunnablePreview(goal: string, previousProject = false): boolean {
  return previousProject || /\b(?:app|website|web\s?site|web\s?page|landing\s?page|dashboard|game|ui|interface|front\s?end|component|canvas|preview|screen|portfolio|interactive\s?tool)\b/i.test(goal);
}

export const BUILD_DELIVERY_RULES = `In Build mode, a request for a web app or page must end with a complete runnable project for the right-hand preview. Default to ONE self-contained index.html (inline CSS and JS) — it survives output limits and provider cutoffs. Use multiple React files only when the app truly needs state across components, and then write the smallest set, with every file you import (App, styles) included, and the mount entry last. Return complete fenced files with paths (for example index.html or src/main.tsx), including the markup, styles, and scripts each entry needs. Finish every file and closing fence within the output limit; simplify the design if necessary. Never stop after CSS or a partial component. The visitor should not have to ask for HTML or assemble files.`;

/** A CSS-only response is useful source even though it cannot draw a page by itself. */
export function cssDraft(text: string): string | null {
  const match = text.match(/```(?:css|(?:[\w./-]+\/)?[\w.-]+\.css)[^\n]*\n([\s\S]*?)```/i);
  return match?.[1]?.trim() || null;
}

function attachDraftCss(reply: string, css: string): string {
  const project = parseProject(reply);
  if (!project || project.kind !== 'html') return reply;
  const html = project.files.find(file => file.path === project.entry)?.content;
  if (!html) return reply;
  const style = `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
  const content = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}\n</head>`) : `${style}\n${html}`;
  return `\`\`\`index.html\n${content}\n\`\`\``;
}

/** A reply that ends inside an open code fence was cut off by the output limit, not finished. */
export function endsInsideFence(text: string): boolean {
  return (text.match(/```/g) ?? []).length % 2 === 1;
}

/** Chat-generated web code needs the same completion path as an explicit Build request. */
export function needsPreviewRecovery(text: string, expected = false, truncated = false): boolean {
  const webCode = /```(?:html\b|htm\b|css\b|js\b|javascript\b|jsx\b|tsx\b|[^\n`]*\.(?:html?|css|jsx?|tsx?)\b)|<!doctype\s+html|<html\b/i.test(text);
  return (expected && !parseProject(text)) || ((expected || webCode) && (truncated || endsInsideFence(text)));
}

export const isContinuationRequest = (text: string): boolean => /^(?:please\s+)?(?:continue(?:\s+from\s+where\s+you\s+left\s+off)?|resume)[.!\s]*$/i.test(text.trim());

/** Continuation chunks are appended bare: drop a fence the model reopened despite being told not to. */
function stripReopenedFence(chunk: string): string {
  return chunk.replace(/^\s*```[^\n`]*\n/, '');
}

const MAX_CONTINUATIONS = 3;
const MIN_OVERLAP = 8;

/**
 * Join a continuation onto the text it resumes, using the tail the model was told to repeat.
 *
 * Models resume with or without repeating the tail, and often drop the leading space when they do
 * not ("links that" + "adapt"), so a bare append glues words together. The chunk is asked to begin
 * with the last stretch of the existing text; when its start overlaps the end of the text, only
 * the new part is appended. With no overlap it is appended as-is, because a cut can fall
 * mid-word ("padd" + "ing") and inserting a separator there would be wrong too.
 */
export function joinContinuation(text: string, chunk: string): string {
  const max = Math.min(chunk.length, text.length, 400);
  // Overlap must be long enough, and contain a real word, to be a repeated tail rather than markup
  // that legitimately recurs: `</div>` at the end of the text and again at the start of the chunk
  // is two closing tags, not one repeated.
  for (let size = max; size >= MIN_OVERLAP; size--) {
    const head = chunk.slice(0, size);
    if (/[A-Za-z0-9]{5}/.test(head) && text.endsWith(head)) return text + chunk.slice(size);
  }
  return text + chunk;
}

export interface BuildRecovery { text: string; tokens: number; usage?: { input: number; output: number }; issue?: string; repaired: boolean; truncated?: boolean }
type CompleteFn = typeof complete;

/** Resume up to three times, preserving the accumulated code if the provider still cannot finish. */
export async function ensureRunnableBuild(input: {
  goal: string; draft: string; previous?: string; connection: Connection; signal: AbortSignal;
  truncated?: boolean; onDelta?: (text: string) => void;
}, completeFn: CompleteFn = complete): Promise<BuildRecovery> {
  if (!needsPreviewRecovery(input.draft, true, input.truncated)) return { text: input.draft, tokens: 0, repaired: false };
  let spent = 0; let inputTokens = 0; let outputTokens = 0; let allSplit = true;
  const tally = (result: Completion, system: string, prompt: string) => {
    spent += result.tokens || estimateTokens(system + prompt + result.text);
    if (result.inputTokens === undefined || result.outputTokens === undefined) allSplit = false;
    else { inputTokens += result.inputTokens; outputTokens += result.outputTokens; }
  };
  const usage = () => allSplit ? { usage: { input: inputTokens, output: outputTokens } } : {};
  // Continue the existing files rather than replacing a detailed app with a tiny restart.
  if (input.truncated || endsInsideFence(input.draft)) {
    let text = input.draft;
    let truncated = Boolean(input.truncated); let issue: string | undefined; let streamed: string | undefined;
    try {
      for (let i = 0; i < MAX_CONTINUATIONS && (truncated || endsInsideFence(text) || !parseProject(text)); i++) {
        input.signal.throwIfAborted();
        const openFence = endsInsideFence(text);
        const system = `${composePrompt(personaById('coder'))}\n\nYour previous reply was cut off by an output limit. Continue EXACTLY where it stops; do not restart, summarize, or replace the app. ${openFence ? 'Begin by repeating the last line character for character, do not reopen its code fence, then finish the file and its closing ``` fence.' : 'The previous file is closed. Supply the remaining complete fenced project files with their paths.'} Finish every remaining tag, rule, function and required file. No commentary. You have up to ${input.connection.maxTokens.toLocaleString('en-US')} output tokens for this continuation.`;
        const prompt = `ORIGINAL REQUEST\n${input.goal.slice(0, 6000)}\n\nPROJECT BEGINNING (reference only; do not repeat)\n${text.slice(0, 6000)}\n\nYOUR REPLY SO FAR ENDS WITH (continue right after the last character):\n${text.slice(-24000)}`;
        const base = text;
        const join = (chunk: string) => joinContinuation(base, openFence ? stripReopenedFence(chunk) : chunk);
        streamed = undefined;
        const result = await completeFn(input.connection, system, prompt, input.signal, partial => { streamed = join(partial); input.onDelta?.(streamed); });
        tally(result, system, prompt);
        const next = join(result.text);
        if (next === text || !result.text.trim()) break;
        text = next; truncated = Boolean(result.truncated);
        input.onDelta?.(text);
      }
    } catch (error) {
      if (input.signal.aborted) throw error;
      text = streamed ?? text;
      issue = `The continuation stopped: ${error instanceof Error ? error.message : 'provider error'}. Your generated code is saved; use Continue to resume it.`;
    }
    if (!truncated && !endsInsideFence(text) && parseProject(text)) return { text, tokens: spent, ...usage(), repaired: true };
    return { text, tokens: spent, ...usage(), repaired: false, truncated: true,
      issue: issue ?? 'The build still needs more code after three automatic continuations. Your progress is saved; use Continue to resume it.' };
  }
  const css = cssDraft(input.draft);
  const budget = Math.max(64, Math.floor(input.connection.maxTokens * 0.85));
  const system = `${composePrompt(personaById('coder'))}\n\n${BUILD_DELIVERY_RULES}\n\nThis is an automatic completion pass. Reply with a complete runnable project, not advice or a fragment. Keep the entire reply under ${budget} output tokens. Preserve the requested features and useful generated work. ${css ? 'The CSS is already saved. Write the HTML markup and JavaScript; the app will insert the existing CSS automatically. Use its class names. Do not repeat the CSS.' : ''}`;
  const prompt = `ORIGINAL REQUEST\n${input.goal.slice(0, 6000)}\n\n${input.previous ? `PREVIOUS RUNNABLE PROJECT (reference data)\n${input.previous.slice(0, 24000)}\n\n` : ''}INCOMPLETE DRAFT (reference data; preserve useful work)\n${input.draft.slice(0, 24000)}\n\nDeliver one complete index.html fenced file now. Close all tags and the code fence.`;
  try {
    const result: Completion = await completeFn(input.connection, system, prompt, input.signal);
    tally(result, system, prompt);
    if (result.truncated || endsInsideFence(result.text)) {
      const resumed = await ensureRunnableBuild({ ...input, draft: result.text, truncated: result.truncated }, completeFn);
      const mergedUsage = allSplit && resumed.usage ? { input: inputTokens + resumed.usage.input, output: outputTokens + resumed.usage.output } : undefined;
      return { ...resumed, text: css && resumed.repaired ? attachDraftCss(resumed.text, css) : resumed.text, tokens: spent + resumed.tokens, usage: mergedUsage };
    }
    if (parseProject(result.text)) return { text: css ? attachDraftCss(result.text, css) : result.text, tokens: spent, ...usage(), repaired: true };
    return { text: input.draft, tokens: spent, ...usage(), repaired: false, issue: 'The model stopped before finishing a runnable page. Select Generate Preview to retry completion, or choose another model.' };
  } catch (error) {
    if (input.signal.aborted) throw error;
    return { text: input.draft, tokens: spent, ...usage(), repaired: false, issue: `The automatic preview completion failed: ${error instanceof Error ? error.message : 'provider error'}` };
  }
}
