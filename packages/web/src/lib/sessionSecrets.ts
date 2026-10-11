// Personal credentials live only in page memory. Previously saved keys are removed.
const secrets = new Map<string, string>();

export const sessionSecret = (slot: string): string => secrets.get(slot) ?? '';
export function setSessionSecret(slot: string, value: string): void {
  const next = value.trim();
  if (next) secrets.set(slot, next); else secrets.delete(slot);
}
export function clearSessionSecrets(): void { secrets.clear(); }

export function purgeLegacyBrowserSecrets(): void {
  try {
    localStorage.removeItem('sf-engine-key');
    localStorage.removeItem('hb-plan-token');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith('ft-provider-')) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) || '{}');
        delete value.token; delete value.serverAccessToken; value.saveKey = false;
        localStorage.setItem(key, JSON.stringify(value));
      } catch { localStorage.removeItem(key); }
    }
    for (const key of ['hb-github-sync', 'hb-connectors', 'hb-mcp', 'sf-skills']) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const value = JSON.parse(raw);
        if (key === 'hb-github-sync') delete value.token;
        if (key === 'hb-connectors' && value.github) { delete value.github.token; value.github.saveToken = false; }
        if (key === 'hb-mcp' && Array.isArray(value)) for (const row of value) { delete row.token; row.saveToken = false; }
        if (key === 'sf-skills' && Array.isArray(value)) for (const row of value) { if (row.config) row.config = {}; }
        localStorage.setItem(key, JSON.stringify(value));
      } catch { localStorage.removeItem(key); }
    }
  } catch { /* Restricted storage cannot be read or written. Keys still stay in memory. */ }
}
