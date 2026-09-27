import type { ProjectFile } from './project';

// A small secret scanner, shared by everything that writes text somewhere it outlives the tab:
// persistent memory, a downloaded ZIP, a commit pushed to GitHub.
//
// Two kinds of evidence. The strong kind is exact: the keys this visitor actually holds (the
// provider keyring, GitHub tokens, MCP bearers) are passed in and matched verbatim, so a key the
// model echoed back into a generated file is caught however it is formatted around. The weak kind
// is shape: vendor key prefixes and `password = "…"` style assignments. Shapes are chosen to be
// specific — a bare 40-character hex string is not flagged, because a commit SHA looks exactly
// like one and a scanner that cries wolf on every lockfile gets switched off.

export interface SecretFinding { kind: string; start: number; end: number; }

/** Vendor key shapes. Each is anchored on a prefix the vendor documents, so ordinary prose never matches. */
const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'OpenRouter key', re: /\bsk-or-(?:v1-)?[A-Za-z0-9]{20,}/g },
  { kind: 'OpenAI key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { kind: 'xAI key', re: /\bxai-[A-Za-z0-9]{32,}/g },
  { kind: 'Groq key', re: /\bgsk_[A-Za-z0-9]{32,}/g },
  { kind: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{30,}/g },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/g },
  { kind: 'GitHub token', re: /\bgithub_pat_[A-Za-z0-9_]{50,}/g },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'Stripe key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g },
  { kind: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'Private key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { kind: 'Bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/g },
];

/**
 * `password: "hunter2"`, `API_KEY=abc…`, `"secret": "…"`. The value is what gets redacted, not the
 * name, so the file still reads correctly and the reader can see what was removed. Placeholders a
 * model writes on purpose (`YOUR_API_KEY`, `<token>`, `process.env.X`) are left alone.
 */
const ASSIGNMENT = /\b(pass(?:word|wd)?|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b(["']?\s*[:=]\s*["'`])([^"'`\s]{6,})(["'`])/gi;
const PLACEHOLDER = /^(?:your[_-]|<|\$\{|process\.env|import\.meta\.env|x{4,}|\*{4,}|changeme|example|placeholder|redacted|todo)/i;

/** Every secret in `text`, strongest evidence first, with overlapping findings merged. */
export function findSecrets(text: string, known: string[] = []): SecretFinding[] {
  const found: SecretFinding[] = [];
  for (const secret of new Set(known.map(k => k.trim()).filter(k => k.length >= 8))) {
    let at = text.indexOf(secret);
    while (at !== -1) { found.push({ kind: 'Saved credential', start: at, end: at + secret.length }); at = text.indexOf(secret, at + secret.length); }
  }
  for (const { kind, re } of PATTERNS) for (const m of text.matchAll(re)) found.push({ kind, start: m.index, end: m.index + m[0].length });
  for (const m of text.matchAll(ASSIGNMENT)) {
    const value = m[3];
    if (PLACEHOLDER.test(value)) continue;
    const start = m.index + m[1].length + m[2].length;
    found.push({ kind: 'Password or secret assignment', start, end: start + value.length });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: SecretFinding[] = [];
  for (const f of found) {
    const last = merged[merged.length - 1];
    if (last && f.start < last.end) { last.end = Math.max(last.end, f.end); continue; }
    merged.push({ ...f });
  }
  return merged;
}

export const containsSecret = (text: string, known: string[] = []): boolean => findSecrets(text, known).length > 0;

export const REDACTED = '[REDACTED]';

/** `text` with every finding replaced by {@link REDACTED}, and how many were replaced. */
export function redactSecrets(text: string, known: string[] = []): { text: string; count: number } {
  const findings = findSecrets(text, known);
  if (!findings.length) return { text, count: 0 };
  let out = ''; let cursor = 0;
  for (const f of findings) { out += text.slice(cursor, f.start) + REDACTED; cursor = f.end; }
  return { text: out + text.slice(cursor), count: findings.length };
}

/**
 * A project's files with secrets redacted, for anything that leaves the browser: the ZIP and a
 * GitHub push. Reports which files changed so the person is told, rather than finding out later
 * that a config file no longer holds the value they typed.
 */
export function sanitizeFiles(files: ProjectFile[], known: string[] = []): { files: ProjectFile[]; redactions: number; touched: string[] } {
  let redactions = 0; const touched: string[] = [];
  const out = files.map(file => {
    const { text, count } = redactSecrets(file.content, known);
    if (!count) return file;
    redactions += count; touched.push(file.path);
    return { ...file, content: text };
  });
  return { files: out, redactions, touched };
}
