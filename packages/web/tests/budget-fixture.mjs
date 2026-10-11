// Synthetic prices/context limits for mocked transports only; never production defaults.
export const fixtureBudgetEnv = {
  DAILY_SERVER_BUDGET_USD: '100',
  MANAGED_MODEL_COST_BOUNDS_JSON: JSON.stringify([
    ['groq', 'llama-3.3-70b-versatile'], ['groq', 'llama-3.1-8b-instant'],
    ['xkiro', 'deepseek/deepseek-v4-flash'], ['xkiro', 'openai/gpt-5.3-codex-spark'],
    ['openai', 'gpt-4o'], ['anthropic', 'claude-sonnet-4-6'],
  ].map(([provider, model]) => ({ provider, model, inputUsdPerMillion: 0, outputUsdPerMillion: 0, requestUsd: 0, maxInputTokens: 1_000_000, outputIncludesReasoning: true }))),
};
