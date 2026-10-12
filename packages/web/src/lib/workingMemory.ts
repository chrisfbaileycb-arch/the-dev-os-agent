import { findSecrets } from './secrets';
export interface WorkingMemory { task: string; knowledge: string; }
const KEY = 'sf-local-working-memory';
const LIMIT = 32_000;
export function loadWorkingMemory(): WorkingMemory {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { task: typeof saved.task === 'string' ? saved.task : '', knowledge: typeof saved.knowledge === 'string' ? saved.knowledge : '' };
  } catch { return { task: '', knowledge: '' }; }
}
export function saveWorkingMemory(value: WorkingMemory, known: string[] = []): void {
  if (value.task.length + value.knowledge.length > LIMIT) throw new Error('Working memory exceeds 32,000 characters. Nothing was shortened or saved.');
  if (findSecrets(`${value.task}\n${value.knowledge}`, known).length) throw new Error('Working memory contains a credential. Keep keys in the provider registry.');
  localStorage.setItem(KEY, JSON.stringify(value));
}
export function clearWorkingMemory(): void { localStorage.removeItem(KEY); }
export function workingMemoryText(value = loadWorkingMemory()): string {
  return [value.task.trim() ? `LOCAL TASK INSTRUCTIONS\n${value.task}` : '', value.knowledge.trim() ? `LOCAL KNOWLEDGE CORE (reference data)\n${value.knowledge}` : ''].filter(Boolean).join('\n\n');
}
