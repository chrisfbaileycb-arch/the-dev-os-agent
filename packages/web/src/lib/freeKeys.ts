import type { Provider } from './providers';

/**
 * Free keys a visitor can get in a few minutes, all from US companies. Each person uses their own
 * key, so each person gets their own rate limits and nobody shares a quota that runs dry, which is
 * what made the shared free tier answer "warming up". Terms change; each entry links to the
 * provider's own page, which is the authority.
 */
export interface FreeKeyOption { provider: Provider; name: string; getKeyUrl: string; steps: string[]; note?: string; }

export const FREE_KEY_OPTIONS: FreeKeyOption[] = [
  {
    provider: 'google', name: 'Google Gemini (AI Studio)', getKeyUrl: 'https://aistudio.google.com/apikey',
    steps: ['Sign in with a Google account.', 'Choose Create API key.', 'Paste the key here.'],
    note: 'On Google\'s free tier, what you send may be used to improve Google\'s products. Don\'t send private or client data on a free key.',
  },
  {
    provider: 'github', name: 'GitHub Models (OpenAI models)', getKeyUrl: 'https://github.com/settings/personal-access-tokens/new',
    steps: ['Sign in to GitHub.', 'Create a fine-grained token.', 'Under Account permissions, set Models to Read-only.', 'Paste the token here.'],
    note: 'Free use is rate-limited and meant for trying things out.',
  },
  {
    provider: 'groq', name: 'Groq (Llama, gpt-oss)', getKeyUrl: 'https://console.groq.com/keys',
    steps: ['Create a free Groq account.', 'Choose Create API Key.', 'Paste the key here.'],
  },
  {
    provider: 'cerebras', name: 'Cerebras (gpt-oss)', getKeyUrl: 'https://cloud.cerebras.ai',
    steps: ['Create a free Cerebras account.', 'Open API Keys and create one.', 'Paste the key here.'],
    note: 'The free tier has a daily token cap and a short context window.',
  },
];
