import { sessionSecret, setSessionSecret } from './sessionSecrets';

// Separate from Gemini chat, and cleared when the page reloads or closes.
export const loadEngineKey = (): string => sessionSecret('engine');
export const saveEngineKey = (value: string): void => setSessionSecret('engine', value);
