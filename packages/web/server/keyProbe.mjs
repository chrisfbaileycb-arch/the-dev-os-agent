// What "this key is real" means, per provider. Format checks are local. The live check is the
// provider's own model list, called by discover — never a compiled model list. No provider gets
// a separate account-probe endpoint, so there is none here.

const SHAPES = {
  openai: { test: value => value.startsWith('sk-'), error: 'OpenAI keys start with sk-.' },
  anthropic: { test: value => value.startsWith('sk-ant-'), error: 'Anthropic keys start with sk-ant-.' },
};

/** Empty string when the key is shaped like one this provider issues. */
export function keyShapeError(provider, key) {
  const rule = SHAPES[provider];
  if (!rule) return '';
  const value = String(key ?? '').trim();
  return rule.test(value) ? '' : rule.error;
}
