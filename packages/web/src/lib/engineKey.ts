// The execution-engine key. A Gemini API key on the wire, a different slot in the product.
// It is kept in this browser. It is never copied from the Gemini chat key.

const KEY = 'sf-engine-key';

export function loadEngineKey(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

export function saveEngineKey(value: string): void {
  try {
    const next = value.trim();
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch { /* this browser refused storage */ }
}
