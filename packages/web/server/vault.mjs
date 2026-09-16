import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = path.resolve(__dirname, '../../.data');
const VAULT_FILE = path.join(VAULT_DIR, 'vault.json');

const DEFAULT_CONFIG = {
  keys: {
    OPENROUTER_API_KEY: '',
    OMNIROUTE_API_KEY: '',
    HUGGINGFACE_API_KEY: '',
    VLLM_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: '',
    MISTRAL_API_KEY: ''
  },
  limits: {
    FREE_MAX_OUTPUT_TOKENS: 2048,
    FREE_MAX_PER_HOUR: 100,
    FREE_CREDIT_MONTHLY_POOL: 1000000,
    FREE_TIER_DISABLED: false
  },
  personas: {
    activePersona: 'react_sandbox',
    templates: {
      react_sandbox: {
        name: 'React Sandbox Architect',
        systemPrompt: `You are collaborating as lead frontend engineer inside an automated React 18 / TypeScript Vite sandbox.
All responses are piped directly into an active compiler. Return ONLY complete, working component code in a single file using native React hooks and pure SVG/CSS. Omit all conversational greetings, markdown commentary, and conversational closings. Start directly with imports and end with the default export.`
      },
      agent_orchestrator: {
        name: 'Multi-Agent Router',
        systemPrompt: `You are an autonomous agent coordinator. Break down tasks into discrete JSON action plans, evaluate downstream tool requirements, and output strictly structured data.`
      },
      general_chat: {
        name: 'Technical Collaborator',
        systemPrompt: `You are an authentic, direct, and technically rigorous collaborator. Provide detailed, pragmatic engineering advice with zero corporate fluff.`
      }
    }
  }
};

function ensureVault() {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
  }
  if (!fs.existsSync(VAULT_FILE)) {
    fs.writeFileSync(VAULT_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  }
}

export function loadVault() {
  ensureVault();
  try {
    const raw = fs.readFileSync(VAULT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      keys: { ...DEFAULT_CONFIG.keys, ...parsed.keys },
      limits: { ...DEFAULT_CONFIG.limits, ...parsed.limits },
      personas: { ...DEFAULT_CONFIG.personas, ...parsed.personas }
    };
  } catch (err) {
    console.error('[Vault] Error reading vault file, fallback to defaults:', err.message);
    return DEFAULT_CONFIG;
  }
}

export function saveVault(updates) {
  ensureVault();
  const current = loadVault();
  const merged = {
    keys: { ...current.keys, ...(updates.keys || {}) },
    limits: { ...current.limits, ...(updates.limits || {}) },
    personas: { ...current.personas, ...(updates.personas || {}) }
  };
  fs.writeFileSync(VAULT_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

export function getClientConfig() {
  const vault = loadVault();
  const maskedKeys = {};
  for (const [key, val] of Object.entries(vault.keys)) {
    maskedKeys[key] = val ? `${val.slice(0, 3)}...${val.slice(-4)}` : '';
  }
  return {
    keys: maskedKeys,
    limits: vault.limits,
    personas: vault.personas
  };
}
