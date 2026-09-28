import { complete } from './provider';
import { parseProject } from './project';
import { composePrompt, personaById } from './roster';
import type { Completion, Connection } from './types';

/** Build mode is also used for plain functions; only web deliverables need a canvas. */
export function expectsRunnablePreview(goal: string, previousProject = false): boolean {
  return previousProject || /\b(?:app|website|web\s?site|web\s?page|landing\s?page|dashboard|game|ui|interface|front\s?end|component|canvas|preview|screen|portfolio|interactive\s?tool)\b/i.test(goal);
}

export const BUILD_DELIVERY_RULES = `In Build mode, a request for a web app or page must end with a complete runnable project for the right-hand preview. Choose the implementation yourself: a small page can be one self-contained HTML file, and a stateful app can use React with a real mount entry. Return complete fenced files with paths (for example index.html or src/main.tsx), including the markup, styles, and scripts each entry needs. Finish every file and closing fence within the output limit; simplify the design if necessary. Never stop after CSS or a partial component. The visitor should not have to ask for HTML or assemble files.`;

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

export interface BuildRecovery { text: string; tokens: number; issue?: string; repaired: boolean }
type CompleteFn = typeof complete;

/** One bounded second pass when a build reply cannot become a project. */
export async function ensureRunnableBuild(input: {
  goal: string; draft: string; previous?: string; connection: Connection; signal: AbortSignal;
}, completeFn: CompleteFn = complete): Promise<BuildRecovery> {
  if (parseProject(input.draft)) return { text: input.draft, tokens: 0, repaired: false };
  const css = cssDraft(input.draft);
  const system = `${composePrompt(personaById('coder'))}\n\n${BUILD_DELIVERY_RULES}\n\nThis is an automatic completion pass. Reply with a fresh, complete runnable project, not advice or a fragment. Keep the entire reply under 700 output tokens so it fits the free tier's output cap. ${css ? 'The CSS is already saved. Write only compact HTML markup and optional short JavaScript; the app will insert the existing CSS automatically. Use its class names. Do not repeat the CSS.' : 'Prefer a compact self-contained page if the token budget is tight.'}`;
  const prompt = `ORIGINAL REQUEST\n${input.goal.slice(0, 3000)}\n\n${input.previous ? `PREVIOUS RUNNABLE PROJECT (reference data)\n${input.previous.slice(0, 10000)}\n\n` : ''}INCOMPLETE DRAFT (reference data; preserve useful work)\n${input.draft.slice(0, 12000)}\n\nDeliver one complete index.html fenced file now. Close all tags and the code fence.`;
  try {
    const result: Completion = await completeFn(input.connection, system, prompt, input.signal);
    if (parseProject(result.text)) return { text: css ? attachDraftCss(result.text, css) : result.text, tokens: result.tokens, repaired: true };
    return { text: input.draft, tokens: result.tokens, repaired: false, issue: 'The model stopped before finishing a runnable page. Select Generate Preview to retry the compact completion, or choose another model.' };
  } catch (error) {
    if (input.signal.aborted) throw error;
    return { text: input.draft, tokens: 0, repaired: false, issue: `The automatic preview completion failed: ${error instanceof Error ? error.message : 'provider error'}` };
  }
}
