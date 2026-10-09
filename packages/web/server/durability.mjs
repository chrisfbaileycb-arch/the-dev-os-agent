// Where this process keeps rows, and whether those rows will still be there after a restart.
//
// The live Render service is a free instance with no disk. SQLite at /tmp is wiped on every
// restart, so a monthly quota stored there is a claim the server cannot keep. Postgres
// (DATABASE_URL) and a SQLite file outside /tmp and /var/tmp are the only durable options.
// Callers that cannot tell must say the ledger lives in the browser rather than guess.

const TMP = /^\/(?:var\/)?tmp(?:\/|$)/;

/**
 * @param {{ databaseUrl?: string, dataFile?: string }} [input]
 * @returns {{ durable: boolean, kind: 'postgres'|'sqlite'|'ephemeral'|'unconfigured', ledger: 'server'|'browser' }}
 */
export function classifyStorage({ databaseUrl, dataFile } = {}) {
  if (typeof databaseUrl === 'string' && databaseUrl.trim()) return { durable: true, kind: 'postgres', ledger: 'server' };
  if (typeof dataFile !== 'string' || !dataFile.trim()) return { durable: false, kind: 'unconfigured', ledger: 'browser' };
  const file = dataFile.trim();
  if (file === ':memory:' || TMP.test(file)) return { durable: false, kind: 'ephemeral', ledger: 'browser' };
  return { durable: true, kind: 'sqlite', ledger: 'server' };
}
