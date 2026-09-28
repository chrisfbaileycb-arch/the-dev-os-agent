import { complete } from './provider';
import { parseProject } from './project';
import { composePrompt, personaById } from './roster';
import type { Completion, Connection } from './types';

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

export interface BuildRecovery { text: string; tokens: number; issue?: string; repaired: boolean }
type CompleteFn = typeof complete;

/** One bounded second pass when a build reply cannot become a project. */
export async function ensureRunnableBuild(input: {
  goal: string; draft: string; previous?: string; connection: Connection; signal: AbortSignal;
}, completeFn: CompleteFn = complete): Promise<BuildRecovery> {
  if (parseProject(input.draft)) return { text: input.draft, tokens: 0, repaired: false };
  let spent = 0;
  // The free tier caps output near 1,024 tokens, so a full page is often cut mid-file. Resuming
  // where it stopped costs a few short calls and keeps the whole design; restarting with a smaller
  // budget throws the work away and is cut off again by a model that ignores the size request.
  if (endsInsideFence(input.draft)) {
    let text = input.draft;
    const system = `${composePrompt(personaById('coder'))}\n\nYour previous reply was cut off by an output limit. Begin by repeating the last line of the text you were given, character for character, so the pieces can be joined, then continue EXACTLY where it stops. Do not repeat anything earlier, do not reopen the code fence, and do not add commentary. Finish every open tag, rule and function, then end with the closing \`\`\` fence. Keep the remainder compact.`;
    try {
      for (let i = 0; i < MAX_CONTINUATIONS && endsInsideFence(text); i++) {
        const prompt = `ORIGINAL REQUEST\n${input.goal.slice(0, 1500)}\n\nYOUR REPLY SO FAR ENDS WITH (continue right after the last character):\n${text.slice(-3000)}`;
        const result: Completion = await completeFn(input.connection, system, prompt, input.signal);
        spent += result.tokens;
        const chunk = stripReopenedFence(result.text);
        if (!chunk.trim()) break;
        text = joinContinuation(text, chunk);
      }
    } catch (error) {
      if (input.signal.aborted) throw error;
    }
    if (parseProject(text)) return { text, tokens: spent, repaired: true };
  }
  const css = cssDraft(input.draft);
  const system = `${composePrompt(personaById('coder'))}\n\n${BUILD_DELIVERY_RULES}\n\nThis is an automatic completion pass. Reply with a fresh, complete runnable project, not advice or a fragment. Keep the entire reply under 700 output tokens so it fits the free tier's output cap. ${css ? 'The CSS is already saved. Write only compact HTML markup and optional short JavaScript; the app will insert the existing CSS automatically. Use its class names. Do not repeat the CSS.' : 'Prefer a compact self-contained page if the token budget is tight.'}`;
  const prompt = `ORIGINAL REQUEST\n${input.goal.slice(0, 3000)}\n\n${input.previous ? `PREVIOUS RUNNABLE PROJECT (reference data)\n${input.previous.slice(0, 10000)}\n\n` : ''}INCOMPLETE DRAFT (reference data; preserve useful work)\n${input.draft.slice(0, 12000)}\n\nDeliver one complete index.html fenced file now. Close all tags and the code fence.`;
  try {
    const result: Completion = await completeFn(input.connection, system, prompt, input.signal);
    if (parseProject(result.text)) return { text: css ? attachDraftCss(result.text, css) : result.text, tokens: spent + result.tokens, repaired: true };
    return { text: input.draft, tokens: spent + result.tokens, repaired: false, issue: 'The model stopped before finishing a runnable page. Select Generate Preview to retry the compact completion, or choose another model.' };
  } catch (error) {
    if (input.signal.aborted) throw error;
    return { text: input.draft, tokens: spent, repaired: false, issue: `The automatic preview completion failed: ${error instanceof Error ? error.message : 'provider error'}` };
  }
}
