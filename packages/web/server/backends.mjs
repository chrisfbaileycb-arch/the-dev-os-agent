// Availability is independent of Shield eligibility and permission to spend owner money.
//
// One backend group remains: the US providers. The optional, owner-configured Hugging Face
// backend was removed (route, registry entry, and HF_BACKEND_* variables) because its egress was
// neither US-only nor Shield-eligible, and the experiment lane already covers a visitor's own key.
export const US_BACKEND_IDS = ['openai', 'anthropic', 'google', 'groq', 'xai'];

export function backendEnabled(id, env = process.env) {
  if (US_BACKEND_IDS.includes(id)) return env.US_BACKEND_ENABLED !== 'false';
  return true;
}

export function backendStatus(env = process.env) {
  return { us: backendEnabled('openai', env) };
}
