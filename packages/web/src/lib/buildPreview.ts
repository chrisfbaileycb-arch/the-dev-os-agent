import { complete } from './provider';
import { parseProject } from './project';
import { composePrompt, personaById } from './roster';
import type { Completion, Connection } from './types';

/** Build mode is also used for plain functions; only web deliverables need a canvas. */
export function expectsRunnablePreview(goal: string, previousProject = false): boolean {
  return previousProject || /\b(?:app|website|web\s?site|web\s?page|landing\s?page|dashboard|game|ui|interface|front\s?end|component|canvas|preview|screen|portfolio|interactive\s?tool)\b/i.test(goal);
}

export const BUILD_DELIVERY_RULES = `In Build mode, a request for a web app or page must end with a complete runnable project for the right-hand preview. Choose the implementation yourself: a small page can be one self-contained HTML file, and a stateful app can use React with a real mount entry. Return complete fenced files with paths (for example index.html or src/main.tsx), including the markup, styles, and scripts each entry needs. Finish every file and closing fence within the output limit; simplify the design if necessary. Never stop after CSS or a partial component. The visitor should not have to ask for HTML or assemble files.`;

export interface BuildRecovery { text: string; tokens: number; issue?: string; repaired: boolean }
type CompleteFn = typeof complete;

/** One bounded second pass when a build reply cannot become a project. */
export async function ensureRunnableBuild(input: {
  goal: string; draft: string; previous?: string; connection: Connection; signal: AbortSignal;
}, completeFn: CompleteFn = complete): Promise<BuildRecovery> {
  if (parseProject(input.draft)) return { text: input.draft, tokens: 0, repaired: false };
  const system = `${composePrompt(personaById('coder'))}\n\n${BUILD_DELIVERY_RULES}\n\nThis is an automatic completion pass. Reply with a fresh, complete runnable project, not advice or a fragment. Prefer a compact self-contained page if the token budget is tight.`;
  const prompt = `ORIGINAL REQUEST\n${input.goal.slice(0, 3000)}\n\n${input.previous ? `PREVIOUS RUNNABLE PROJECT (reference data)\n${input.previous.slice(0, 10000)}\n\n` : ''}INCOMPLETE DRAFT (reference data; preserve useful work)\n${input.draft.slice(0, 12000)}\n\nDeliver the finished project files now. Every referenced file must be present; close all tags and code fences.`;
  try {
    const result: Completion = await completeFn(input.connection, system, prompt, input.signal);
    if (parseProject(result.text)) return { text: result.text, tokens: result.tokens, repaired: true };
    return { text: input.draft, tokens: result.tokens, repaired: false, issue: 'The builder did not finish a runnable preview. Try a different model or raise its output limit in Settings.' };
  } catch (error) {
    if (input.signal.aborted) throw error;
    return { text: input.draft, tokens: 0, repaired: false, issue: `The automatic preview completion failed: ${error instanceof Error ? error.message : 'provider error'}` };
  }
}
