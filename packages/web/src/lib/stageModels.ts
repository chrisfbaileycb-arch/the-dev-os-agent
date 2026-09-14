import type { StageModels } from './types';

/**
 * Complementary models per workflow stage, when the deployment funds more than one.
 *
 * The reference design named ids (GLM for building, a long-context Gemini for planning, a Flash
 * for reviewing). Hardcoding ids here cannot be done safely: a compiled id the deployment does
 * not fund sends a free-tier request to a 401 the visitor cannot fix, and compiled free ids in
 * catalog.ts are exactly how the free tier once advertised models it would not serve. So the
 * shape is hardcoded and the ids are not: three families — large-context for planning, code-dense
 * for building and researching, low-latency for verifying and writing — classified from the same
 * discovered list the model hub already renders, intersected with what this deployment funds.
 *
 * A stage whose family has no funded candidate, a connection on a deployment funding one model,
 * or a reply with no discovery answer at all all keep the connection's own model: the
 * pre-existing behaviour, unchanged.
 */
export type StageFamily = 'plan' | 'build' | 'verify' | 'single';

/** Which family a workflow stage's type belongs to. Unknown types ride with 'single'. */
const STAGE_FAMILY: Record<string, StageFamily> = {
  planning: 'plan',
  design: 'build',
  research: 'build',
  review: 'verify',
  synthesis: 'verify',
};

export function stageFamily(type: string): StageFamily {
  return STAGE_FAMILY[type] ?? 'single';
}

/**
 * The family an id reads as, judged from its name — the same judgement weightFor() makes about
 * credit weight, and no stronger. A model the gateway gives a free label to is assumed capable
 * of anything its name does not deny. Order matters: the first pattern that matches wins, and
 * the patterns say what a model is for, not what its vendor is.
 */
function familyOf(id: string): StageFamily {
  const name = id.toLowerCase();
  // Code-dense: coder/naming that says it writes code without conversational padding.
  if (/(^|[/\-\s])(coder|codestral|codey|starcoder|codellama)(?![a-z])/.test(name) || /code\b|codestral|starcoder/.test(name)) return 'build';
  // Large-context: max/pro/large/reasoning — the architect-class engines.
  if (/(^|[/\-\s])(pro|max|large|opus|reasoning|think|r1|o[134])(?![a-z0-9])/.test(name)) return 'plan';
  // Low-latency: flash/instant/mini/haiku/nano/small/fast — the verifier-class engines.
  if (/(^|[/\-\s])(flash|instant|mini|haiku|nano|small|fast|turbo)(?![a-z0-9])/.test(name)) return 'verify';
  return 'single';
}

/**
 * One id per family for the whole run, from the intersection of the discovery answer and what
 * the deployment funds, falling back to whatever the connection itself points at.
 *
 * Preferring a candidate different from the connection's model is what makes the run
 * complementary rather than uniform — and if every funded candidate of a family is the
 * connection's model, or the family has no candidates at all, that model is what the stage
 * uses. `candidates` empty therefore collapses to the one-model behaviour for free.
 */
export function stageModelsFor(connection: { model: string }, candidates: string[]): StageModels {
  const byFamily = new Map<StageFamily, string>();
  for (const fam of ['plan', 'build', 'verify'] as const) {
    const inFamily = candidates.filter(id => familyOf(id) === fam);
    const pick = inFamily.find(id => id !== connection.model) ?? inFamily[0];
    if (pick) byFamily.set(fam, pick);
  }
  const fallback = connection.model;
  const pickFor = (fam: StageFamily): string => byFamily.get(fam) ?? fallback;
  return { plan: pickFor('plan'), build: pickFor('build'), verify: pickFor('verify') };
}

/** The model for one stage: its family's pick, or the connection's model for 'single'. */
export function modelForStage(models: StageModels, type: string, fallback: string): string {
  switch (stageFamily(type)) {
    case 'plan': return models.plan;
    case 'build': return models.build;
    case 'verify': return models.verify;
    case 'single': return fallback;
  }
}
