import type { Provider } from "./runTypes";

export interface ProviderPreset {
  name: string;
  tier: string;
  endpoint: string;
  models: string[];
  keyHint: string;
}

export const providerCatalog: Record<Provider, ProviderPreset> = {
  openrouter: { name: "OpenRouter", tier: "Universal", endpoint: "https://openrouter.ai/api/v1", models: ["openrouter/auto", "deepseek/deepseek-r1"], keyHint: "OpenRouter API key" },
  groq: { name: "Groq", tier: "Ultra-fast", endpoint: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"], keyHint: "Groq API key" },
  cohere: { name: "Cohere", tier: "Enterprise", endpoint: "https://api.cohere.com/v2", models: ["command-a-03-2025", "command-r-plus-08-2024"], keyHint: "Cohere API key" },
  custom: { name: "Custom OpenAI-compatible", tier: "Custom", endpoint: "", models: [], keyHint: "Key for your endpoint, if it needs one" },
};
